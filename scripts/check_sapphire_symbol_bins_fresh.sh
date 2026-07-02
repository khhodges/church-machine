#!/usr/bin/env bash
# scripts/check_sapphire_symbol_bins_fresh.sh
#
# Verifies the four Sapphire ROM $readmemb symbol-bin files present in
# <work-syn-dir> are byte-identical to the freshly-built copies in
# <repo-hw-dir> (hardware/soc_combined/), using sha256 content hashes.
#
# WHY THIS GUARD EXISTS:
# EFX_MAP resolves $readmemb bare filenames relative to --work_dir
# (work_syn/), NOT the project root and NOT hardware/soc_combined/ despite
# what patch_sapphire_init.py's own comments claim — see
# .agents/memory/efx-map-readmemb.md for the empirically-confirmed behaviour.
# The four symbol bins must therefore be copied into work_syn/ on every
# build. If a stale build's bins are left there from a previous run, EFX_MAP
# will silently embed OLD firmware bytes into the ROM while every OTHER
# freshness guard (firmware sha-sync, banner-vs-defines, sapphire.v mtime)
# still passes, because none of them inspect work_syn/ contents.
#
# Usage:
#   bash scripts/check_sapphire_symbol_bins_fresh.sh <repo-hw-dir> <work-syn-dir>
#
# Arguments:
#   repo-hw-dir    — hardware/soc_combined/ (freshly built by make -C firmware)
#   work-syn-dir   — $SOC_DIR/work_syn (EFX_MAP's --work_dir)
#
# Exit codes:
#   0   — all four symbol bins present in both dirs with identical sha256
#   1   — a bin is missing from work-syn-dir or its content differs (stale)
#   2   — usage error, missing repo-hw-dir, or repo-hw-dir itself lacks the
#         source bins (run the firmware build first)

set -uo pipefail

REPO_HW="${1:-}"
WORK_SYN="${2:-}"

if [ -z "$REPO_HW" ] || [ -z "$WORK_SYN" ]; then
    echo "Usage: $0 <repo-hw-dir> <work-syn-dir>" >&2
    exit 2
fi

if [ ! -d "$REPO_HW" ]; then
    echo "ERROR: repo hardware directory not found: $REPO_HW" >&2
    exit 2
fi

SYMBOLS=(
    "EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol0.bin"
    "EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol1.bin"
    "EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol2.bin"
    "EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol3.bin"
)

sha_of() {
    # Portable sha256: prefer sha256sum, fall back to shasum -a 256
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | awk '{print $1}'
    else
        shasum -a 256 "$1" | awk '{print $1}'
    fi
}

MISSING=()
MISMATCHES=()

for sym in "${SYMBOLS[@]}"; do
    repo_file="$REPO_HW/$sym"
    work_file="$WORK_SYN/$sym"
    if [ ! -f "$repo_file" ]; then
        echo "ERROR: $repo_file not found — run the firmware build first (make -C firmware clean all)." >&2
        exit 2
    fi
    if [ ! -f "$work_file" ]; then
        MISSING+=("$sym")
        continue
    fi
    repo_hash="$(sha_of "$repo_file")"
    work_hash="$(sha_of "$work_file")"
    if [ "$repo_hash" != "$work_hash" ]; then
        MISMATCHES+=("$sym")
    fi
done

if [ "${#MISSING[@]}" -gt 0 ] || [ "${#MISMATCHES[@]}" -gt 0 ]; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  GUARD FAIL: Sapphire symbol bins in $WORK_SYN are stale/missing"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    if [ "${#MISSING[@]}" -gt 0 ]; then
        echo "  Missing from $WORK_SYN:"
        for f in "${MISSING[@]}"; do
            echo "    $f"
        done
    fi
    if [ "${#MISMATCHES[@]}" -gt 0 ]; then
        echo "  Stale (content differs from $REPO_HW):"
        for f in "${MISMATCHES[@]}"; do
            echo "    $f"
        done
    fi
    echo ""
    echo "  EFX_MAP reads \$readmemb bare filenames relative to --work_dir"
    echo "  (work_syn/). If these bins are stale, MAP will silently embed OLD"
    echo "  firmware into the ROM even though sapphire.v itself looks correct"
    echo "  and every other freshness guard passes."
    echo ""
    echo "  Run: cp $REPO_HW/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol*.bin '$WORK_SYN/'"
    echo ""
    exit 1
fi

echo "  [sapphire-bins-guard] All 4 symbol bins in $WORK_SYN match $REPO_HW"
exit 0
