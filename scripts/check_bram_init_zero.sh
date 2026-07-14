#!/usr/bin/env bash
# scripts/check_bram_init_zero.sh
#
# Post-synthesis INIT_0 guard: inspects the EFX_MAP output file (*.map.v) and
# fails if all four Sapphire firmware BRAM lanes show all-zero INIT_0 values.
#
# Also performs a content spot-check: extracts the first byte from each lane's
# compiled symbol file (work_syn/*.bin) and verifies it matches the LSB of
# the corresponding BRAM's INIT_0 block in map.v.  This catches the case where
# synthesis embedded a PREVIOUS firmware version (non-zero but stale content).
#
# When patch_sapphire_init.py was not run before synthesis, EFX_MAP produces
# EFX_RAM10 instances with INIT_0 = "000...000" (all zeros).  The board
# appears to boot but the RISC-V SoC firmware never executes.  This guard
# catches that before Place & Route wastes another 5+ minutes.
#
# Usage:
#   bash scripts/check_bram_init_zero.sh <map.v> [work_syn_dir]
#
# Arguments:
#   map.v        — path to the EFX_MAP output file (e.g. outflow/church_soc_cm.map.v)
#   work_syn_dir — optional: path to work_syn/ containing compiled symbol .bin files
#                  (used for content spot-check; omit to skip content check)
#
# Exit codes:
#   0   — all checks pass (non-zero INIT_0 and content matches compiled firmware)
#   1   — all four lanes have all-zero INIT_0 (firmware NOT embedded → abort P&R)
#   2   — usage error, missing file, or ram_symbol instances not found in map.v
#   3   — content mismatch: non-zero INIT_0 but does not match compiled symbol files
#         (wrong firmware version baked into bitstream — rebuild recommended)

set -uo pipefail

MAP_V="${1:-}"
WORK_SYN="${2:-}"

if [ -z "$MAP_V" ]; then
    echo "Usage: $0 <map.v> [work_syn_dir]" >&2
    exit 2
fi

if [ ! -f "$MAP_V" ]; then
    echo "ERROR: map.v not found: $MAP_V" >&2
    exit 2
fi

ALL_ZERO=1
FOUND_ANY=0
LANE_RESULTS=()
HEX_VALS=()

SYM_PREFIX="EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol"

for SYM in 0 1 2 3; do
    LINENUM=$(grep -n "EFX_RAM10" "$MAP_V" | grep "ram_symbol${SYM}" | head -1 | cut -d: -f1 || true)
    if [ -z "$LINENUM" ]; then
        LANE_RESULTS+=("  symbol${SYM}: NOT FOUND in map.v (EFX_RAM10+ram_symbol${SYM})")
        HEX_VALS+=("")
        continue
    fi
    FOUND_ANY=1

    INST_NAME=$(sed -n "${LINENUM}p" "$MAP_V" | grep -oE '\\[^ ]+ram_symbol'"${SYM}"'[^ ]*' | head -1 || true)

    INIT0=$(sed -n "${LINENUM},$((LINENUM+6))p" "$MAP_V" | grep "INIT_0" | head -1 || true)
    if [ -z "$INIT0" ]; then
        LANE_RESULTS+=("  symbol${SYM}: INIT_0 line not found near EFX_RAM10 instance${INST_NAME:+ ($INST_NAME)}")
        HEX_VALS+=("")
        continue
    fi

    HEX_VAL=$(echo "$INIT0" | grep -oE '"[0-9a-fA-F]+"' | tr -d '"' | head -1 || true)

    if [ -z "$HEX_VAL" ]; then
        LITERAL=$(echo "$INIT0" | grep -oE "INIT_0=[0-9]+'[a-zA-Z][0-9a-fA-FxXzZ_]+" | head -1 || true)
        if [ -n "$LITERAL" ]; then
            HEX_VAL=$(echo "$LITERAL" | sed -E "s/^INIT_0=[0-9]+'[a-zA-Z]//" | tr -d '_')
        fi
    fi

    if [ -z "$HEX_VAL" ]; then
        LANE_RESULTS+=("  symbol${SYM}: could not parse INIT_0 value from line")
        HEX_VALS+=("")
        continue
    fi

    HEX_VALS+=("$HEX_VAL")

    if echo "$HEX_VAL" | grep -qE '^0+$'; then
        LANE_RESULTS+=("  symbol${SYM}: INIT_0 = ${HEX_VAL:0:16}... (ALL ZERO)${INST_NAME:+ [$INST_NAME]}")
    else
        LANE_RESULTS+=("  symbol${SYM}: INIT_0 = ${HEX_VAL:0:16}... (non-zero ✓)${INST_NAME:+ [$INST_NAME]}")
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

# ── Content spot-check ──────────────────────────────────────────────────────
# Efinity 2026.1 stores INIT_0 MSB-first: the LAST 2 hex chars of the 64-char
# INIT_0 string = word 0, bits[7:0] of that lane = first line of symbol*.bin.
# Verify that all four lanes' word-0 bytes match the compiled symbol files.
CONTENT_FAIL=0
if [ -n "$WORK_SYN" ] && [ -d "$WORK_SYN" ]; then
    echo ""
    echo "  [bram-guard] Content spot-check (INIT_0 word-0 LSB vs compiled symbol files):"
    for SYM in 0 1 2 3; do
        BIN_FILE="$WORK_SYN/${SYM_PREFIX}${SYM}.bin"
        HEX_VAL="${HEX_VALS[$SYM]:-}"
        if [ -z "$HEX_VAL" ] || [ ${#HEX_VAL} -lt 2 ]; then
            echo "    symbol${SYM}: skipped (no INIT_0 value)"
            continue
        fi
        if [ ! -f "$BIN_FILE" ]; then
            echo "    symbol${SYM}: skipped (symbol file not found: $BIN_FILE)"
            continue
        fi

        # Last 2 hex chars of INIT_0 = word-0 byte for this lane
        INIT_BYTE_HEX="${HEX_VAL: -2}"
        INIT_BYTE_HEX=$(echo "$INIT_BYTE_HEX" | tr 'A-F' 'a-f')

        # First line of symbol*.bin = 8-char binary string for word-0 byte
        BIN_LINE=$(head -1 "$BIN_FILE" 2>/dev/null | tr -d '[:space:]' || true)
        if [ ${#BIN_LINE} -ne 8 ]; then
            echo "    symbol${SYM}: skipped (unexpected bin line format: '$BIN_LINE')"
            continue
        fi
        # Convert binary string to hex byte
        BIN_BYTE_HEX=$(python3 -c "print(format(int('$BIN_LINE', 2), '02x'))" 2>/dev/null || true)
        if [ -z "$BIN_BYTE_HEX" ]; then
            echo "    symbol${SYM}: skipped (binary-to-hex conversion failed)"
            continue
        fi

        if [ "$INIT_BYTE_HEX" = "$BIN_BYTE_HEX" ]; then
            echo "    symbol${SYM}: word-0 byte 0x${BIN_BYTE_HEX} matches compiled firmware ✓"
        else
            echo "    symbol${SYM}: MISMATCH — BRAM=0x${INIT_BYTE_HEX}  compiled=0x${BIN_BYTE_HEX}  ← STALE FIRMWARE"
            CONTENT_FAIL=1
        fi
    done

    if [ "$CONTENT_FAIL" -eq 1 ]; then
        echo ""
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo "  GUARD FAIL: BRAM content does not match compiled firmware"
        echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
        echo ""
        echo "  The synthesised BRAM has non-zero data but it does NOT match"
        echo "  the symbol files in $WORK_SYN."
        echo "  Most likely cause: synthesis used stale/cached symbol files"
        echo "  from a previous firmware version."
        echo ""
        echo "  Fix:"
        echo "    1. Delete $WORK_SYN/*.bin"
        echo "    2. Re-run make -C hardware/soc_combined/firmware"
        echo "    3. Copy new symbol bins to $WORK_SYN"
        echo "    4. Re-run MAP synthesis (delete VDB first)"
        echo ""
        exit 3
    fi
fi

echo "  [bram-guard] Firmware confirmed embedded — P&R can proceed."
exit 0
