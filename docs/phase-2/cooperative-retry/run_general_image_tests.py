"""Prepare an isolated source snapshot and run CSI2 checks; never access hardware."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

from prepare_starter import HERE, prepare, digest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--boot2-image", type=Path,
                        help="Optional exact retained Boot2 image for UART/core replay")
    args = parser.parse_args()
    image = args.boot2_image.resolve() if args.boot2_image else None
    output = prepare(args.output)
    env = dict(os.environ)
    env["PYTHONPATH"] = str(output) + os.pathsep + env.get("PYTHONPATH", "")
    if image:
        env["BOOT2_REPLAY_IMAGE"] = str(image)
        env["BOOT2_REPLAY_REPORT"] = str(output / "boot2-replay.json")
    else:
        env.pop("BOOT2_REPLAY_IMAGE", None)
        env.pop("BOOT2_REPLAY_REPORT", None)
    tests = ("test_general_image_admission.py", "test_starter_lifecycle.py",
             "test_starter_sha256.py")
    status = subprocess.run([
        sys.executable, "-m", "pytest", *(str(HERE / name) for name in tests),
        "-q", "-s", f"--junitxml={output / 'general-image-tests.xml'}"],
        cwd=output, env=env, check=False).returncode
    receipt = dict(
        schema="church.general-image-local-check/v1", protocol="CSI2",
        configuration=dict(general_image=True, lump_records=None),
        authority="existing physical maintenance; digest is transfer consistency only",
        testExitCode=status, tests={name: digest(HERE / name) for name in tests},
        parentSourceReceiptSha256=digest(output / "starter-source-manifest.json"),
        imageSha256=digest(image) if image else None,
        vendorBuild=False, physicalOperations=False)
    (output / "general-image-check.json").write_text(json.dumps(receipt, indent=2) + "\n")
    return status


if __name__ == "__main__":
    raise SystemExit(main())
