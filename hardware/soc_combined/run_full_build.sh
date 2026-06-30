#!/bin/bash
# run_full_build.sh — ONE command: git pull → firmware → MAP → PNR → PGM → serve hex
#
# Run from anywhere on the droplet:
#   bash ~/church-machine/hardware/soc_combined/run_full_build.sh
#
# First time on a fresh droplet (repo not yet cloned):
#   git clone https://github.com/khhodges/church-machine.git ~/church-machine \
#     && bash ~/church-machine/hardware/soc_combined/run_full_build.sh
#
# Takes ~75 min total (MAP 45 min + PNR 30 min + PGM <5 min).
# When done, the .hex is served on port 8888 ready to download and flash.

set -euo pipefail

# ── Auto-tmux — run inside a persistent session so the terminal never locks ──
# Detach any time with Ctrl+B, D.  Reattach with:  tmux attach -t church-build
# Skip if already inside tmux, or if NO_TMUX=1 is set.
if [ -z "${TMUX:-}" ] && [ "${NO_TMUX:-0}" = "0" ] && command -v tmux &>/dev/null; then
    SESSION="church-build"
    if tmux has-session -t "$SESSION" 2>/dev/null; then
        echo "==> Attaching to existing tmux session '$SESSION' ..."
        exec tmux attach -t "$SESSION"
    fi
    echo "==> Launching inside tmux session '$SESSION' (detach: Ctrl+B, D) ..."
    exec tmux new-session -s "$SESSION" \
        "export _CHURCH_BOOTSTRAPPED=${_CHURCH_BOOTSTRAPPED:-0}; export NO_TMUX=1; bash '${BASH_SOURCE[0]}' $*; echo ''; echo 'Build finished — press Enter to close.'; read"
fi

# ── Self-bootstrap ────────────────────────────────────────────────────────────
# If this script is stale, pull latest from GitHub and re-exec the new version
# before touching Efinity.  The guard variable prevents an infinite re-exec loop.
if [ "${_CHURCH_BOOTSTRAPPED:-0}" = "0" ]; then
    _SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"
    _ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
    echo "==> Bootstrap: pulling latest code from GitHub ..."
    cd "$_ROOT"
    git fetch origin
    git reset --hard origin/main
    echo "    Repo is now at: $(git log -1 --oneline)"
    echo "==> Re-launching updated script ..."
    echo ""
    export _CHURCH_BOOTSTRAPPED=1
    exec bash "$_SELF" "$@"
fi

# ── Locate repo root ──────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SOC_DIR="$SCRIPT_DIR"

# ── Efinity environment (all vars needed by MAP / PNR / PGM) ─────────────────
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
echo "    Repo: $(cd "$REPO_ROOT" && git log -1 --oneline)"
echo ""

# ── Step 1: Confirm repo state (bootstrap already synced above) ───────────────
echo "==> [1/5] Repo synced in bootstrap — $(cd "$REPO_ROOT" && git log -1 --oneline)"
echo ""

# ── Step 2: Firmware (always clean rebuild — avoids git-pull timestamp trap) ──
echo "==> [2/5] Firmware — clean rebuild ..."
make -C "$SOC_DIR/firmware" clean all
echo "    Done."
echo ""

# ── Step 3: MAP — synthesis (~45 min) ────────────────────────────────────────
# run_efx_map.sh bakes in:
#   • patch_cm_bram.py  (CM DMEM via $readmemb — EFX_MAP ignores initial begin)
#   • strips banned XML params (infer_clk_enable etc.)
echo "==> [3/5] MAP — synthesis (~45 min) ..."
bash "$SOC_DIR/run_efx_map.sh"
echo ""

# ── Step 4: PNR — place & route (~30 min) ────────────────────────────────────
# run_efx_pnr.sh bakes in:
#   • gen_sapphire_symbol_bins.py  (firmware ELF → byte-lane .bin files)
#   • patch_mapv_init.py           (Sapphire BRAM INIT_ injection into map.v)
#   • Interface Designer           (IO placement from peri.xml)
#   • efx_pnr
echo "==> [4/5] PNR — place & route (~30 min) ..."
bash "$SOC_DIR/run_efx_pnr.sh"
echo ""

# ── Step 5: PGM — bitstream hex ──────────────────────────────────────────────
echo "==> [5/5] PGM — generate hex ..."
bash "$SOC_DIR/run_efx_pgm.sh"
echo ""

# ── Done ──────────────────────────────────────────────────────────────────────
END_TIME=$(date +%s)
ELAPSED=$(( END_TIME - START_TIME ))
echo "╔══════════════════════════════════════════╗"
printf "║   BUILD COMPLETE in %dm %ds              ║\n" $(( ELAPSED/60 )) $(( ELAPSED%60 ))
echo "╚══════════════════════════════════════════╝"
echo ""
HEX="$SOC_DIR/outflow/church_soc_cm.hex"
ls -lh "$HEX"
echo ""

# ── Serve hex on port 8888 ────────────────────────────────────────────────────
echo "==> Serving hex on port 8888 ..."
pkill -f "http.server 8888" 2>/dev/null || true
cd "$SOC_DIR/outflow"
python3 -m http.server 8888 &
SERVER_PID=$!
DROPLET_IP="$(hostname -I | awk '{print $1}')"
echo "    Hex server PID $SERVER_PID — http://${DROPLET_IP}:8888/"
echo ""
echo "On your local machine — ONE command flashes and connects to the IDE:"
echo ""
echo "  bash ~/church-machine/hardware/soc_combined/flash_and_monitor.sh"
echo ""
echo "  (downloads hex from http://${DROPLET_IP}:8888/, starts the IDE bridge,"
echo "   flashes the board, then opens  https://lab.cloomc.org  in your browser)"
echo ""
