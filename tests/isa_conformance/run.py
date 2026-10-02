#!/usr/bin/env python3
"""Run observational ISA conformance checks; exit 1 means real discrepancies."""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import subprocess
import shutil
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from oracle import condition, judge, vectors
from amaranth_adapter import run as run_amaranth


def collect():
    cases = vectors()
    js = json.loads(subprocess.check_output(
        ["node", str(Path(__file__).with_name("simulator.cjs"))],
        input=json.dumps(cases), text=True, cwd=ROOT, timeout=120))
    hw = run_amaranth(cases)
    rows = []

    def add(layer, case, status, **details):
        rows.append(dict(layer=layer, id=case, status=status, **details))

    lookup = {v["id"]: v for v in cases}
    for observed in js["vectors"]:
        v = lookup[observed["id"]]
        compiled = observed["assembler"]
        # SAVE roles are unresolved: only the compact operand is an oracle here.
        if v["kind"] == "index" and v["opcode"] == 1:
            forbidden_literal_self = v["register"] == 0 and (v["word"] & 0x3ff0) == 0
            ok = bool(compiled["errors"]) if forbidden_literal_self else (
                not compiled["errors"] and len(compiled["words"]) == 1 and
                (compiled["words"][0] & 0x7fff) == (v["word"] & 0x7fff))
            scope = "operand15 only; SAVE register roles blocked by D1"
        else:
            ok = not compiled["errors"] and compiled["words"] == [v["word"]]
            scope = "literal instruction word"
        add("assembler", v["id"], "passing" if ok else "failing",
            scope=scope, observed=compiled, expected_word=v["word"])
        issues = judge(v, observed)
        if v["kind"] == "index":
            index = v["expected"]["index"]
            must_fault = v["expected"]["arithmetic_fault"] or not 0 <= index < 4 or (
                v["opcode"] == 1 and index == 0)
            if must_fault:
                if not observed["fault"]:
                    issues.append("invalid effective index did not fault")
                if observed["writes"] or observed["before"] != observed["after"]:
                    issues.append("fault changed architectural state")
                if v["expected"]["arithmetic_fault"] and observed["reads"]:
                    issues.append("overflow/underflow attempted capability read")
            else:
                if observed["fault"] or not observed["retired"]:
                    issues.append("valid index did not retire")
                if observed["after"]["pc"] != observed["before"]["pc"] + 1:
                    issues.append("PC did not advance one word")
                if observed["after"]["dr"] != observed["before"]["dr"]:
                    issues.append("index operation modified DRs")
                if v["opcode"] == 0:
                    if not any(r["address"] == 0x200 + index for r in observed["reads"]):
                        issues.append("LOAD did not read expected row")
                    if observed["after"]["cr"][2]["word0"] != observed["gt"]:
                        issues.append("LOAD did not install expected capability")
                    if observed["writes"]:
                        issues.append("LOAD modified memory")
                else:
                    expected = [dict(address=0x200+index, before=0, after=observed["gt"])]
                    if observed["writes"] != expected:
                        issues.append("SAVE did not write only expected row")
        add("simulator", v["id"], "failing" if issues else "passing",
            scope="real fetch/decode/step; fault recovery contained; SAVE operand roles not certified",
            issues=issues, expected=v["expected"], observed=observed)

    for observed in hw["vectors"]:
        v = lookup[observed["id"]]
        layer = f"amaranth-{observed['profile']}"
        if v["kind"] == "index":
            # cap_index is an intermediate wire, not an architectural result.
            # Retain evidence, but NEVER equate this observation to execution.
            add(layer, v["id"], "untested", scope="full LOAD/SAVE execution",
                reason="Only decoder cap_index observed; requires equivalent full-core capability fixture",
                expected=v["expected"], observed=observed)
        else:
            issues = judge(v, observed)
            add(layer, v["id"], "failing" if issues else "passing",
                scope="MCMP equality/Z, DR preservation, normalized PC and memory writes",
                issues=issues, expected=v["expected"], observed=observed)
    for layer, values in [("simulator", [("JS", *r) for r in js["conditions"]]),
                          ("amaranth", hw["conditions"])]:
        for profile, c, f, actual in values:
            expected = int(condition(c, f))
            add(f"{layer}-{profile}", f"condition-{c}-{f}",
                "passing" if actual == expected else "failing",
                scope="condition function only, not predicated execution/fault order",
                expected=expected, observed=actual)
    for item in ["SAVE operand roles", "MCMP N/C/V edge policy",
                 "other indexed encodings", "predicated invalid-word fault order"]:
        add("contract", item, "blocked", reason="Requires explicit master clarification")
    add("generated-RTL", "execution", "untested",
        tools={name: bool(shutil.which(name)) for name in ("iverilog", "verilator")},
        reason="Generated RTL simulation adapter not implemented; tool availability does not certify execution")
    add("hardware", "physical-build", "untested", reason="Outside authorized scope")
    sources = ["docs/instruction-set.md", "simulator/simulator.js", "simulator/assembler.js"]
    sources += [str(p.relative_to(ROOT)) for p in sorted((ROOT/"hardware").glob("*.py"))]
    sources += [str(p.relative_to(ROOT)) for p in sorted(Path(__file__).parent.glob("*"))
                if p.is_file()]
    return dict(schema=1, authority="docs/instruction-set.md", certified=False,
                scope="Initial subset only; positive rows certify only their stated assertions",
                source_sha256={p: hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in sources},
                vectors=cases, summary=dict(Counter(r["status"] for r in rows)), results=rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--require-complete", action="store_true")
    args = parser.parse_args()
    try:
        report = collect()
        failed = report["summary"].get("failing", 0)
        incomplete = sum(report["summary"].get(k, 0) for k in ("blocked", "untested"))
        code = int(bool(failed or (args.require_complete and incomplete)))
    except Exception as error:
        report = dict(schema=1, certified=False, status="runner-error",
                      error=f"{type(error).__name__}: {error}")
        code = 2
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report.get("summary", report)), flush=True)
    return code


if __name__ == "__main__":
    sys.exit(main())