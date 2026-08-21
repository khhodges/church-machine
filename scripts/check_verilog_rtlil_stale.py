#!/usr/bin/env python3
"""check_verilog_rtlil_stale.py — CI guard for generated Verilog/RTLIL freshness.

Reads the CM-HARDWARE-SOURCES-SHA256 fingerprint stamped into each generated
hardware output file and compares it against a freshly-computed digest of the
current Amaranth Python sources.  No re-generation is needed: the check is
O(source-file-size), not O(synthesis-runtime).

Exits 0 when every file is up-to-date.
Exits 1 and names every stale or missing file otherwise.

Run with:
    python3 scripts/check_verilog_rtlil_stale.py
"""

from __future__ import annotations

import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Locate the repository root so the script works from any cwd.
# ---------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from hardware.readiness import CORE_SOURCES, WUKONG_SOURCES, artifact_is_fresh  # noqa: E402

# ---------------------------------------------------------------------------
# Artifacts to check: (repo-relative path, source-set)
# ---------------------------------------------------------------------------
CHECKS: list[tuple[str, tuple[str, ...]]] = [
    ("build/church_core.v",              CORE_SOURCES),
    ("build/church_core_iot.v",          CORE_SOURCES),
    ("verilog/church_core.v",            CORE_SOURCES),
    ("build/church_wukong_xc7a100t.il",  WUKONG_SOURCES),
    ("build/church_wukong_xc7a100t.v",   WUKONG_SOURCES),
]

# ---------------------------------------------------------------------------
# Run checks
# ---------------------------------------------------------------------------
failed: list[str] = []

for rel_path, sources in CHECKS:
    path = ROOT / rel_path
    ok, message = artifact_is_fresh(path, sources)
    if ok:
        print(f"  ok  {rel_path}")
    else:
        print(f"  STALE  {rel_path} — {message}")
        failed.append(rel_path)

if failed:
    print(
        f"\nERROR: {len(failed)} generated file(s) are stale or missing.\n"
        "Re-run the appropriate generator to bring them up to date:\n"
        "  python -m hardware.gen_verilog          # church_core.v + church_core_iot.v\n"
        "  python -m hardware.gen_verilog verilog   # verilog/church_core.v\n"
        "  python -m hardware.gen_rtlil             # church_wukong_xc7a100t.il/.v\n"
        "\nStale files:",
        file=sys.stderr,
    )
    for p in failed:
        print(f"  {p}", file=sys.stderr)
    sys.exit(1)

print(f"\nAll {len(CHECKS)} generated hardware files match current Amaranth sources.")
