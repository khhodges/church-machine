#!/bin/bash
# run_efx_pnr.sh — Place & Route for SoC+CM combined project
#
# Usage (from any directory):
#   bash ~/church-machine/hardware/soc_combined/run_efx_pnr.sh [PROJECT_XML]
#
# PROJECT_XML defaults to ~/church_project/SoC/church_soc_cm.xml.
# EFX_PNR uses Efinity 2026.1 (2025.2 segfaults on efx_pnr).
#
# IMPORTANT NOTES:
#   - efx_pnr requires explicit --family/--device flags; it does NOT auto-read
#     them from the project XML.  Omitting them causes an immediate SIGSEGV crash.
#   - Do NOT pass --use_vdb_file unless a VDB already exists from a prior run.
#   - --operating_conditions must match the XML timing_model ("C3" for Ti60F225).

set -euo pipefail

EFINITY="${EFINITY_HOME:-$HOME/efinity/2026.1}"
EFX_PNR="$EFINITY/bin/efx_pnr"

# efx_pnr checks EFINITY_HOME at startup — must be exported
export EFINITY_HOME="$EFINITY"

# Source Efinity environment so efx_pnr can find its shared libraries
# shellcheck disable=SC1091
source "$EFINITY/bin/setup.sh" 2>/dev/null || true

# Default project: actual Efinity project in church_project/SoC_minimal/
PROJECT="${1:-$HOME/church_project/SoC_minimal/church_soc.xml}"
SOC_DIR="$(dirname "$PROJECT")"
CIRCUIT="church_soc"
FAMILY="Titanium"
DEVICE="Ti60F225"
OPCOND="C3"

echo "==> Place & Route $PROJECT with EFX_PNR..."
echo "    EFX_PNR:    $EFX_PNR"
echo "    Project:    $PROJECT"
echo "    Family:     $FAMILY / $DEVICE / $OPCOND"
echo "    Working in: $SOC_DIR"
echo ""

mkdir -p "$SOC_DIR/work_pnr" "$SOC_DIR/outflow"
cd "$SOC_DIR"

"$EFX_PNR" \
    --prj            "$PROJECT" \
    --circuit        "$CIRCUIT" \
    --family         "$FAMILY" \
    --device         "$DEVICE" \
    --operating_conditions "$OPCOND" \
    --pack --place --route \
    --vdb_file       "top.vdb" \
    --work_dir       "work_pnr" \
    --output_dir     "outflow" \
    2>&1 | tee "$SOC_DIR/work_pnr/pnr.log"

echo ""
echo "==> Place & Route complete. Output in $SOC_DIR/work_pnr/ and $SOC_DIR/outflow/"
echo "    Bitstream: $SOC_DIR/outflow/${CIRCUIT}.bit  (run run_efx_pgm.sh next)"
