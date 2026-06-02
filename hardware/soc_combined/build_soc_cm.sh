#!/bin/bash
# build_soc_cm.sh — Full SoC+CM rebuild from the ZIP distribution
# Run this from the project root (the folder containing SoC/).
# It does Steps 1–5 of Case 3 (IP copy, firmware build, patch).
# After it finishes, run: bash SoC/run_efx_map.sh
#
# Prerequisites:
#   • Efinity 2026.1 at ~/efinity/2026.1
#   • Efinity RISC-V toolchain at ~/efinity/efinity-riscv-ide-2026.1/toolchain/bin
#   • patch_sapphire_init.py in ~/church-machine/scripts/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# Script lives in SoC/; project root is the parent
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
EFINITY="${EFINITY_HOME:-$HOME/efinity/2026.1}"
CHIPKIT="${CHIPKIT_HOME:-$HOME/efinity/efinity-riscv-ide-2026.1}"
# Patch script: prefer local project scripts/, fall back to church-machine repo
if [ -d "$PROJECT_ROOT/scripts" ]; then
    CHURCH_SCRIPTS="$PROJECT_ROOT/scripts"
else
    CHURCH_SCRIPTS="${CHURCH_MACHINE:-$HOME/church-machine}/scripts"
fi

SOC_DIR="$PROJECT_ROOT/SoC"

echo "========================================"
echo "SoC+CM Full Rebuild Script"
echo "========================================"
echo ""

# ---- Step 1: Copy Sapphire IP files ----
echo "==> Step 1: Copy Sapphire IP files"
SAPPHIRE_IP="$EFINITY/ipm/ip/efx_tsemac/fpga/Ti60F225_devkit/ip/sapphire"
if [ ! -f "$SOC_DIR/sapphire.v" ]; then
    if [ -f "$SAPPHIRE_IP/sapphire.v" ]; then
        cp "$SAPPHIRE_IP/sapphire.v" "$SOC_DIR/"
        cp "$SAPPHIRE_IP/sapphire_define.vh" "$SOC_DIR/"
        echo "    OK — copied sapphire.v and sapphire_define.vh"
    else
        echo "    ERROR: sapphire.v not found at $SAPPHIRE_IP"
        echo "    Fix: find ~/efinity -name 'sapphire.v' 2>/dev/null"
        exit 1
    fi
else
    echo "    SKIP — sapphire.v already present"
fi

# ---- Step 1b: Copy pre-built CM RTL ----
# ---- Step 1c: Copy peri.xml (periphery constraints) ----
if [ -f "$PROJECT_ROOT/church_ti60_f225.peri.xml" ]; then
    cp "$PROJECT_ROOT/church_ti60_f225.peri.xml" "$SOC_DIR/church_soc_cm.peri.xml"
    # Fix design name to match project name
    sed -i 's/name="church_ti60_f225"/name="church_soc_cm"/' "$SOC_DIR/church_soc_cm.peri.xml"
    echo "    OK — copied peri.xml to church_soc_cm.peri.xml (design name fixed)"
else
    echo "    WARNING: church_ti60_f225.peri.xml not found at project root"
fi

# ---- Step 1d: Copy pre-built CM RTL ----
echo ""
echo "==> Step 1b: Copy pre-built CM RTL"
if [ -f "$PROJECT_ROOT/church_ti60_f225.v" ]; then
    cp "$PROJECT_ROOT/church_ti60_f225.v" "$SOC_DIR/"
    echo "    OK — copied church_ti60_f225.v from project root"
else
    echo "    WARNING: church_ti60_f225.v not found at project root"
fi

# ---- Step 2: Generate CM RTL (optional, only if gen_verilog.py available) ----
echo ""
echo "==> Step 2: Generate CM RTL (if Amaranth available)"
if [ -f "$PROJECT_ROOT/../hardware/gen_verilog.py" ]; then
    (cd "$PROJECT_ROOT/.." && python3 -m hardware.gen_verilog.py --ti60)
    cp "$PROJECT_ROOT/../build/church_ti60_f225.v" "$SOC_DIR/"
    echo "    OK — generated church_ti60_f225.v"
else
    echo "    SKIP — gen_verilog.py not found (use pre-built church_ti60_f225.v)"
fi

# ---- Step 3: Build firmware ----
echo ""
echo "==> Step 3: Build SoC firmware"
if [ -f "$CHIPKIT/toolchain/bin/riscv-none-embed-gcc" ]; then
    make -C "$SOC_DIR/firmware" clean
    make -C "$SOC_DIR/firmware"
    echo "    OK — firmware built"
else
    echo "    ERROR: RISC-V toolchain not found at $CHIPKIT/toolchain/bin/"
    echo "    Fix: install Efinity RISC-V IDE 2026.1"
    exit 1
fi

# ---- Step 4: Patch sapphire.v with firmware ----
echo ""
echo "==> Step 4: Patch sapphire.v with firmware inline assignments"
if [ -f "$CHURCH_SCRIPTS/patch_sapphire_init.py" ]; then
    python3 "$CHURCH_SCRIPTS/patch_sapphire_init.py" \
        "$SOC_DIR/sapphire.v" \
        "$SOC_DIR/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol0.bin" \
        "$SOC_DIR/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol1.bin" \
        "$SOC_DIR/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol2.bin" \
        "$SOC_DIR/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol3.bin"
    echo "    OK — sapphire.v patched"
else
    echo "    ERROR: patch_sapphire_init.py not found at $CHURCH_SCRIPTS/"
    echo "    Fix: clone the church-machine repo or adjust CHURCH_MACHINE env var"
    exit 1
fi

# ---- Step 5: Verify optimize-zero-init-rom is off ----
echo ""
echo "==> Step 5: Verify optimize-zero-init-rom = 0"
if grep -q 'optimize-zero-init-rom" value="0"' "$SOC_DIR/church_soc_cm.xml"; then
    echo "    OK — optimize-zero-init-rom is 0"
else
    echo "    ERROR: optimize-zero-init-rom is not 0 in $SOC_DIR/church_soc_cm.xml"
    echo "    Fix: edit the XML or re-download the ZIP"
    exit 1
fi

# ---- Summary ----
echo ""
echo "========================================"
echo "Steps 1–5 complete."
echo ""
echo "Next: run synthesis"
echo "    bash SoC/run_efx_map.sh"
echo ""
echo "Then: place & route"
echo "    bash SoC/run_efx_pnr.sh"
echo ""
echo "Then: generate hex"
echo "    cd SoC && ~/efinity/2026.1/bin/efx_pgm"
echo ""
echo "Then: flash"
echo "    sudo ~/oss-cad-suite/bin/openFPGALoader -b titanium_ti60_f225_jtag -f SoC/outflow/church_soc_cm.hex"
echo "========================================"
