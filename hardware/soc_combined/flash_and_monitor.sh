#!/bin/bash
# flash_and_monitor.sh — ONE command on the local machine (Chromebook/Penguin):
#   download hex from droplet → start IDE bridge → flash Ti60 → open IDE dashboard
#
# Usage:
#   bash ~/church-machine/hardware/soc_combined/flash_and_monitor.sh
#
# Override IDE URL:
#   CM_IDE_URL=https://lab.cloomc.org bash flash_and_monitor.sh
#
# Requires: curl, openFPGALoader, python3 + pyserial, /dev/ttyUSB2 visible
# (ChromeOS: Settings → Linux → Manage USB devices → enable FTDI device)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DROPLET="165.227.190.84"
HEX_PORT="8888"
HEX_URL="http://$DROPLET:$HEX_PORT/church_soc_cm.hex"
HEX_FILE="/tmp/church_soc_cm.hex"
UART="/dev/ttyUSB2"
IDE_URL="${CM_IDE_URL:-https://lab.cloomc.org}"
BRIDGE="$SCRIPT_DIR/callhome_bridge.py"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   Church Machine — Flash & Monitor       ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "  IDE:    $IDE_URL"
echo "  Board:  $UART"
echo ""

# ── Preflight checks ──────────────────────────────────────────────────────
if [ ! -c "$UART" ]; then
    echo "ERROR: $UART not found."
    echo "       Go to ChromeOS Settings → Linux → Manage USB devices"
    echo "       and enable the FTDI / Future Technology Devices entry."
    exit 1
fi

if [ ! -f "$BRIDGE" ]; then
    echo "ERROR: callhome_bridge.py not found at $BRIDGE"
    echo "       Run: git pull  (or re-clone the repo)"
    exit 1
fi

if ! python3 -c "import serial" 2>/dev/null; then
    echo "ERROR: pyserial not installed."
    echo "       Run: pip3 install pyserial"
    exit 1
fi

# ── Download hex ──────────────────────────────────────────────────────────
echo "==> [1/3] Downloading hex from droplet ..."
curl --fail -# -o "$HEX_FILE" "$HEX_URL"
ls -lh "$HEX_FILE"
echo ""

# ── Start IDE bridge BEFORE flash (boot banner fires on first reset) ──────
echo "==> [2/3] Starting IDE bridge on $UART → $IDE_URL ..."
python3 "$BRIDGE" \
    --port="$UART" \
    --ide="$IDE_URL" \
    --insecure &
BRIDGE_PID=$!
echo "    Bridge PID $BRIDGE_PID — board will appear in IDE when it boots"
echo ""

# Give the bridge a moment to open the serial port before the board resets
sleep 2

# ── Flash ─────────────────────────────────────────────────────────────────
echo "==> [3/3] Flashing Ti60 ..."
sudo openFPGALoader -b titanium_ti60_f225_jtag --external-flash -f "$HEX_FILE"
echo ""

# ── Done — point user at IDE ──────────────────────────────────────────────
echo "╔══════════════════════════════════════════╗"
echo "║   FLASH COMPLETE                         ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "  The board is booting. Open the IDE to watch:"
echo ""
echo "  ➜  $IDE_URL"
echo ""
echo "  Dashboard → your Ti60 will appear automatically."
echo "  LED2 lights when the CALLHOME is received."
echo ""
echo "  Bridge is running in the background (PID $BRIDGE_PID)."
echo "  Press Ctrl+C to stop monitoring."
echo ""

# ── Keep bridge alive — Ctrl+C cleans up ─────────────────────────────────
trap "echo ''; echo 'Stopping bridge...'; kill $BRIDGE_PID 2>/dev/null; exit 0" INT TERM
wait $BRIDGE_PID
