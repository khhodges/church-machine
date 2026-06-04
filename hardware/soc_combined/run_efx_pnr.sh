#!/bin/bash
# run_efx_pnr.sh — Place & Route for SoC+CM combined project
# Run from anywhere — paths resolve relative to this script's location.
# Usage: bash hardware/soc_combined/run_efx_pnr.sh
#
# NOTE: efx_pnr requires explicit --family/--device flags; it does NOT auto-read
# them from the project XML.  Omitting them causes an immediate SIGSEGV crash
# with "Unsupported value for family=".
#
# NOTE: The Efinity GUI is not supported on Chromebook Penguin (Debian container)
# — the splash screen crashes immediately. Use headless CLI only (this script).
#
# NOTE: Efinity 2025.2 with patch 2025.2.288.4.15 over base 2025.2.288.2.10
# crashes with the same SIGSEGV regardless of flags. Upgrade to v2026.1 full release.
#
# NOTE: Do NOT pass --use_vdb_file on unless a VDB already exists from a prior
# PNR run. efx_map (synthesis) does not produce a VDB; passing --use_vdb_file on
# with a non-existent file causes an immediate crash in libdevicedb.so.
#
# NOTE: --operating_conditions must match the XML timing_model ("C3" for Ti60F225).
# Passing "C4" causes "Unsupported value for family=" crash in libPnROpts.so.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EFINITY="${EFINITY_HOME:-$HOME/efinity/2026.1}"
EFX_PNR="$EFINITY/bin/efx_pnr"

SOC_DIR="$SCRIPT_DIR"
PROJECT="${1:-$SOC_DIR/church_soc_cm.xml}"
CIRCUIT="church_soc_cm"
FAMILY="Titanium"
DEVICE="Ti60F225"
OPCOND="C3"

echo "==> Place & Route $PROJECT with EFX_PNR..."
echo "    EFX_PNR:  $EFX_PNR"
echo "    Project:  $PROJECT"
echo "    Family:   $FAMILY / $DEVICE / $OPCOND"
echo ""

# efx_pnr checks EFINITY_HOME at startup — must be exported, not just set
export EFINITY_HOME="$EFINITY"

# Source Efinity environment so efx_pnr can find its shared libraries
# shellcheck disable=SC1091
source "$EFINITY/bin/setup.sh" 2>/dev/null || true

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
echo "==> Place & Route complete. Output in work_pnr/ and outflow/"
echo "    Bitstream: outflow/${CIRCUIT}.bit  (run run_efx_pgm.sh to produce the .hex)"
