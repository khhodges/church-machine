#!/bin/bash
# run_efx_map.sh — Efinix synthesis for SoC+CM combined project
#
# Usage (from any directory):
#   bash ~/church-machine/hardware/soc_combined/run_efx_map.sh [PROJECT_XML]
#
# PROJECT_XML defaults to ~/church_project/SoC/church_soc_cm.xml.
# EFX_MAP uses Efinity 2025.2 (2026.1 segfaults on efx_map).
#
# The script sources Efinity's setup.sh so efx_map can find its shared
# libraries — without this it crashes with SIGSEGV immediately.

set -euo pipefail

EFINITY="${EFINITY_HOME:-$HOME/efinity/2025.2}"
EFX_MAP="$EFINITY/bin/efx_map"

# Source Efinity environment so efx_map can find libefx.so etc.
# shellcheck disable=SC1091
source "$EFINITY/bin/setup.sh" 2>/dev/null || true

# Default project: actual Efinity project in church_project/SoC_minimal/
PROJECT="${1:-$HOME/church_project/SoC_minimal/church_soc.xml}"
SOC_DIR="$(dirname "$PROJECT")"

echo "==> Synthesising $PROJECT with EFX_MAP..."
echo "    EFX_MAP:    $EFX_MAP"
echo "    Project:    $PROJECT"
echo "    Working in: $SOC_DIR"
echo ""

mkdir -p "$SOC_DIR/work_syn"
cd "$SOC_DIR"
"$EFX_MAP" --project-xml "$PROJECT" 2>&1 | tee "$SOC_DIR/work_syn/synthesis.log"
echo ""
echo "==> Synthesis complete. Output in $SOC_DIR/work_syn/"
echo "    Verify firmware embedded in BRAM:"
echo "    grep 'ram_symbol0__D\$g1' $SOC_DIR/work_syn/church_soc_cm.map.v | head -1"
