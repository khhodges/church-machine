#!/usr/bin/env bash
# scripts/check_cm_dmem_bram_fresh.sh
#
# Source-level guard: verifies church_ti60_f225.v has already been patched
# to use cm_dmem_bram (the explicit EFX_RAM10 instantiation technique from
# hardware/soc_combined/gen_cm_dmem_direct.py) before EFX_MAP synthesis runs.
#
# BACKGROUND: the older hardware/soc_combined/patch_cm_bram.py technique
# ($readmemb byte-lane declarations) is now OBSOLETE — EFX_MAP 2026.1 stores
# $readmemb INIT data only in a defparam that efx_pnr never reads, so the
# BRAM still synthesises all-zero. gen_cm_dmem_direct.py (explicit EFX_RAM10
# instances with inline INIT_N params) is the only confirmed-working
# technique, and scripts/build_ti60_bitstream.sh's Step 2.5 already runs it
# and deploys both church_ti60_f225.v and cm_dmem_bram.v into $SOC_DIR before
# run_efx_map.sh is ever invoked.
#
# Calling patch_cm_bram.py again at that point double-patches an
# already-cm_dmem_bram file: its "already patched" sentinel is a bare
# `'readmemb' in src` substring check, which false-positives on the comment
# gen_cm_dmem_direct.py leaves behind ("...bypasses $readmemb->VDB bug..."),
# then fails with "cannot parse depth" because the old dmem_b0 declarations
# it looks for no longer exist. This guard exists so that failure mode is
# caught here, with a clear message, instead of a cryptic regex error deep
# inside a legacy patcher.
#
# Usage:
#   bash scripts/check_cm_dmem_bram_fresh.sh <church_ti60_f225.v> <soc_dir>
#
# Exit codes:
#   0   — church_ti60_f225.v already uses cm_dmem_bram, and cm_dmem_bram.v
#         exists alongside it
#   1   — church_ti60_f225.v does not use cm_dmem_bram yet (Step 2.5 has not
#         run, or ran against the wrong file)
#   2   — usage error or missing input file

set -uo pipefail

CM_V="${1:-}"
SOC_DIR="${2:-}"

if [ -z "$CM_V" ] || [ -z "$SOC_DIR" ]; then
    echo "Usage: $0 <church_ti60_f225.v> <soc_dir>" >&2
    exit 2
fi

if [ ! -f "$CM_V" ]; then
    echo "ERROR: file not found: $CM_V" >&2
    exit 2
fi

if ! grep -q 'cm_dmem_bram' "$CM_V"; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  GUARD FAIL: church_ti60_f225.v does not use cm_dmem_bram"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "  $CM_V must be patched by hardware/soc_combined/gen_cm_dmem_direct.py"
    echo "  (scripts/build_ti60_bitstream.sh Step 2.5) before run_efx_map.sh runs."
    echo ""
    echo "  Re-run the build from the repo root rather than invoking run_efx_map.sh"
    echo "  directly on a file patched by the legacy patch_cm_bram.py."
    echo ""
    exit 1
fi

if [ ! -f "$SOC_DIR/cm_dmem_bram.v" ]; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  GUARD FAIL: cm_dmem_bram.v missing from $SOC_DIR"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "  Step 2.5 must generate cm_dmem_bram.v alongside the"
    echo "  church_ti60_f225.v patch."
    echo ""
    exit 1
fi

echo "  [cm-dmem-bram-guard] church_ti60_f225.v already uses cm_dmem_bram (gen_cm_dmem_direct.py)"
exit 0
