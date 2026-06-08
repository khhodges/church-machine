#!/bin/bash
# run_efx_map.sh — Efinix synthesis for SoC+CM combined project
# Run from anywhere — paths resolve relative to this script's location.
# Usage: bash hardware/soc_combined/run_efx_map.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EFINITY="${EFINITY_HOME:-$HOME/efinity/2025.2}"
EFX_MAP="$EFINITY/bin/efx_map"

PROJECT="${1:-$SCRIPT_DIR/church_soc_cm.xml}"

echo "==> Synthesising $PROJECT with EFX_MAP..."
echo "    EFX_MAP: $EFX_MAP"
echo "    Project: $PROJECT"
echo ""

mkdir -p "$SCRIPT_DIR/work_syn"
cd "$SCRIPT_DIR"
$EFX_MAP --project-xml "$PROJECT" 2>&1 | tee "$SCRIPT_DIR/work_syn/synthesis.log"
echo ""
echo "==> Synthesis complete. Output in work_syn/"
echo "    Verify firmware embedded in BRAM:"
echo "    for sym in 0 1 2 3; do"
echo "      grep \"ram_symbol\${sym}__D\\\$g1\" outflow/church_soc_cm.map.v | head -1"
echo "    done"
