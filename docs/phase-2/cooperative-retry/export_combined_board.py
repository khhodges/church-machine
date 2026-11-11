"""Prepare a fresh frozen combined board package; no vendor/board commands."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil

from prepare_candidate import ROOT, HERE
from prepare_combined import prepare
from prepare_starter import digest


def export(output):
    output = Path(output).resolve()
    if not output.is_relative_to(ROOT / "generated-artifacts") or output.exists():
        raise ValueError("Choose a fresh child of generated-artifacts")
    source = prepare(output / "source")
    runtime = json.loads((source / "combined-source-manifest.json").read_text())
    shutil.copyfile(HERE / "combined_board.py", source / "hardware/combined_board.py")
    shutil.copyfile(HERE / "combined-board.xdc", output / "board.xdc")
    shutil.copyfile(HERE / "generate_combined_board.py", output / "generate.py")
    files = {
        p.relative_to(output).as_posix(): digest(p)
        for p in sorted(output.rglob("*"))
        if p.is_file() and "__pycache__" not in p.parts and p.suffix != ".pyc"
    }
    identity = hashlib.sha256(json.dumps(
        files, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    manifest = {
        "schema": "church.combined-board-source/v1",
        "boardSourceSha256": identity,
        "runtimeSourceSha256": runtime["sourceConfigurationSha256"],
        "files": files, "applications": runtime["applications"],
        "part": "xc7a100tfgg676-2",
        "inputClockHz": 50_000_000, "executionClockHz": 25_000_000,
        "uartBaud": 57_600,
        "maintenance": {"pin": "M6", "activeLow": True, "holdRequired": True,
                        "resetsTransport": False},
        "vendorBuild": False, "physicalTest": False,
        "programmingAuthorized": False, "bitstreamSha256": None,
    }
    (output / "board-source-manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n")
    return output


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    print(export(parser.parse_args().output))
