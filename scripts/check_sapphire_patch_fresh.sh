#!/usr/bin/env bash
# scripts/check_sapphire_patch_fresh.sh
#
# Content-based guard: verifies sapphire.v currently contains the canonical
# bare-filename $readmemb block for all four ram_symbol0..3 lanes — the same
# block scripts/patch_sapphire_init.py writes and treats as "already patched"
# (see patch_sapphire_init.py's READMEMB_BLOCK / no-op check).
#
# HISTORY / WHY THIS IS CONTENT-BASED, NOT MTIME-BASED:
#
# This guard used to compare mtime(sapphire.v) against every firmware .c/.h
# file, on the theory that a firmware source edited after the last patch run
# meant sapphire.v was stale. That heuristic is fundamentally incompatible
# with patch_sapphire_init.py's design: because the $readmemb block only
# references *bare filenames* (never the firmware bytes themselves), the
# block's text is byte-identical across every firmware rebuild. Once
# sapphire.v is patched, patch_sapphire_init.py's own logic — correctly —
# no-ops on every later run ("Already patched ... no changes needed") and
# never rewrites the file, so its mtime freezes at whatever time it was
# first patched. Any later, unrelated mtime bump on a firmware source (a
# `git pull`/checkout, `touch`, clock skew across machines, etc.) then makes
# the OLD mtime guard fail with "patch is stale" even though sapphire.v's
# content is still 100% correct — a false positive that blocks a valid
# build. The actual freshness-critical artifacts are the .bin file
# *contents*, and those are already guarded separately (by content hash) in
# scripts/check_sapphire_symbol_bins_fresh.sh. This guard's only remaining
# job is to confirm sapphire.v is in patched form at all (not virgin/stub),
# which is a content fact, not a time-based one, and can never go stale once
# true.
#
# Usage:
#   bash scripts/check_sapphire_patch_fresh.sh <sapphire.v>
#
# Exit codes:
#   0   — sapphire.v contains the canonical bare-filename $readmemb block for
#         all 4 ram_symbol lanes (patched)
#   1   — sapphire.v is virgin, stub, or only partially patched
#   2   — usage error or missing input file

set -uo pipefail

SAPPHIRE_V="${1:-}"

if [ -z "$SAPPHIRE_V" ]; then
    echo "Usage: $0 <sapphire.v>" >&2
    exit 2
fi

if [ ! -f "$SAPPHIRE_V" ]; then
    echo "ERROR: sapphire.v not found: $SAPPHIRE_V" >&2
    exit 2
fi

MISSING_LANES=()
for lane in 0 1 2 3; do
    if ! grep -qE "\\\$readmemb\\(\"EfxSapphireSoc\.v_toplevel_system_ramA_logic_ram_symbol${lane}\.bin\", *ram_symbol${lane}\\);" "$SAPPHIRE_V"; then
        MISSING_LANES+=("ram_symbol${lane}")
    fi
done

if [ "${#MISSING_LANES[@]}" -gt 0 ]; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  GUARD FAIL: sapphire.v patch is stale"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "  $SAPPHIRE_V does not contain a bare-filename \$readmemb call for:"
    for lane in "${MISSING_LANES[@]}"; do
        echo "    $lane"
    done
    echo ""
    echo "  It is still in virgin, stub, or partially-patched form. EFX_MAP"
    echo "  will embed stale or zeroed firmware bytes and the board will not boot."
    echo ""
    echo "  Run: python3 scripts/patch_sapphire_init.py"
    echo ""
    exit 1
fi

echo "  [patch-guard] sapphire.v is up-to-date (bare-filename \$readmemb block present for all 4 lanes)"
exit 0
