"""Authorization-gated, local-only Vivado build. Never contacts/programs a board."""
import argparse
import json
import subprocess
from pathlib import Path

from combined_package import verify_package, verify_rtl, sha256


def build(root, authorization):
    root = root.resolve()
    manifest = verify_package(root)
    rtl = verify_rtl(root, manifest)
    # This file records a human decision; it is not a cryptographic permission.
    # No default, environment bypass, remote launcher, or hardware commands.
    grant = json.loads(authorization.read_text())
    if (grant.get("schema") != "church.combined-vendor-authorization/v1"
            or grant.get("boardSourceSha256") != manifest["boardSourceSha256"]
            or grant.get("verilogSha256") != rtl["verilogSha256"]
            or grant.get("allowVendorBuild") is not True
            or grant.get("allowProgramming") is not False
            or not isinstance(grant.get("approvalReference"), str)
            or not grant["approvalReference"].strip()
            or not isinstance(grant.get("vivadoVersion"), str)
            or not grant["vivadoVersion"].strip()):
        raise ValueError("Explicit exact-package vendor-build authorization required")
    version = subprocess.check_output(["vivado", "-version"], text=True)
    if version.splitlines()[0] != grant["vivadoVersion"]:
        raise ValueError("Vivado version differs from authorized toolchain")
    out = root / "vendor"
    out.mkdir(exist_ok=False)
    (out / "authorization.json").write_text(json.dumps(grant, indent=2) + "\n")
    with (out / "build.log").open("w") as log:
        subprocess.run(["vivado", "-mode", "batch", "-source", str(root / "build.tcl"),
                        "-log", "vivado.log", "-journal", "vivado.jou"],
                       cwd=out, stdout=log, stderr=subprocess.STDOUT, check=True)
    verify_package(root)
    verify_rtl(root, manifest)
    # TCL writes this only after every routed-design gate and write_bitstream.
    gates = json.loads((out / "gates.json").read_text())
    if gates != {"clockConnectivity": True, "pinConstraints": True,
                 "setupHold": True, "drc": True, "unconstrained": False}:
        raise ValueError("Missing or failed vendor qualification gates")
    required = ["combined_starter.bit", "routed.dcp", "synthesis.dcp",
                "clocks.rpt", "clock_interaction.rpt", "timing.rpt",
                "check_timing.rpt", "drc.rpt", "io.rpt", "utilization.rpt",
                "gates.json", "build.log", "authorization.json"]
    hashes = {name: sha256(out / name) for name in required}
    receipt = {
        "schema": "church.combined-vendor-receipt/v1",
        "boardSourceSha256": manifest["boardSourceSha256"],
        "runtimeSourceSha256": manifest["runtimeSourceSha256"],
        "verilogSha256": rtl["verilogSha256"], "tools": {
            **rtl["tools"], "vivado": version},
        "files": hashes, "bitstreamSha256": hashes["combined_starter.bit"],
        "gates": gates, "vendorBuild": True, "physicalTest": False,
        "programmingAuthorized": False,
    }
    (out / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    return receipt


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--authorization", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(build(Path(__file__).resolve().parent, args.authorization),
                     indent=2))
