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

# ── Show what was pulled and ask for confirmation ─────────────────────────────
cd "$REPO_ROOT"
_GIT_SHA=$(git rev-parse --short HEAD)
_GIT_DATE=$(git log -1 --format="%ci")
_GIT_MSG=$(git log -1 --format="%s")
_GIT_AUTHOR=$(git log -1 --format="%an")

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   Church Machine — Full Build            ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "  Pulled commit:"
echo "    SHA    : $_GIT_SHA"
echo "    Date   : $_GIT_DATE"
echo "    Author : $_GIT_AUTHOR"
echo "    Message: $_GIT_MSG"
echo ""
echo "  Build will take ~75 minutes."
echo ""

# Allow --yes / -y flag (or YES=1 env) to skip confirmation (for CI)
_SKIP_CONFIRM=0
for _arg in "$@"; do
    case "$_arg" in --yes|-y) _SKIP_CONFIRM=1 ;; esac
done
[ "${YES:-0}" = "1" ] && _SKIP_CONFIRM=1

if [ "$_SKIP_CONFIRM" -eq 0 ]; then
    read -r -p "  Press Enter to start the build, or Ctrl+C to cancel ... "
    echo ""
fi

# ── Step 1: Confirm repo state (bootstrap already synced above) ───────────────
echo "==> [1/5] Repo synced — ${_GIT_SHA}: ${_GIT_MSG}"
echo ""

# ── Step 2: Firmware ──────────────────────────────────────────────────────────
echo "==> [2/5] Firmware — compiling RISC-V firmware (~2 min)"
echo "    Builds the Sapphire SoC firmware: call-home, fault telemetry, NIA polling."
echo "    Always a clean rebuild to avoid git-pull timestamp traps."
echo "    Output: firmware.elf → 4 × byte-lane .bin symbol files for the BRAM."
echo ""
make -C "$SOC_DIR/firmware" clean all
echo "    Done."
echo ""

# ── Step 3: MAP — synthesis ───────────────────────────────────────────────────
echo "==> [3/5] MAP — Efinity synthesis (~45 min)"
echo "    Translates all Verilog (Church Machine core + Sapphire SoC + glue) into"
echo "    FPGA primitives (LUTs, FFs, BRAM, DSP) and places them on the Ti60 fabric."
echo "    Sub-steps that run automatically inside this phase:"
echo "      • patch_cm_bram.py   — rewrites CM DMEM to \$readmemb (EFX_MAP ignores"
echo "                              initial begin blocks, so raw BRAM would be zeroed)"
echo "      • XML param strip    — removes banned attrs (infer_clk_enable etc.) that"
echo "                              cause EFX-0002 errors; Efinity re-injects them so"
echo "                              we must strip before every compile"
echo "    Output: work_syn/  (netlist, timing reports)"
echo "    --- silence starts here (~45 min) ---"
echo ""
bash "$SOC_DIR/run_efx_map.sh"
echo ""

# ── Step 4: PNR — place & route ───────────────────────────────────────────────
echo "==> [4/5] PNR — place & route (~30 min)"
echo "    Assigns synthesised cells to exact FPGA sites, routes all signal wires,"
echo "    and writes the bitstream image."
echo "    Sub-steps that run automatically inside this phase:"
echo "      • gen_sapphire_symbol_bins.py — firmware ELF → byte-lane .bin files"
echo "                                       so the Sapphire BRAM is initialised"
echo "                                       with the correct call-home firmware"
echo "      • patch_mapv_init.py          — injects BRAM INIT_ constants into the"
echo "                                       post-MAP netlist (Efinity 2026.1 emits"
echo "                                       a stub initial begin with 4 zeros)"
echo "      • Interface Designer           — applies IO pin placement from peri.xml"
echo "      • efx_pnr                      — the actual place-and-route engine"
echo "    Output: outflow/church_soc_cm.bit"
echo "    --- silence starts here (~30 min) ---"
echo ""
bash "$SOC_DIR/run_efx_pnr.sh"
echo ""

# ── Step 5: PGM — bitstream hex ───────────────────────────────────────────────
echo "==> [5/5] PGM — generate .hex bitstream (<2 min)"
echo "    Converts the .bit binary into the Intel HEX format that openFPGALoader"
echo "    needs to flash the Ti60 F225 over USB-JTAG."
echo "    Output: outflow/church_soc_cm.hex"
echo ""
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

# ── Upload hex + metadata to IDE ─────────────────────────────────────────────
_FW_MINOR=$(grep -oP 'FW_MINOR\s+\K[0-9]+' "$SOC_DIR/firmware/main.c" 2>/dev/null || echo "?")
_FW_VER="2.${_FW_MINOR}"
_IDE_URL="${CM_IDE_URL:-https://lab.cloomc.org}"
echo "==> Uploading hex + metadata to IDE (${_IDE_URL}) ..."
_UPLOAD_RESP=$(curl -s -o /tmp/ide_upload.json -w "%{http_code}" \
    --insecure \
    -X POST "${_IDE_URL}/upload/ti60-hex" \
    -F "file=@${HEX}" \
    -F "git_sha=${_GIT_SHA}" \
    -F "git_date=${_GIT_DATE}" \
    -F "git_message=${_GIT_MSG}" \
    -F "firmware_version=${_FW_VER}" 2>/dev/null) || _UPLOAD_RESP="000"
if [ "$_UPLOAD_RESP" = "200" ]; then
    echo "    IDE Connect panel updated — commit ${_GIT_SHA}: ${_GIT_MSG}"
else
    echo "    IDE upload skipped (HTTP ${_UPLOAD_RESP}) — hex still on port 8888."
fi
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
