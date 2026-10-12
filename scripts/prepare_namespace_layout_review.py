"""Stage the new Namespace layout for review; never approve or install it."""
import argparse
from datetime import datetime, timezone
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server.namespace_layout_review import prepare


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "generated-artifacts" /
                        ("namespace-layout-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")))
    args = parser.parse_args()
    record = prepare(ROOT / "server/lumps", ROOT / "server/boot-config.json", args.output)
    print(f"Frozen review: {args.output}")
    print(f"Review digest: {record['reviewId']}")
    print("Not execution-approved; no live inputs or runtime were changed.")
