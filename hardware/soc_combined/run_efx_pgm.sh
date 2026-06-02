#!/bin/bash
# run_efx_pgm.sh — Generate SPI flash hex from the P&R bitstream (Efinity 2026.1)
#
# Run from the church_project/SoC/ directory, AFTER run_efx_pnr.sh has completed.
#
# Usage:
#   cd ~/church_project/SoC
#   bash run_efx_pgm.sh
#
# Output: outflow/church_soc_cm.hex
#
# Efinity 2026.1 note: --family Titanium must be passed explicitly.
# Omitting it yields: ERROR: Unknown device family ""

set -euo pipefail

# ── Locate Efinity ─────────────────────────────────────────────────────────────
EFINITY="${EFINITY_HOME:-$HOME/efinity/2026.1}"
export EFINITY_HOME="$EFINITY"

if [ ! -x "$EFINITY/bin/efx_pgm" ]; then
    echo "ERROR: efx_pgm not found at $EFINITY/bin/efx_pgm"
    echo "       Set EFINITY_HOME or install Efinity 2026.1."
    exit 1
fi

# Source Efinity environment (suppresses noisy libstdc++ warning)
# shellcheck disable=SC1091
source "$EFINITY/bin/setup.sh" 2>/dev/null || true

# ── Project paths ───────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOC_DIR="$SCRIPT_DIR"

cd "$SOC_DIR"

CIRCUIT="church_soc_cm"
FAMILY="Titanium"
DEVICE="Ti60F225"
LBF_FILE="work_pnr/${CIRCUIT}.lbf"
OUTDIR="outflow"

mkdir -p "$OUTDIR"

# ── Verify input exists ─────────────────────────────────────────────────────────
if [ ! -f "$LBF_FILE" ]; then
    echo "ERROR: Bitstream file not found: $LBF_FILE"
    echo "       Run run_efx_pnr.sh first to generate it."
    exit 1
fi

echo "========================================"
echo "efx_pgm — Generate SPI flash hex (2026.1 unified flow)"
echo "========================================"
echo "  Input : $LBF_FILE ($(ls -lh "$LBF_FILE" | awk '{print $5}'))"
echo "  Device: $FAMILY $DEVICE"
echo "  Output: $OUTDIR/${CIRCUIT}.hex"
echo ""

# Step 1: Interface Designer — processes peri.xml, writes the LPF that efx_pgm needs.
# In 2026.1, efx_pgm refuses to run without the Interface Designer LPF constraint file.
# efx_run --flow interface generates it headlessly from the project XML + peri.xml.
echo "==> Step 1/2: Interface Designer (generates LPF from peri.xml) ..."
"$EFINITY/bin/efx_run" "$CIRCUIT" \
    --prj \
    --flow   interface \
    --family "$FAMILY" \
    -d       "$DEVICE" \
    2>&1 | tee "$OUTDIR/interface.log"

echo ""
echo "==> Step 2/2: Bitstream generation ..."
# Step 2: Bitstream generation — now that the LPF exists efx_run calls efx_pgm internally.
"$EFINITY/bin/efx_run" "$CIRCUIT" \
    --prj \
    --flow   pgm \
    --family "$FAMILY" \
    -d       "$DEVICE" \
    2>&1 | tee "$OUTDIR/pgm.log"

echo ""
if [ -f "$OUTDIR/${CIRCUIT}.hex" ]; then
    echo "==> Bitstream hex generated successfully:"
    ls -lh "$OUTDIR/${CIRCUIT}.hex"
    echo ""
    echo "Flash with:"
    echo "  sudo ~/oss-cad-suite/bin/openFPGALoader \\"
    echo "       -b titanium_ti60_f225_jtag \\"
    echo "       -f $SOC_DIR/$OUTDIR/${CIRCUIT}.hex"
else
    echo "ERROR: $OUTDIR/${CIRCUIT}.hex not found — check $OUTDIR/pgm.log"
    exit 1
fi
