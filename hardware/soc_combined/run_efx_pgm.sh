#!/bin/bash
# run_efx_pgm.sh — Generate SPI flash hex from the P&R bitstream
#
# Usage (from any directory):
#   bash ~/church-machine/hardware/soc_combined/run_efx_pgm.sh [PROJECT_XML]
#
# PROJECT_XML defaults to ~/church_project/SoC/church_soc_cm.xml.
# Requires Efinity 2026.1 (efx_pgm / efx_run from 2026.1 unified flow).
#
# Run AFTER run_efx_pnr.sh has completed successfully.
# Output: outflow/church_soc_cm.hex  (in the same directory as PROJECT_XML)

set -euo pipefail

EFINITY="${EFINITY_HOME:-$HOME/efinity/2026.1}"
export EFINITY_HOME="$EFINITY"
export EFINITY_USER_DIR_INI="${EFINITY_USER_DIR_INI:-$HOME/.efinity}"
# EFXPT_HOME must be $EFINITY/pt, not the plain Efinity root — matches
# Efinity's own bin/setup.sh. See run_efx_pnr.sh for the full explanation.
export EFXPT_HOME="${EFXPT_HOME:-$HOME/efinity/2026.1/pt}"
export EFXPGM_HOME="${EFXPGM_HOME:-$HOME/efinity/2026.1}"

if [ ! -x "$EFINITY/bin/efx_pgm" ]; then
    echo "ERROR: efx_pgm not found at $EFINITY/bin/efx_pgm"
    echo "       Set EFINITY_HOME or install Efinity 2026.1."
    exit 1
fi

# Do NOT source setup.sh — it calls `exit` in non-interactive shells and
# silently kills this script before it prints anything.  Add paths directly.
export PATH="$EFINITY/bin:${PATH:-}"
if [ -d "$EFINITY/lib" ]; then
    export LD_LIBRARY_PATH="$EFINITY/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

# Default project: church_soc_cm.xml in the same directory as this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="${1:-$SCRIPT_DIR/church_soc_cm.xml}"
SOC_DIR="$(dirname "$PROJECT")"
# Derive circuit name from the project XML filename (strip directory + .xml)
CIRCUIT="$(basename "$PROJECT" .xml)"
FAMILY="Titanium"
DEVICE="Ti60F225"
LBF_FILE="$SOC_DIR/work_pnr/${CIRCUIT}.lbf"
OUTDIR="$SOC_DIR/outflow"

mkdir -p "$OUTDIR"
cd "$SOC_DIR"

if [ ! -f "$LBF_FILE" ]; then
    echo "ERROR: Bitstream file not found: $LBF_FILE"
    echo "       Run run_efx_pnr.sh first to generate it."
    exit 1
fi

echo "========================================"
echo "efx_pgm — Generate SPI flash hex (Efinity 2026.1)"
echo "========================================"
echo "  Input : $LBF_FILE ($(ls -lh "$LBF_FILE" | awk '{print $5}'))"
echo "  Device: $FAMILY $DEVICE"
echo "  Output: $OUTDIR/${CIRCUIT}.hex"
echo ""

echo "==> Step 1/2: Interface Designer (generates LPF from peri.xml) ..."
"$EFINITY/bin/efx_run" "$CIRCUIT" \
    --prj \
    --flow   interface \
    --family "$FAMILY" \
    -d       "$DEVICE" \
    2>&1 | tee "$OUTDIR/interface.log"

echo ""
echo "==> Step 2/2: Bitstream generation ..."
"$EFINITY/bin/efx_run" "$CIRCUIT" \
    --prj \
    --flow   pgm \
    --family "$FAMILY" \
    -d       "$DEVICE" \
    2>&1 | tee "$OUTDIR/pgm.log"

echo ""
if [ -f "$OUTDIR/${CIRCUIT}.hex" ]; then
    echo "==> SUCCESS: Bitstream hex generated:"
    ls -lh "$OUTDIR/${CIRCUIT}.hex"
    echo ""
    echo "Flash with:"
    echo "  sudo openFPGALoader -b titanium_ti60_f225_jtag -f $OUTDIR/${CIRCUIT}.hex"
else
    echo "ERROR: $OUTDIR/${CIRCUIT}.hex not found — check $OUTDIR/pgm.log"
    exit 1
fi
