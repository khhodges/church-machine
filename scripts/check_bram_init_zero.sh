#!/usr/bin/env bash
# scripts/check_bram_init_zero.sh
#
# Post-synthesis INIT_0 guard: inspects the EFX_MAP output file (*.map.v) and
# fails if all four Sapphire firmware BRAM lanes show all-zero INIT_0 values.
#
# When patch_sapphire_init.py was not run before synthesis, EFX_MAP produces
# EFX_RAM10 instances with INIT_0 = "000...000" (all zeros).  The board
# appears to boot but the RISC-V SoC firmware never executes.  This guard
# catches that before Place & Route wastes another 5+ minutes.
#
# Usage:
#   bash scripts/check_bram_init_zero.sh <map.v>
#
# Arguments:
#   map.v   — path to the EFX_MAP output file (e.g. outflow/church_soc_cm.map.v)
#
# Exit codes:
#   0   — at least one lane has a non-zero INIT_0 (firmware appears embedded)
#   1   — all four lanes have all-zero INIT_0 (firmware NOT embedded → abort P&R)
#   2   — usage error, missing file, or ram_symbol instances not found in map.v

set -uo pipefail

MAP_V="${1:-}"

if [ -z "$MAP_V" ]; then
    echo "Usage: $0 <map.v>" >&2
    exit 2
fi

if [ ! -f "$MAP_V" ]; then
    echo "ERROR: map.v not found: $MAP_V" >&2
    exit 2
fi

ALL_ZERO=1
FOUND_ANY=0
LANE_RESULTS=()

for SYM in 0 1 2 3; do
    LINENUM=$(grep -n "EFX_RAM10" "$MAP_V" | grep "ram_symbol${SYM}" | head -1 | cut -d: -f1 || true)
    if [ -z "$LINENUM" ]; then
        LANE_RESULTS+=("  symbol${SYM}: NOT FOUND in map.v")
        continue
    fi
    FOUND_ANY=1

    INIT0=$(sed -n "${LINENUM},$((LINENUM+6))p" "$MAP_V" | grep "INIT_0" | head -1 || true)
    if [ -z "$INIT0" ]; then
        LANE_RESULTS+=("  symbol${SYM}: INIT_0 line not found near EFX_RAM10 instance")
        continue
    fi

    # Format A (older Efinity map.v / test fixtures): INIT_0("0000...") or INIT_0="0000..."
    HEX_VAL=$(echo "$INIT0" | grep -oE '"[0-9a-fA-F]+"' | tr -d '"' | head -1 || true)

    if [ -z "$HEX_VAL" ]; then
        # Format B (Efinity 2026.1 verific netlist comment): INIT_0=256'h0000... (unquoted
        # sized Verilog literal, e.g. 'h, 'b, 'o — radix letter immediately follows the tick).
        LITERAL=$(echo "$INIT0" | grep -oE "INIT_0=[0-9]+'[a-zA-Z][0-9a-fA-FxXzZ_]+" | head -1 || true)
        if [ -n "$LITERAL" ]; then
            HEX_VAL=$(echo "$LITERAL" | sed -E "s/^INIT_0=[0-9]+'[a-zA-Z]//" | tr -d '_')
        fi
    fi

    if [ -z "$HEX_VAL" ]; then
        LANE_RESULTS+=("  symbol${SYM}: could not parse INIT_0 value from: $INIT0")
        continue
    fi

    if echo "$HEX_VAL" | grep -qE '^0+$'; then
        LANE_RESULTS+=("  symbol${SYM}: INIT_0 = ${HEX_VAL:0:16}... (ALL ZERO)")
    else
        LANE_RESULTS+=("  symbol${SYM}: INIT_0 = ${HEX_VAL:0:16}... (non-zero ✓)")
        ALL_ZERO=0
    fi
done

if [ "$FOUND_ANY" -eq 0 ]; then
    echo ""
    echo "  [bram-guard] WARNING: No ram_symbol{0..3} EFX_RAM10 instances found in $MAP_V"
    echo "  Instance naming may differ in this Efinity version — skipping BRAM check."
    exit 2
fi

echo ""
echo "  [bram-guard] BRAM INIT_0 scan of $(basename "$MAP_V"):"
for line in "${LANE_RESULTS[@]}"; do
    echo "$line"
done

if [ "$ALL_ZERO" -eq 1 ]; then
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  GUARD FAIL: all BRAM INIT_0 lanes are zero"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo "  EFX_MAP synthesised the firmware BRAM with all-zero content."
    echo "  This means patch_sapphire_init.py was not run before synthesis,"
    echo "  or the patched sapphire.v was not copied to the Efinity project"
    echo "  directory before running efx_map."
    echo ""
    echo "  If you continue to P&R, the flashed board will not boot."
    echo ""
    echo "  Run: python3 scripts/patch_sapphire_init.py"
    echo ""
    exit 1
fi

echo "  [bram-guard] Firmware confirmed embedded — P&R can proceed."
exit 0
