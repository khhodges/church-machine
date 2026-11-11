"""Frozen-package local RTLIL export; does not invoke Vivado or any board."""
import hashlib
import json
from pathlib import Path
import sys


def generate(root):
    manifest = json.loads((root / "board-source-manifest.json").read_text())
    for name, expected in manifest["files"].items():
        path = (root / name).resolve()
        if not path.is_relative_to(root.resolve()):
            raise ValueError("Manifest path escapes package")
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError(f"Frozen source changed: {name}")
    identity = hashlib.sha256(json.dumps(
        manifest["files"], sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    if identity != manifest["boardSourceSha256"]:
        raise ValueError("Board manifest identity mismatch")
    sys.path.insert(0, str(root / "source"))
    from hardware.gen_rtlil import install_elaboration_caches
    from hardware.combined_board import CombinedStarterBoard
    from amaranth.back.rtlil import convert

    inputs = json.loads((root / "source/combined-inputs.json").read_text())
    install_elaboration_caches()
    top = CombinedStarterBoard(inputs["records"])
    out = root / "rtl"
    out.mkdir(exist_ok=False)
    rtl = out / "combined_starter.il"
    rtl.write_text(convert(top, name="combined_starter", ports=top.ports()))
    receipt = {
        "schema": "church.combined-board-rtlil/v1",
        "boardSourceSha256": identity,
        "runtimeSourceSha256": manifest["runtimeSourceSha256"],
        "rtlilSha256": hashlib.sha256(rtl.read_bytes()).hexdigest(),
        "vendorBuild": False, "physicalTest": False,
    }
    (out / "export-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(receipt, sort_keys=True))


if __name__ == "__main__":
    generate(Path(__file__).resolve().parent)
