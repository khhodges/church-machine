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

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HEX="$SCRIPT_DIR/outflow/church_soc_cm.hex"

if [ ! -f "$HEX" ]; then
    echo "ERROR: $HEX not found."
    echo "       Run run_full_build.sh first to produce the bitstream."
    exit 1
fi

SIZE="$(ls -lh "$HEX" | awk '{print $5}')"
IP="$(hostname -I | awk '{print $1}')"
SESSION="church-serve"

# Kill any stale python http.server on port 8888
pkill -f "http.server 8888" 2>/dev/null || true

# Kill stale tmux session if it exists
tmux kill-session -t "$SESSION" 2>/dev/null || true

echo "==> Starting hex server in tmux session '$SESSION' ..."
tmux new-session -d -s "$SESSION" \
    "cd '$SCRIPT_DIR/outflow' && python3 -m http.server 8888"

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
