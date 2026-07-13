#!/bin/bash
# serve_bitstream.sh — start (or restart) the hex file server on the droplet.
#
# Run on the droplet any time you need the Chromebook to be able to download
# the bitstream:
#
#   bash ~/church-machine/hardware/soc_combined/serve_bitstream.sh
#
# The server runs in a persistent tmux session called "church-serve" so it
# survives SSH disconnects.  Re-run this script to restart it after a reboot.
#
# Hex search order (first match wins):
#   1. <repo-root>/bitstreams/church_ti60_f225.hex  (canonical OBBS output)
#   2. <script-dir>/outflow/church_soc_cm.hex       (legacy direct-build path)
# The server always exposes the file as /church_soc_cm.hex so
# flash_and_monitor.sh fetches it correctly regardless of source.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

HEX=""
if [ -f "$REPO_ROOT/bitstreams/church_ti60_f225.hex" ]; then
    HEX="$REPO_ROOT/bitstreams/church_ti60_f225.hex"
elif [ -f "$SCRIPT_DIR/outflow/church_soc_cm.hex" ]; then
    HEX="$SCRIPT_DIR/outflow/church_soc_cm.hex"
fi

if [ -z "$HEX" ]; then
    echo "ERROR: Hex not found in either expected location:"
    echo "  $REPO_ROOT/bitstreams/church_ti60_f225.hex  (canonical)"
    echo "  $SCRIPT_DIR/outflow/church_soc_cm.hex        (legacy)"
    echo ""
    echo "After a build, copy with:"
    echo "  cp ~/church_project/SoC/outflow/church_soc_cm.hex $REPO_ROOT/bitstreams/church_ti60_f225.hex"
    exit 1
fi

SIZE="$(ls -lh "$HEX" | awk '{print $5}')"
IP="$(hostname -I | awk '{print $1}')"
SESSION="church-serve"

SERVE_DIR="$(mktemp -d /tmp/church-serve-XXXXXX)"
ln -sf "$HEX" "$SERVE_DIR/church_soc_cm.hex"

pkill -f "http.server 8888" 2>/dev/null || true
tmux kill-session -t "$SESSION" 2>/dev/null || true

echo "==> Starting hex server in tmux session '$SESSION' ..."
tmux new-session -d -s "$SESSION" \
    "cd '$SERVE_DIR' && python3 -m http.server 8888"

echo ""
echo "  Hex:  $HEX  ($SIZE)"
echo "  URL:  http://$IP:8888/church_soc_cm.hex"
echo ""
echo "  Server is running in tmux session '$SESSION'."
echo "  It will survive SSH disconnects."
echo "  To stop it:  tmux kill-session -t $SESSION"
echo ""
echo "On your Chromebook, flash with:"
echo "  bash ~/church-machine/hardware/soc_combined/flash_and_monitor.sh"
echo ""
