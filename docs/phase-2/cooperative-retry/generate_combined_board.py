"""Frozen-package local RTLIL export; does not invoke Vivado or any board."""
import hashlib
import json
from pathlib import Path
import sys
import subprocess
import platform
from combined_package import verify_package, sha256


def generate(root):
    root = root.resolve()
    manifest = verify_package(root)
    identity = manifest["boardSourceSha256"]
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
    # Absolute package paths must not perturb RTL identity between fresh exports.
    # Suppress source locations only; retain functional and CDC attributes.
    rtl.write_text(convert(top, name="combined_starter", ports=top.ports(), emit_src=False))
    # proc lowers RTLIL processes only; do not synthesize to a different top.
    script = "read_rtlil combined_starter.il; proc; write_verilog combined_starter.v"
    (out / "convert.ys").write_text(script + "\n")
    version = subprocess.check_output(["yosys", "-V"], text=True).strip()
    with (out / "conversion.log").open("w") as log:
        subprocess.run(["yosys", "-s", "convert.ys"], cwd=out,
                       stdout=log, stderr=subprocess.STDOUT, check=True)
    import amaranth
    receipt = {
        "schema": "church.combined-board-rtl/v2",
        "boardSourceSha256": identity,
        "runtimeSourceSha256": manifest["runtimeSourceSha256"],
        "rtlilSha256": hashlib.sha256(rtl.read_bytes()).hexdigest(),
        "verilogSha256": sha256(out / "combined_starter.v"),
        "conversionScriptSha256": sha256(out / "convert.ys"),
        "tools": {"python": platform.python_version(),
                  "amaranth": amaranth.__version__, "yosys": version},
        "vendorBuild": False, "physicalTest": False,
    }
    (out / "export-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(receipt, sort_keys=True))


if __name__ == "__main__":
    generate(Path(__file__).resolve().parent)
