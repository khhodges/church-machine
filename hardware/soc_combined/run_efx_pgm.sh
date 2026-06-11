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

if [ ! -x "$EFINITY/bin/efx_pgm" ]; then
    echo "ERROR: efx_pgm not found at $EFINITY/bin/efx_pgm"
    echo "       Set EFINITY_HOME or install Efinity 2026.1."
    exit 1
fi

# Source Efinity environment so tools can find shared libraries
# shellcheck disable=SC1091
source "$EFINITY/bin/setup.sh" 2>/dev/null || true

# Default project: actual Efinity project in church_project/SoC_minimal/
PROJECT="${1:-$HOME/church_project/SoC_minimal/church_soc.xml}"
SOC_DIR="$(dirname "$PROJECT")"
CIRCUIT="church_soc"
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
