#!/usr/bin/env bash
# CI guard: fail if stale scheduler-semantic CR7 names survive.
#
# The registers were renamed CR7→CR14 in hardware/core.py.  If someone
# regenerates the netlists from an unpatched source the old cr7_wr_* names
# will silently reappear.  This script catches that before it reaches tapeout.
#
# Exit codes:
#   0 — no stale names found (clean), or only absent synthesised files (warning)
#   1 — one or more matches found in a file that exists (stale output detected)
#
# Absent files are treated as warnings, not failures.  The synthesised
# verilog/church_ti60_f225.v is a build artefact that may not be present in
# a fresh checkout.  Only files that ARE present are checked for stale names.

set -euo pipefail

# If file paths are supplied as arguments, check those; otherwise fall back to
# the canonical synthesised-output locations.
if [ "$#" -gt 0 ]; then
    VERILOG_FILES=("$@")
else
    VERILOG_FILES=(
        "verilog/church_core.v"
        "verilog/church_ti60_f225.v"
    )
fi

PATTERN='cr7_wr_|cr7_base|RESTORE_CR7'

FAILED=0

for f in "${VERILOG_FILES[@]}"; do
    if [ ! -f "$f" ]; then
        echo "WARNING: $f not found — skipping (--missing-ok)"
        continue
    fi

    matches=$(grep -E -c "$PATTERN" "$f" || true)
    if [ "$matches" -gt 0 ]; then
        echo "FAIL: $f contains $matches occurrence(s) of '$PATTERN'" >&2
        grep -E -n "$PATTERN" "$f" >&2
        FAILED=1
    else
        echo "OK:   $f — no stale '$PATTERN' signal names"
    fi
done

if [ "$FAILED" -eq 1 ]; then
    echo ""
    echo "Stale CR7 signal names detected in synthesised output." >&2
    echo "Re-run 'python hardware/gen_verilog.py' (or equivalent) after" >&2
    echo "verifying hardware/core.py uses the CR14 names throughout." >&2
    exit 1
fi

echo ""
echo "check-stale-cr7: all clear"
