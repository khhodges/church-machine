#!/bin/bash
# prep_ide_synthesis.sh — Compile firmware and patch sapphire.v so that
# opening church_soc_cm.xml in the Efinity IDE and clicking Run Synthesis
# produces a working bitstream with real RISC-V firmware in BRAM.
#
# Run this ONCE from inside the extracted ZIP directory before using the IDE.
# After the firmware changes, re-run it before re-synthesising.
#
# Requirements:
#   - Efinity RISC-V IDE 2025.2 at ~/efinity/efinity-riscv-ide-2025.2/
#     (or set TOOLCHAIN= to override)
#   - Python 3 (for patch_sapphire_init.py)
#
# Usage:
#   bash prep_ide_synthesis.sh
#   bash prep_ide_synthesis.sh TOOLCHAIN=/opt/riscv/bin

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Parse optional TOOLCHAIN= argument ──────────────────────────────────────
for arg in "$@"; do
    if [[ "$arg" == TOOLCHAIN=* ]]; then
        export TOOLCHAIN="${arg#TOOLCHAIN=}"
    fi
done

echo "========================================"
echo "prep_ide_synthesis.sh"
echo "Firmware compile + sapphire.v BRAM patch"
echo "========================================"
echo ""

# ── Step 1: Compile RISC-V firmware ─────────────────────────────────────────
echo "==> Step 1: Compiling RISC-V firmware ..."
echo ""

TOOLCHAIN="${TOOLCHAIN:-$HOME/efinity/efinity-riscv-ide-2025.2/toolchain/bin}"

if [ ! -f "$TOOLCHAIN/riscv-none-embed-gcc" ]; then
    # Try alternate toolchain names
    for alt in \
        "$HOME/efinity/efinity-riscv-ide-2025.2/toolchain/bin" \
        "$HOME/efinity/efinity-riscv-ide-2026.1/toolchain/bin" \
        "$HOME/efinity/riscv-toolchain/bin"
    do
        if [ -f "$alt/riscv-none-embed-gcc" ]; then
            TOOLCHAIN="$alt"
            break
        fi
    done
fi

if [ ! -f "$TOOLCHAIN/riscv-none-embed-gcc" ]; then
    echo "ERROR: RISC-V toolchain not found."
    echo ""
    echo "Expected: $TOOLCHAIN/riscv-none-embed-gcc"
    echo ""
    echo "Install the Efinity RISC-V IDE from:"
    echo "  https://www.efinixinc.com/support/efinity.php"
    echo ""
    echo "Or specify your toolchain path:"
    echo "  bash prep_ide_synthesis.sh TOOLCHAIN=/path/to/riscv/bin"
    exit 1
fi

echo "    Toolchain: $TOOLCHAIN"
make -C "$SCRIPT_DIR/firmware" TOOLCHAIN="$TOOLCHAIN"
echo ""

# ── Step 2: Patch sapphire.v BRAM with compiled firmware ────────────────────
echo "==> Step 2: Patching sapphire.v with compiled firmware bytes ..."
echo ""

SYM_PREFIX="$SCRIPT_DIR/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol"

python3 "$SCRIPT_DIR/scripts/patch_sapphire_init.py" \
    "$SCRIPT_DIR/sapphire.v" \
    "${SYM_PREFIX}0.bin" \
    "${SYM_PREFIX}1.bin" \
    "${SYM_PREFIX}2.bin" \
    "${SYM_PREFIX}3.bin"

echo ""
echo "========================================"
echo "prep_ide_synthesis.sh COMPLETE"
echo ""
echo "sapphire.v is now patched with real firmware."
echo ""
echo "You can now either:"
echo "  Open church_soc_cm.xml in Efinity IDE and click Run Synthesis"
echo "  OR:  make bitstream   (runs all 6 steps including PnR + hex)"
echo ""
echo "After synthesis, flash with:  make flash"
echo "========================================"
