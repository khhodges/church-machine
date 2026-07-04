#!/bin/bash
# build_b4.sh — Full firmware+bitstream rebuild for Build #4 (fw v2.4)
# Run from anywhere inside the church-machine repo on the droplet.
# Usage:  bash hardware/soc_combined/build_b4.sh
# Takes ~90 minutes.  Run inside tmux so you can detach.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SOC="$REPO/hardware/soc_combined"
FW="$SOC/firmware"
SCRIPTS="$REPO/scripts"

export EFINITY_HOME="${EFINITY_HOME:-$HOME/efinity/2026.1}"
export EFINITY_USER_DIR_INI="${EFINITY_USER_DIR_INI:-$HOME/.efinity}"
# EFXPT_HOME must be $EFINITY_HOME/pt, not the plain Efinity root — matches
# Efinity's own bin/setup.sh. See run_efx_pnr.sh for the full explanation.
export EFXPT_HOME="$EFINITY_HOME/pt"
export EFXPGM_HOME="$EFINITY_HOME"
export PATH="$EFINITY_HOME/bin:$EFINITY_HOME/scripts:$PATH"
export LD_LIBRARY_PATH="$EFINITY_HOME/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"

echo "=== Build #4 (fw v2.4) — $(date) ==="
echo "REPO  : $REPO"
echo "EFINITY: $EFINITY_HOME"
echo ""

# -- Step 1: git pull ---------------------------------------------------------
echo "--- Step 1: git pull ---"
cd "$REPO"
git pull
grep 'FW_MINOR' hardware/soc_combined/firmware/main.c | head -1
echo ""

# -- Step 2: Rebuild firmware + BRAM symbol files ----------------------------
echo "--- Step 2: Rebuild firmware ---"
make -C "$FW" clean
make -C "$FW"
ls -lh "$SOC"/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol?.bin
echo ""

# -- Step 3: Patch sapphire.v -------------------------------------------------
echo "--- Step 3: Patch sapphire.v ---"
python3 "$SCRIPTS/patch_sapphire_init.py" \
    "$SOC/sapphire.v" \
    "$SOC/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol0.bin" \
    "$SOC/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol1.bin" \
    "$SOC/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol2.bin" \
    "$SOC/EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol3.bin"
echo ""

# -- Step 4: Strip banned Efinity XML params ----------------------------------
echo "--- Step 4: Strip banned XML params ---"
sed -i \
  's/infer_set_reset" value="[^"]*"/infer_set_reset" value="0"/g;
   s/infer_clk_enable" value="[^"]*"/infer_clk_enable" value="0"/g' \
  "$SOC/church_soc_cm.xml"
grep -c 'infer_set_reset\|infer_clk_enable' "$SOC/church_soc_cm.xml" && \
  echo "WARNING: banned params still present — check manually" || \
  echo "OK: no banned params"
echo ""

# -- Step 5: MAP (synthesis) --------------------------------------------------
echo "--- Step 5: MAP (synthesis) — $(date) ---"
cd "$SOC"
bash run_efx_map.sh 2>&1 | tee /tmp/map_b4.log
echo "MAP done: $(date)"
echo ""

# -- Step 6: PNR (place & route) ----------------------------------------------
echo "--- Step 6: PNR (place & route) — $(date) ---"
bash run_efx_pnr.sh 2>&1 | tee /tmp/pnr_b4.log
echo "PNR done: $(date)"
echo ""

# -- Step 7: PGM (generate hex) -----------------------------------------------
echo "--- Step 7: PGM (generate hex) — $(date) ---"
bash run_efx_pgm.sh 2>&1 | tee /tmp/pgm_b4.log
echo ""

# -- Done ---------------------------------------------------------------------
HEX="$SOC/outflow/church_soc_cm.hex"
if [ -f "$HEX" ]; then
    ls -lh "$HEX"
    echo ""
    echo "=== Build #4 COMPLETE — $(date) ==="
    echo ""
    echo "Serve hex:"
    echo "  python3 -m http.server 8888 --directory $SOC/outflow"
    echo ""
    echo "Flash (from Chromebook):"
    echo "  wget http://165.227.190.84:8888/church_soc_cm.hex -O ~/Downloads/church_soc_cm_b4.hex"
    echo "  sudo openFPGALoader -b titanium_ti60_f225_jtag --external-flash -f ~/Downloads/church_soc_cm_b4.hex"
else
    echo "ERROR: hex not found at $HEX"
    echo "Check /tmp/pgm_b4.log"
    exit 1
fi
