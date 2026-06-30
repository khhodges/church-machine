#!/bin/bash
# run_full_build.sh — ONE command: git pull → firmware → MAP → PNR → PGM → serve hex
#
# Run from anywhere on the droplet:
#   bash ~/church-machine/hardware/soc_combined/run_full_build.sh
#
# Takes ~75 min total (MAP 45 min + PNR 30 min + PGM <5 min).
# When done, the .hex is served on port 8888 ready to download and flash.

set -euo pipefail

# ── Locate repo root ──────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SOC_DIR="$SCRIPT_DIR"

# ── Efinity environment (all vars needed by MAP / PNR / PGM) ─────────────
EFINITY="${EFINITY_HOME:-$HOME/efinity/2026.1}"
export EFINITY_HOME="$EFINITY"
export EFINITY_USER_DIR_INI="${EFINITY_USER_DIR_INI:-$HOME/.efinity}"
export EFXPT_HOME="${EFXPT_HOME:-$EFINITY}"
export EFXPGM_HOME="${EFXPGM_HOME:-$EFINITY}"
export PATH="$EFINITY/bin:${PATH:-}"
if [ -d "$EFINITY/lib" ]; then
    export LD_LIBRARY_PATH="$EFINITY/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
fi
mkdir -p "$EFINITY_USER_DIR_INI"

START_TIME=$(date +%s)
echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   Church Machine — Full Build            ║"
echo "║   $(date)   ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── Step 1: Sync to GitHub (force — discards local Efinity GUI junk) ─────
# Plain 'git pull' fails when Efinity has written back modified XML files
# (banned params, interface changes).  We fetch + hard-reset to origin/main
# so the build always uses exactly what is on GitHub, no merge conflicts.
echo "==> [1/5] Syncing to GitHub (git fetch + reset --hard origin/main) ..."
cd "$REPO_ROOT"
git fetch origin
git reset --hard origin/main
echo "    Done. Repo is clean at: $(git log -1 --oneline)"
echo ""

# ── Step 2: Firmware (always clean rebuild — avoids git-pull timestamp trap) ──
echo "==> [2/5] Firmware — clean rebuild ..."
make -C "$SOC_DIR/firmware" clean all
echo "    Done."
echo ""

# ── Step 3: MAP — synthesis (~45 min) ────────────────────────────────────
# run_efx_map.sh bakes in:
#   • patch_cm_bram.py  (CM DMEM via $readmemb — EFX_MAP ignores initial begin)
#   • strips banned XML params (infer_clk_enable etc.)
echo "==> [3/5] MAP — synthesis (~45 min) ..."
bash "$SOC_DIR/run_efx_map.sh"
echo ""

# ── Step 4: PNR — place & route (~30 min) ────────────────────────────────
# run_efx_pnr.sh bakes in:
#   • gen_sapphire_symbol_bins.py  (firmware ELF → byte-lane .bin files)
#   • patch_mapv_init.py           (Sapphire BRAM INIT_ injection into map.v)
#   • Interface Designer           (IO placement from peri.xml)
#   • efx_pnr
echo "==> [4/5] PNR — place & route (~30 min) ..."
bash "$SOC_DIR/run_efx_pnr.sh"
echo ""

# ── Step 5: PGM — bitstream hex ──────────────────────────────────────────
echo "==> [5/5] PGM — generate hex ..."
bash "$SOC_DIR/run_efx_pgm.sh"
echo ""

# ── Done ──────────────────────────────────────────────────────────────────
END_TIME=$(date +%s)
ELAPSED=$(( END_TIME - START_TIME ))
echo "╔══════════════════════════════════════════╗"
printf "║   BUILD COMPLETE in %dm %ds              ║\n" $(( ELAPSED/60 )) $(( ELAPSED%60 ))
echo "╚══════════════════════════════════════════╝"
echo ""
HEX="$SOC_DIR/outflow/church_soc_cm.hex"
ls -lh "$HEX"
echo ""

# ── Serve hex on port 8888 ────────────────────────────────────────────────
echo "==> Serving hex on port 8888 ..."
pkill -f "http.server 8888" 2>/dev/null || true
cd "$SOC_DIR/outflow"
python3 -m http.server 8888 &
SERVER_PID=$!
echo "    Hex server PID $SERVER_PID — http://$(hostname -I | awk '{print $1}'):8888/"
echo ""
echo "On your local machine — ONE command flashes and connects to the IDE:"
DROPLET_IP="$(hostname -I | awk '{print $1}')"
echo ""
echo "  bash ~/church-machine/hardware/soc_combined/flash_and_monitor.sh"
echo ""
echo "  (downloads hex from http://${DROPLET_IP}:8888/, starts the IDE bridge,"
echo "   flashes the board, then opens  https://lab.cloomc.org  in your browser)"
echo ""
