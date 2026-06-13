#!/bin/bash
# run_efx_pnr.sh — Interface Designer + Place & Route for SoC+CM combined project
#
# Usage (from any directory):
#   bash ~/church-machine/hardware/soc_combined/run_efx_pnr.sh [PROJECT_XML]
#
# PROJECT_XML defaults to ~/church_project/SoC_minimal/church_soc.xml.
# EFX_PNR uses Efinity 2026.1 (2025.2 segfaults on efx_pnr).
#
# IMPORTANT NOTES:
#   - Interface Designer MUST run before efx_pnr to generate the LPF from
#     peri.xml; without it, IO pins (clk, uart_tx, LEDs) are placed randomly.
#   - efx_pnr requires explicit --family/--device flags; it does NOT auto-read
#     them from the project XML.  Omitting them causes an immediate SIGSEGV crash.
#   - Do NOT pass --use_vdb_file unless a VDB already exists from a prior run.
#   - --operating_conditions must match the XML timing_model ("C3" for Ti60F225).

set -euo pipefail

EFINITY="${EFINITY_HOME:-$HOME/efinity/2026.1}"
EFX_PNR="$EFINITY/bin/efx_pnr"
EFX_RUN="$EFINITY/bin/efx_run"

# efx_pnr checks EFINITY_HOME at startup — must be exported
export EFINITY_HOME="$EFINITY"

# Do NOT source setup.sh — it calls `exit` in non-interactive shells and
# silently kills this script before it prints anything.  Add paths directly.
export PATH="$EFINITY/bin:${PATH:-}"
if [ -d "$EFINITY/lib" ]; then
    export LD_LIBRARY_PATH="$EFINITY/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

# Default project: actual Efinity project in church_project/SoC_minimal/
PROJECT="${1:-$HOME/church_project/SoC_minimal/church_soc.xml}"
SOC_DIR="$(dirname "$PROJECT")"
# Derive circuit name from the project XML filename (strip directory + .xml)
CIRCUIT="$(basename "$PROJECT" .xml)"
FAMILY="Titanium"
DEVICE="Ti60F225"
OPCOND="C3"

mkdir -p "$SOC_DIR/work_pnr" "$SOC_DIR/outflow"
cd "$SOC_DIR"

# ----------------------------------------------------------------
# Step 0: Interface Designer
# Reads peri.xml → writes IO placement into the project database
# and generates outflow/church_soc.lpf.
# This MUST happen before efx_pnr so IO cells are not randomly placed.
# ----------------------------------------------------------------
echo "==> Step 0/2: Interface Designer (IO placement from peri.xml) ..."
"$EFX_RUN" "$CIRCUIT" \
    --prj \
    --flow   interface \
    --family "$FAMILY" \
    -d       "$DEVICE" \
    2>&1 | tee "$SOC_DIR/outflow/interface.log"
echo "    LPF: $SOC_DIR/outflow/${CIRCUIT}.lpf"
echo ""

# ----------------------------------------------------------------
# Step 1/2: Place & Route
# ----------------------------------------------------------------
echo "==> Step 1/2: Place & Route  ($PROJECT) ..."
echo "    EFX_PNR: $EFX_PNR"
echo "    Family:  $FAMILY / $DEVICE / $OPCOND"
echo ""

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
