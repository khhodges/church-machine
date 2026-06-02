#!/bin/bash
# run_efx_pnr.sh — Place & Route for SoC+CM combined project
# Run from the project root (the folder containing SoC/)
# Usage: bash SoC/run_efx_pnr.sh
#
# NOTE: Efinity 2025.2 with patch 2025.2.288.4.15 applied over base 2025.2.288.2.10
# crashes with "Unsupported value for family=" + SIGSEGV on every P&R run.
# Fix: upgrade to Efinity v2026.1 full release and set EFINITY_HOME:
#   EFINITY_HOME=~/efinity/2026.1 bash SoC/run_efx_pnr.sh
#
# NOTE: The Efinity GUI is not supported on Chromebook Penguin (Debian container)
# — the splash screen crashes immediately. Use headless CLI only (this script).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
EFINITY="${EFINITY_HOME:-$HOME/efinity/2026.1}"
EFX_PNR="$EFINITY/bin/efx_pnr"

PROJECT="${1:-$PROJECT_ROOT/SoC/church_soc_cm.xml}"

echo "==> Place & Route $PROJECT with EFX_PNR..."
echo "    EFX_PNR: $EFX_PNR"
echo "    Project: $PROJECT"
echo ""

mkdir -p "$PROJECT_ROOT/SoC/work_pnr"
cd "$PROJECT_ROOT/SoC"
$EFX_PNR church_soc_cm.xml church_soc_cm 2>&1 | tee "$PROJECT_ROOT/SoC/work_pnr/pnr.log"
echo ""
echo "==> Place & Route complete. Output in SoC/work_pnr/"
