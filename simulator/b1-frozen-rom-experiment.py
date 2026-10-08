"""Extract the retained B.1 initialization cone and constrain only its ROM."""
import hashlib
import importlib.util
import json
import re
import sys
from pathlib import Path

FROZEN_SHA = "5cb8a259f9159e0a00ba1f70b77d70bebc70dcc877a6e83bfbf9c89a36fbf7dd"
MICRO_SHA = "d1ea021b000fa63ac65c6d3a35e1eb05c863f4a4789c91bc467e81807f1ab77d"
ROM_DECL = "  reg [45:0] init_rom [2692:0];"
ATTRIBUTE = '  (* rom_style = "distributed", ram_style = "distributed" *)\n'


def extract(text):
    """Keep exact declarations/drivers; hold only boot_triggered low."""
    decls = {}
    for line in text.splitlines():
        match = re.match(r"  (?:wire|reg)(?:\s+\[[^\]]+\])?\s+(\w+)\b.*;", line)
        if match:
            decls[match[1]] = line
    drivers = {}
    for match in re.finditer(r"(?m)^  assign (\w+)(?:\[[^\]]+\])? = [^\n]+;\n", text):
        drivers.setdefault(match[1], []).append(match[0])
    for match in re.finditer(r"(?m)^  always @\(posedge clk\)\n(?:[ \t]{4,}[^\n]*\n)+", text):
        targets = set(re.findall(r"(\w+)(?:\[[^\]]+\])?\s*<=", match[0]))
        if len(targets) != 1:
            # Unrelated core blocks may contain escaped identifiers. They
            # cannot enter the cone: a required unsupported driver fails below.
            continue
        drivers.setdefault(next(iter(targets)), []).append(match[0])
    roots = ["hw_init_wr_en", "hw_init_wr_addr", "hw_init_wr_data", "hw_init_done"]
    selected = set()
    statements = []
    pending = list(roots)
    while pending:
        name = pending.pop()
        if name in selected or name in ("clk", "init_rom"):
            continue
        if name not in decls:
            raise ValueError(f"Missing declaration {name}")
        selected.add(name)
        if name == "boot_triggered":
            statements.append("  assign boot_triggered = 1'b0;\n")
            continue
        if name not in drivers:
            raise ValueError(f"Missing retained driver {name}")
        for statement in drivers[name]:
            if statement not in statements:
                statements.append(statement)
            cleaned = re.sub(r"\d+'[sS]?[bBoOdDhH][0-9a-fA-FxXzZ_]+", "", statement)
            for dep in re.findall(r"\b[A-Za-z_]\w*\b", cleaned):
                if dep in decls and dep not in selected:
                    pending.append(dep)
    rom = re.search(r"(?ms)^  reg \[45:0\] init_rom \[2692:0\];\n  initial begin\n.*?^  end\n", text)
    if not rom:
        raise ValueError("Retained ROM block not found")
    # Original POR and counter logic remain verbatim. Unlike the prior
    # microtest, this is not a reimplementation in Amaranth.
    return (
        "module init_probe(input clk, input enable, output done, output write_en,"
        " output [13:0] write_addr, output [31:0] write_data);\n"
        + "\n".join("  wire boot_triggered;" if n == "boot_triggered" else decls[n]
                    for n in sorted(selected))
        + "\n" + rom[0] + "".join(statements)
        + "  assign done = hw_init_done;\n"
        + "  assign write_en = hw_init_wr_en;\n"
        + "  assign write_addr = hw_init_wr_addr;\n"
        + "  assign write_data = hw_init_wr_data;\nendmodule\n"
    )


def main():
    root, frozen, micro, out = (Path(p).resolve() for p in sys.argv[1:])
    raw = frozen.read_bytes()
    if hashlib.sha256(raw).hexdigest() != FROZEN_SHA:
        raise ValueError("Wrong frozen B.1 RTL")
    if hashlib.sha256(micro.read_bytes()).hexdigest() != MICRO_SHA:
        raise ValueError("Wrong microtest generator")
    text = raw.decode()
    rows = re.findall(r"init_rom\[(\d+)\] = 46'h([0-9a-f]+);", text)
    if [int(i) for i, _ in rows] != list(range(2693)):
        raise ValueError("Retained ROM is not the exact 2693-entry table")
    pairs = [(int(v, 16) >> 32, int(v, 16) & 0xffffffff) for _, v in rows]
    if pairs[0] != (1, 63):
        raise ValueError("Wrong first pair")
    sys.path.insert(0, str(root))
    spec = importlib.util.spec_from_file_location("micro", micro)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.prepare_pairs(pairs, out)
    # That helper supplies the checked testbench/runner scaffold only. Its
    # Amaranth IL does not describe the retained cone and must not be bundled.
    (out / "initializer.il").unlink()
    cone = extract(text)
    # The original POR internally enables the transfer; external pause tests
    # from the former harness are not used for this exact retained controller.
    for variant in ("baseline", "candidate"):
        tb = out / variant / "tb.sv"
        tb.write_text(tb.read_text().replace(
            'if (!enable || done || count >= 2693)',
            'if (done || count >= 2693)').replace(
            'if (!rst && $time > 400)',
            'if (!rst && $time > 200)').replace(
            '// Exercise pauses in both fetch and write phases.',
            '// Retained controller is internally POR-driven; enable is unused.'))
    (out / "baseline.v").write_text(cone)
    if cone.count(ROM_DECL) != 1 or text.count(ROM_DECL) != 1:
        raise ValueError("Ambiguous ROM declaration")
    (out / "candidate.v").write_text(cone.replace(ROM_DECL, ATTRIBUTE + ROM_DECL, 1))
    full = text.replace(ROM_DECL, ATTRIBUTE + ROM_DECL, 1)
    # Enforce that the full candidate differs only by this mapping attribute.
    if full.replace(ATTRIBUTE + ROM_DECL, ROM_DECL, 1) != text:
        raise ValueError("Unexpected full-design modification")
    (out / "frozen_full_candidate.v").write_text(full)
    evidence = {
        "original_sha256": FROZEN_SHA,
        "full_candidate_sha256": hashlib.sha256(full.encode()).hexdigest(),
        "pairs": len(pairs),
        "expected_sha256": hashlib.sha256(
            (out / "candidate/expected.hex").read_bytes()).hexdigest(),
        "edit": "One ROM mapping attribute; all logic and initialization bytes unchanged",
        "cone_boundary": "Original POR/controller; boot_triggered held low; no core or DMEM",
        "approval": "Experiment only; full synthesized replay and release checks still required",
    }
    (out / "frozen-repair.json").write_text(json.dumps(evidence, indent=2) + "\n")
    print(json.dumps(evidence, indent=2))


if __name__ == "__main__":
    main()
