"""Audit the frozen candidate against production entry points without elaboration."""
import ast
import hashlib
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
PROFILE = ROOT / "hardware/profiles/new_layout_guarded.json"


def inspect():
    profile = json.loads(PROFILE.read_text())
    image = (ROOT / profile["image"]).read_bytes()
    assert len(image) == profile["imageBytes"] == profile["dmemWords"] * 4
    assert hashlib.sha256(image).hexdigest() == profile["imageSha256"]
    assert profile["expectedBootGuard"] == (
        profile["namespaceVersion"] << 9 | profile["entryThreadVersion"])
    tcl = (ROOT / profile["vendorScript"]).read_text()
    xdc = (ROOT / profile["constraints"]).read_text()
    assert re.search(r'set\s+PART\s+"' + re.escape(profile["part"]) + '"', tcl)
    assert re.search(r'set\s+TOP\s+"' + re.escape(profile["top"]) + '"', tcl)
    assert re.search(r'set\s+JOBS\s+2\b', tcl)
    assert re.search(r'-period\s+20\.00\b', xdc)
    tree = ast.parse((ROOT / "hardware/gen_rtlil.py").read_text())
    function = next(node for node in tree.body
                    if isinstance(node, ast.FunctionDef) and node.name == "generate_rtlil_wukong")
    call = next(node for node in ast.walk(function)
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                and node.func.id == "ChurchWukongXC7A100T")
    from hardware.guarded_build_profile import build_inputs
    actual, _ = build_inputs(profile["profile"])
    assert any(kw.arg is None and isinstance(kw.value, ast.Name)
               and kw.value.id == "kwargs" for kw in call.keywords)
    assert actual["clk_freq"] == profile["clockHz"]
    assert actual["baud"] == profile["uartBaud"]
    blockers = []
    if actual.get("expected_boot_guard") != profile["expectedBootGuard"]:
        blockers.append("Production generator does not select the frozen boot guard/profile")
    if "runtime_image_words" not in actual:
        blockers.append("No explicit production-capable exact-image input is wired")
    actual = dict(actual)
    actual["runtime_image_words"] = {"count": len(actual["runtime_image_words"]),
                                     "sha256": profile["imageSha256"]}
    sources = ["hardware/gen_rtlil.py", "hardware/wukong_top.py",
               profile["vendorScript"], profile["constraints"],
               "hardware/profiles/new_layout_guarded.json"]
    return dict(
        profile=profile["profile"], imageSha256=profile["imageSha256"],
        targetPart=profile["part"], generatorArguments=actual,
        blockers=blockers, configurationWired=not blockers, readyForSynthesis=False,
        remainingGates=["generated RTL replay", "full UART reload",
                        "profile-aware vendor readiness and release provenance"],
        sourceSha256={name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
                      for name in sources},
        scope="Read-only configuration audit; no elaboration, synthesis, network or hardware I/O")


if __name__ == "__main__":
    result = inspect()
    with Path(sys.argv[1]).open("x") as output:
        json.dump(result, output, indent=2)
        output.write("\n")
    print(json.dumps(result, indent=2))
    sys.exit(2 if result["blockers"] else 0)
