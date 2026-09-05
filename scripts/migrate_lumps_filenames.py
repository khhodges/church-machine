#!/usr/bin/env python3
"""Retired filename migration entry point.

Legacy metadata may only be reviewed and explicitly accepted with
audit_legacy_lump_sidecars.py. Canonical binary filenames are produced by the
builders and must not be inferred from neighbouring JSON files.
"""

import sys


def main():
    print(
        "migrate_lumps_filenames.py is retired; use canonical binary builders "
        "or the explicit legacy audit/import tool.",
        file=sys.stderr,
    )
    return 2


if __name__ == "__main__":
    sys.exit(main())