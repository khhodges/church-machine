#!/bin/bash
# run_full_build.sh — ONE command: git pull → build → serve hex
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
#
# THIS SCRIPT IS A THIN WRAPPER around scripts/build_ti60_bitstream.sh — the
# One Button Build Script (OBBS) and the ONLY place firmware is built,
# patched, and version-gated. This file used to duplicate that pipeline by
# calling run_efx_map.sh / run_efx_pnr.sh / run_efx_pgm.sh directly, which
# meant two divergent build paths could produce two divergent bitstreams —
# exactly what caused a flashed board to report a stale firmware banner
# despite the repo already containing the fix. Everything droplet-specific
# (tmux session management, git self-update, IDE upload, hex serving) stays
# here; the actual synthesis pipeline lives in ONE script only.

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

# ── Efinity environment (needed by build_ti60_bitstream.sh + its sub-scripts) ─
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

# ── Delegate the entire build pipeline to the OBBS ────────────────────────────
# scripts/build_ti60_bitstream.sh runs: firmware build → firmware sync →
# sapphire.v patch/deploy → CM Verilog deploy → version gates → MAP → PNR →
# PGM → copy to bitstreams/ + metadata sidecar. It is the single source of
# truth for the pipeline; this wrapper does not duplicate any of those steps.
echo "==> Delegating to scripts/build_ti60_bitstream.sh (repo root: $REPO_ROOT)"
echo "    --- silence starts here for most of the ~75 min build ---"
echo ""
bash "$REPO_ROOT/scripts/build_ti60_bitstream.sh"
echo ""

# ── Done ──────────────────────────────────────────────────────────────────────
END_TIME=$(date +%s)
ELAPSED=$(( END_TIME - START_TIME ))
echo "╔══════════════════════════════════════════╗"
printf "║   BUILD COMPLETE in %dm %ds              ║\n" $(( ELAPSED/60 )) $(( ELAPSED%60 ))
echo "╚══════════════════════════════════════════╝"
echo ""

BITSTREAMS="$REPO_ROOT/bitstreams"
HEX="$BITSTREAMS/church_ti60_f225.hex"
META="$BITSTREAMS/church_ti60_f225.json"
if [ ! -f "$HEX" ]; then
    echo "[FAIL] Expected build output not found: $HEX" >&2
    echo "[FAIL] build_ti60_bitstream.sh should have created it — check its output above." >&2
    exit 1
fi
ls -lh "$HEX"
echo ""

# Read the firmware version straight from the build's own metadata sidecar —
# this is the version that was ACTUALLY embedded in this hex, not re-derived
# from source (which could drift if this script's assumptions ever changed).
_FW_VER="unknown"
if [ -f "$META" ]; then
    _FW_VER="$(python3 -c "import json; print(json.load(open('$META')).get('firmware_version', 'unknown'))" 2>/dev/null || echo "unknown")"
fi
echo "    Firmware version in this build: $_FW_VER"
echo ""

# ── Upload hex + metadata to IDE ─────────────────────────────────────────────
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
    echo "    IDE Connect panel updated — commit ${_GIT_SHA}: ${_GIT_MSG} (fw ${_FW_VER})"
else
    echo "    IDE upload skipped (HTTP ${_UPLOAD_RESP}) — hex still on port 8888."
fi
echo ""

# ── Serve bitstreams/ on port 8888 ────────────────────────────────────────────
# flash_and_monitor.sh's droplet fallback still requests the legacy filename
# church_soc_cm.hex — keep serving it under that name (as a copy of the
# canonical bitstreams/church_ti60_f225.hex) so existing local flash scripts
# keep working without also having to be updated in lockstep.
cp "$HEX" "$BITSTREAMS/church_soc_cm.hex"
echo "==> Serving $BITSTREAMS on port 8888 ..."
pkill -f "http.server 8888" 2>/dev/null || true
cd "$BITSTREAMS"
python3 -m http.server 8888 &
SERVER_PID=$!
DROPLET_IP="$(hostname -I | awk '{print $1}')"
echo "    Hex server PID $SERVER_PID"
echo "    Canonical: http://${DROPLET_IP}:8888/church_ti60_f225.hex"
echo "    Legacy:    http://${DROPLET_IP}:8888/church_soc_cm.hex  (used by flash_and_monitor.sh fallback)"
echo ""
echo "On your local machine — ONE command flashes and connects to the IDE:"
echo ""
echo "  First time (repo not cloned):"
echo "    curl -sL https://lab.cloomc.org/dl/flash | bash"
echo ""
echo "  After first clone:"
echo "    bash ~/church-machine/hardware/soc_combined/flash_and_monitor.sh"
echo ""
echo "  Both commands: download hex from droplet, start IDE bridge,"
echo "  flash Ti60, open https://lab.cloomc.org in your browser."
echo ""
