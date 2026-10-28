#!/usr/bin/env python3
"""Read-only baseline staging and disposable candidate diagnostic. No publication."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from server import design_simulation


def main():
    directory = ROOT / "server/lumps"
    document = json.loads((directory / "design-drafts/ascending-v1.json").read_text())
    image, _, _ = design_simulation.stage(
        design_simulation.configuration(document), document, directory, 21)
    with tempfile.TemporaryDirectory(prefix="attack-progress-") as temporary:
        baseline = Path(temporary) / "baseline.bin"
        baseline.write_bytes(image)
        subprocess.run(["node", str(ROOT / "simulator/test_attack_progress_boundary.js"),
                        str(baseline)] + (["--export"] if "--export" in sys.argv else []),
                       cwd=ROOT, check=True)


if __name__ == "__main__":
    main()
