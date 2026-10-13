"""Prepare a private destination-localized artifact from a frozen layout review."""
import argparse
from datetime import datetime, timezone
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from server.namespace_migration_artifact import prepare_migration


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--review", type=Path, required=True,
                        help="Frozen review directory under generated-artifacts")
    parser.add_argument("--compiler-candidates", type=Path,
                        help="Optional unresolved compiler-candidate package for this review")
    parser.add_argument("--output", type=Path, default=ROOT / "generated-artifacts" /
                        ("namespace-migration-" +
                         datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")))
    args = parser.parse_args()
    record = prepare_migration(
        args.review, args.output, compiler_candidates=args.compiler_candidates)
    print(f"Private migration artifact: {args.output}")
    print(f"Migration digest: {record['migrationId']}")
    print(f"Localized residents: {len(record['localizedResidents'])}")
    print(f"Unbuilt Thread rows: {len(record['unbuiltThreadRows'])}")
    print("Not approval-eligible, activated, or executable.")
