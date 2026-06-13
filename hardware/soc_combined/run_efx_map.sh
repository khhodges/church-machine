#!/bin/bash
# run_efx_map.sh — Efinix synthesis for SoC+CM combined project
#
# Usage (from any directory):
#   bash ~/church-machine/hardware/soc_combined/run_efx_map.sh [PROJECT_XML]
#
# PROJECT_XML defaults to ~/church_project/SoC_minimal/church_soc.xml.
# Efinity re-injects banned params into the XML on every GUI save; this script
# strips them automatically before invoking efx_map.
#
# Known banned params (cause EFX-0002 in 2026.1):
#   infer_clk_enable, infer_set_reset, calc_mcw, split_input_buf,
#   no_fanout_override, get_names_method, logic_opting, pack_lut_into_ram,
#   cpe_ins_register, use_cpe_for_const_0, use_cpe_for_const_1,
#   fanout_limit (renamed to --fanout-limit with hyphens)

set -euo pipefail

EFINITY="${EFINITY_HOME:-$HOME/efinity/2026.1}"
EFX_MAP="$EFINITY/bin/efx_map"

# Do NOT source setup.sh — it calls `exit` in non-interactive shells and
# silently kills this script before it prints anything.  Add paths directly.
export PATH="$EFINITY/bin:${PATH:-}"
if [ -d "$EFINITY/lib" ]; then
    export LD_LIBRARY_PATH="$EFINITY/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

# Default project: actual Efinity project in church_project/SoC_minimal/
PROJECT="${1:-$HOME/church_project/SoC_minimal/church_soc.xml}"
SOC_DIR="$(dirname "$PROJECT")"

echo "==> Stripping banned XML params from $PROJECT ..."
sed -i '/<efx:param name="infer_clk_enable"/d'    "$PROJECT"
sed -i '/<efx:param name="infer_set_reset"/d'     "$PROJECT"
sed -i '/<efx:param name="calc_mcw"/d'            "$PROJECT"
sed -i '/<efx:param name="split_input_buf"/d'     "$PROJECT"
sed -i '/<efx:param name="no_fanout_override"/d'  "$PROJECT"
sed -i '/<efx:param name="get_names_method"/d'    "$PROJECT"
sed -i '/<efx:param name="logic_opting"/d'        "$PROJECT"
sed -i '/<efx:param name="pack_lut_into_ram"/d'   "$PROJECT"
sed -i '/<efx:param name="cpe_ins_register"/d'    "$PROJECT"
sed -i '/<efx:param name="use_cpe_for_const_0"/d' "$PROJECT"
sed -i '/<efx:param name="use_cpe_for_const_1"/d' "$PROJECT"
sed -i '/<efx:param name="fanout_limit"/d'        "$PROJECT"
echo "    Done."
echo ""

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
echo "    grep 'ram_symbol0__D\$g1' $SOC_DIR/work_syn/church_soc.map.v | head -1"
