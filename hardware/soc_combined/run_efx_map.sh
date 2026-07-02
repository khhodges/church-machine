#!/bin/bash
# run_efx_map.sh — Efinix synthesis for SoC+CM combined project
#
# Usage (from any directory):
#   bash ~/church-machine/hardware/soc_combined/run_efx_map.sh [PROJECT_XML]
#
# PROJECT_XML defaults to church_soc_cm.xml in the same directory as this script.
#
# Uses efx_run.py --flow map (NOT efx_map --project-xml directly).
# efx_run.py produces the .vdb file required by efx_pnr; bare efx_map does not.
#
# Efinity re-injects banned params into the XML on every GUI save; this script
# strips them automatically before invoking efx_run.py.
#
# Known banned params (cause EFX-0002 in 2026.1):
#   infer_clk_enable, infer_set_reset, calc_mcw, split_input_buf,
#   no_fanout_override, get_names_method, logic_opting, pack_lut_into_ram,
#   cpe_ins_register, use_cpe_for_const_0, use_cpe_for_const_1,
#   fanout_limit (renamed to --fanout-limit with hyphens)

set -euo pipefail

# ── Direct-invocation warning ────────────────────────────────────────────
# scripts/build_ti60_bitstream.sh (the One Button Build Script) exports
# _OBBS_RUN=1 immediately before calling this script, which guarantees that
# `make clean`, patch_sapphire_init.py, and gen_cm_dmem_direct.py have all
# already run in the correct order. Calling this script directly skips all
# of that — the most common failure mode is stale/zeroed BRAM init because
# firmware wasn't rebuilt or patched before synthesis. This is a warning
# only; the script still runs so legitimate manual debugging is not blocked.
if [ -z "${_OBBS_RUN:-}" ]; then
    echo ""
    echo "=================================================================="
    echo "[WARN] run_efx_map.sh invoked directly (not via build_ti60_bitstream.sh)"
    echo "[WARN] This bypasses steps normally run first by the One Button Build"
    echo "[WARN] Script. Before continuing, make sure you have already run:"
    echo "[WARN]   1. make -C firmware clean all   (rebuild firmware fresh)"
    echo "[WARN]   2. python3 scripts/patch_sapphire_init.py <sapphire.v>"
    echo "[WARN]   3. python3 hardware/soc_combined/gen_cm_dmem_direct.py <soc_dir>"
    echo "[WARN] Skipping these can silently bake stale/zeroed BRAM into the bitstream."
    echo "=================================================================="
    echo ""
fi

EFINITY="${EFINITY_HOME:-$HOME/efinity/2026.1}"
EFX_RUN_PY="$EFINITY/scripts/efx_run.py"

# Do NOT source setup.sh — it calls `exit` in non-interactive shells and
# silently kills this script before it prints anything.  Add paths directly.
export PATH="$EFINITY/bin:${PATH:-}"
export EFINITY_HOME="$EFINITY"
if [ -d "$EFINITY/lib" ]; then
    export LD_LIBRARY_PATH="$EFINITY/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi

# Default project: church_soc_cm.xml in the same directory as this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT="${1:-$SCRIPT_DIR/church_soc_cm.xml}"
SOC_DIR="$(dirname "$PROJECT")"
CIRCUIT="$(basename "$PROJECT" .xml)"

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

echo "==> Synthesising $PROJECT via efx_run.py --flow map ..."
echo "    efx_run.py: $EFX_RUN_PY"
echo "    Project:    $PROJECT"
echo "    Working in: $SOC_DIR"
echo ""

mkdir -p "$SOC_DIR/work_syn"
cd "$SOC_DIR"

# ----------------------------------------------------------------
# Step 0a: Firmware — compile and patch into sapphire.v BEFORE synthesis
#
# WHY HERE (not in run_efx_pnr.sh):
#   efx_pnr uses --vdb_file top.vdb written by efx_map.  The VDB embeds
#   BRAM INIT_ values at synthesis time; patching map.v afterward has no
#   effect on the bitstream.  Firmware must be baked in before MAP.
#
# HOW: patch_sapphire_init.py inserts $readmemb bare-filename calls into
#   sapphire.v.  gen_sapphire_symbol_bins.py writes the four lane .bin
#   files into work_syn/ (EFX_MAP resolves $readmemb relative to its
#   working directory, which is work_syn/ when --work_dir work_syn is
#   used).  This mirrors exactly what patch_cm_bram.py does for the CM
#   DMEM — bare $readmemb + files in work_syn/ is the only approach that
#   survives into BRAM INITVAL_ parameters and the VDB.
# ----------------------------------------------------------------
echo "==> Step 0a: Building Sapphire firmware (make -C firmware clean all) ..."
make -C "$SOC_DIR/firmware" clean all
echo "    ✓ Firmware compiled."
echo ""

FIRMWARE_BIN="$SOC_DIR/firmware/firmware.bin"
echo "==> Step 0a: Generating Sapphire symbol bins → work_syn/ ..."
# Files MUST go into work_syn/ — EFX_MAP resolves bare $readmemb filenames
# relative to --work_dir (work_syn/), not relative to the project root.
python3 "$SCRIPT_DIR/../../scripts/gen_sapphire_symbol_bins.py" \
    "$FIRMWARE_BIN" --out-dir "$SOC_DIR/work_syn"
echo "    ✓ Symbol bins written to work_syn/."
echo ""

echo "==> Step 0a: Patching sapphire.v with \$readmemb calls (patch_sapphire_init.py) ..."
python3 "$SCRIPT_DIR/../../scripts/patch_sapphire_init.py" \
    "$SOC_DIR/sapphire.v"
echo "--- sapphire.v initial block (verification) ---"
grep -A 6 'initial begin' "$SOC_DIR/sapphire.v" | grep -E 'readmemb|ram_symbol\[' | head -6
echo "---"
echo "    ✓ sapphire.v ready."
echo ""

# ----------------------------------------------------------------
# Step 0b: CM DMEM BRAM patch
# EFX_MAP ignores Verilog 'initial begin' assignments on inferred arrays.
# patch_cm_bram.py converts the dmem array to four byte-lane $readmemb
# declarations and writes cm_dmem_b0..b3.bin into work_syn/ so MAP reads
# the correct initial values.  Must run BEFORE efx_run.py.
# ----------------------------------------------------------------
echo "==> Step 0b: Patching CM DMEM BRAM init (patch_cm_bram.py) ..."
python3 "$SCRIPT_DIR/patch_cm_bram.py" "$SOC_DIR"
echo "    ✓ CM DMEM BRAM patched."
echo ""
echo "==> All pre-synthesis patches complete. Starting MAP synthesis now (~45 min) ..."
echo "    This step synthesises all Verilog into FPGA cells and bakes firmware into BRAM."
echo "    The terminal will be quiet for most of this time — that is normal."
echo ""

# efx_run.py --flow map runs synthesis AND writes outflow/*.vdb (required by efx_pnr).
# --work_dir sets the scratch directory; output lands in outflow/ as per the project XML.
python3 "$EFX_RUN_PY" \
    --flow map \
    --work_dir work_syn \
    --prj "$PROJECT" \
    2>&1 | tee "$SOC_DIR/work_syn/synthesis.log"

echo ""
echo "==> Synthesis complete. VDB and netlist in $SOC_DIR/outflow/"
echo "    Next: bash ~/church-machine/hardware/soc_combined/run_efx_pnr.sh $PROJECT"
echo ""
echo "    Verify BRAM init is non-zero:"
echo "    grep -m1 'INIT_0' $SOC_DIR/outflow/${CIRCUIT}.map.v 2>/dev/null | head -c 120"
