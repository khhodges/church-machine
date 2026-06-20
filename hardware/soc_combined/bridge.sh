#!/usr/bin/env bash
# bridge.sh — Church Machine Ti60 Call-Home Bridge launcher
#
# Auto-detects the Sapphire SoC UART (FT4232H interface 2, typically ttyUSB2),
# validates that pyserial is installed, then launches callhome_bridge.py.
#
# Usage:
#   ./hardware/soc_combined/bridge.sh [--ide=URL] [--port=PATH] [extra args…]
#
# Examples:
#   ./hardware/soc_combined/bridge.sh
#   ./hardware/soc_combined/bridge.sh --ide=http://localhost:5000
#   ./hardware/soc_combined/bridge.sh --port=/dev/ttyUSB3 --ide=http://localhost:5000
#
# The Ti60 FT4232H exposes four USB-UART interfaces:
#   ttyUSB0 — JTAG            (interface 0)
#   ttyUSB1 — SPI/debug       (interface 1)
#   ttyUSB2 — Sapphire SoC    (interface 2)  ← this bridge
#   ttyUSB3 — Church Machine  (interface 3)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRIDGE_PY="$SCRIPT_DIR/callhome_bridge.py"

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------
echo ""
echo "┌─────────────────────────────────────────────────────┐"
echo "│  Church Machine  —  Ti60 Call-Home Bridge           │"
echo "│  Sapphire SoC UART (FT4232H interface 2 / ttyUSB2) │"
echo "└─────────────────────────────────────────────────────┘"
echo ""

# ---------------------------------------------------------------------------
# Check pyserial
# ---------------------------------------------------------------------------
if ! python3 -c "import serial" 2>/dev/null; then
    echo "ERROR: pyserial is not installed."
    echo ""
    echo "  Install it with:"
    echo "    sudo apt-get install -y python3-serial"
    echo "  or with pip:"
    echo "    pip3 install pyserial"
    echo ""
    exit 1
fi

# ---------------------------------------------------------------------------
# Port auto-detection — fall through ttyUSB2/3/4 then ttyACM0/1
# ---------------------------------------------------------------------------
_EXPLICIT_PORT=""
for _a in "$@"; do
    if [[ "$_a" == --port=* ]]; then
        _EXPLICIT_PORT="${_a#--port=}"
        break
    fi
done

SERIAL_PORT=""

if [ -n "$_EXPLICIT_PORT" ]; then
    SERIAL_PORT="$_EXPLICIT_PORT"
    echo "  Port   : $SERIAL_PORT  (from --port flag)"
else
    # Try the canonical SoC UART port first, then fallback candidates
    for _candidate in /dev/ttyUSB2 /dev/ttyUSB3 /dev/ttyUSB4 /dev/ttyACM0 /dev/ttyACM1; do
        if [ -e "$_candidate" ]; then
            SERIAL_PORT="$_candidate"
            if [ "$_candidate" = "/dev/ttyUSB2" ]; then
                echo "  Port   : $SERIAL_PORT  (auto-detected — canonical Ti60 SoC UART)"
            else
                echo "  Port   : $SERIAL_PORT  (auto-detected — ttyUSB2 not found; using fallback)"
                echo "  NOTE   : Expected /dev/ttyUSB2 for the Ti60 FT4232H SoC UART."
                echo "           Verify your USB cable and FT4232H driver are loaded."
            fi
            break
        fi
    done
fi

if [ -z "$SERIAL_PORT" ]; then
    echo ""
    echo "ERROR: No serial port found."
    echo ""
    echo "  The Ti60 FT4232H should enumerate as ttyUSB0–ttyUSB3 when plugged in."
    echo "  The Sapphire SoC UART is on ttyUSB2 (FT4232H interface 2)."
    echo ""
    echo "  Troubleshooting:"
    echo "    1. Connect the Ti60F225 devkit via USB."
    echo "    2. Run:  ls /dev/ttyUSB*"
    echo "    3. If nothing appears, check that the FT4232H driver is loaded:"
    echo "         lsmod | grep ftdi"
    echo "    4. If four ttyUSB entries appear but none is ttyUSB2, your system"
    echo "       may have pre-existing USB-serial devices shifting the numbering."
    echo "       Use --port=/dev/ttyUSBN to specify the correct port explicitly."
    echo ""
    exit 1
fi

# Build final argument list — inject --port if not already present
EXTRA_ARGS=()
for _a in "$@"; do
    EXTRA_ARGS+=("$_a")
done
if [ -z "$_EXPLICIT_PORT" ]; then
    EXTRA_ARGS=("--port=$SERIAL_PORT" "${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}")
fi

echo "  Bridge : $BRIDGE_PY"
echo ""

# ---------------------------------------------------------------------------
# --upload mode extra instructions
# ---------------------------------------------------------------------------
_UPLOAD_MODE=0
for _a in "$@"; do
    if [[ "$_a" == "--upload" ]]; then
        _UPLOAD_MODE=1
        break
    fi
done

if [ "$_UPLOAD_MODE" = "1" ]; then
    echo "  ┌─────────────────────────────────────────────────────────────┐"
    echo "  │  UPLOAD MODE — PATCH_LUMP via CM debug UART (ttyUSB3)      │"
    echo "  ├─────────────────────────────────────────────────────────────┤"
    echo "  │  Pre-requisite: boot-image.bin must be freshly generated.   │"
    echo "  │    → IDE Builder tab → Step 1 (Ti60 F225) → Generate        │"
    echo "  │                                                              │"
    echo "  │  After the ✓ ACK message:                                   │"
    echo "  │    → Hold the Ti60 push button for ~1 second, then release. │"
    echo "  │    → CM reboots from NIA=0 with the new boot image.         │"
    echo "  │    → LED0 should start blinking at ~1 Hz.                   │"
    echo "  │                                                              │"
    echo "  │  Expected bridge output (healthy):                          │"
    echo "  │    [CALL HOME] Ti60F225  UID=...  NIA=0x...  boot_ok=1      │"
    echo "  │    [CALL HOME] ACK received from IDE                         │"
    echo "  │    (no HUNG lines = LED blink is running correctly)          │"
    echo "  └─────────────────────────────────────────────────────────────┘"
    echo ""
else
    echo "  Tip: Run this in the background, then open the IDE."
    echo "       The Ti60 will appear in the Dashboard device list as Ti60F225."
    echo ""
    echo "  To upload a new boot image to CM BRAM, add --upload:"
    echo "    $0 --ide=<URL> --insecure --upload"
    echo ""
fi

exec python3 "$BRIDGE_PY" "${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}"
