#!/usr/bin/env bash
# test_led_flash.sh — LED Flash LUMP hardware test (Ti60 F225)
#
# Uploads the current boot image from the IDE to the Church Machine's BRAM via
# the PATCH_LUMP (0xBEEF) protocol, then exits after the ACK is received.
# Use --no-reconnect so the bridge quits immediately after upload rather than
# looping back into call-home polling mode.
#
# ============================================================================
# FULL PROCEDURE — run these steps from the Chromebook repo root
# ============================================================================
#
# STEP 0 — Pre-requisite (IDE side, do this FIRST)
#   Open https://lab.cloomc.org → Builder tab → Step 1 (Ti60 F225).
#   Confirm NS slot 3 = "LED flash".  Click "Generate Boot Image".
#   The boot image is now cached on the server — --upload will fetch it.
#
# STEP 1 — Pull latest firmware
#   git pull
#   grep "NUC_CODE_START\|FW_MINOR" hardware/soc_combined/firmware/main.c
#   # Must show: NUC_CODE_START=0x00000000u   FW_MINOR=2u   (firmware v2.2)
#   # If stale, wait for GitHub auto-sync (~30 min) or patch manually:
#   #   sed -i 's/NUC_CODE_START   0x00000160u/NUC_CODE_START   0x00000000u/' ...
#   #   sed -i 's/NUC_CODE_END     0x000001B0u/NUC_CODE_END     0x00000044u/' ...
#   #   sed -i 's/FW_MINOR  0u/FW_MINOR  2u/' hardware/soc_combined/firmware/main.c
#
# STEP 2 — (Only if Ti60 does NOT already have firmware v2.2 flashed)
#   cd hardware/soc_combined
#   make firmware
#   python3 ../../scripts/patch_sapphire_init.py sapphire.v \
#       EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol*.bin
#   bash run_efx_map.sh church_soc_cm.xml 2>&1 | tee /tmp/map.log
#   bash run_efx_pnr.sh church_soc_cm.xml 2>&1 | tee /tmp/pnr.log
#   bash run_efx_pgm.sh church_soc_cm.xml 2>&1 | tee /tmp/pgm.log
#   sudo openFPGALoader -b titanium_ti60_f225_jtag -f outflow/church_soc_cm.hex
#   cd ../..
#   # Verify BRAM non-zero: grep -m1 'INIT_0' outflow/church_soc_cm.map.v
#
# STEP 3 — Run this script
#   ./hardware/soc_combined/test_led_flash.sh
#   # OR with an override IDE URL:
#   CM_IDE_URL=https://lab.cloomc.org ./hardware/soc_combined/test_led_flash.sh
#
# STEP 4 — After the "✓ ACK" box appears
#   → Hold the Ti60 push button for ~1 second, then release.
#   → Watch for: [CALL HOME] Ti60F225  UID=...  boot_ok=1
#   →            [CALL HOME] ACK received from IDE
#   →            (no HUNG lines)
#   → LED0 on the board should blink at ~1 Hz.
#
# DIAGNOSTIC SIGNATURES
#   HUNG at NIA=0x030 or 0x044 → firmware NUC_CODE_END too low (needs 0x044)
#   HUNG at NIA=0x194          → old BRAM layout — rebuild + reflash needed
#   NAK (0x15) from FPGA       → wrong baud/port on ttyUSB3 — check --upload-port
#   Timeout waiting for ACK    → Ti60 off, or ttyUSB3 not connected
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRIDGE_SH="$SCRIPT_DIR/bridge.sh"

# ---------------------------------------------------------------------------
# Configuration — override with env vars
# ---------------------------------------------------------------------------
IDE_URL="${CM_IDE_URL:-https://lab.cloomc.org}"
UPLOAD_PORT="${CM_UPLOAD_PORT:-/dev/ttyUSB3}"
SOC_PORT="${CM_SOC_PORT:-}"           # auto-detect if empty

echo ""
echo "┌─────────────────────────────────────────────────────────────┐"
echo "│  Church Machine  —  LED Flash LUMP Hardware Test            │"
echo "│  Ti60 F225  ·  NS slot 3  ·  ~1 Hz LED blink               │"
echo "└─────────────────────────────────────────────────────────────┘"
echo ""
echo "  IDE URL    : $IDE_URL"
echo "  SoC UART   : ${SOC_PORT:-auto-detect (ttyUSB2)}"
echo "  CM debug   : $UPLOAD_PORT  (PATCH_LUMP upload port)"
echo ""

# ---------------------------------------------------------------------------
# Check python3 and pyserial
# ---------------------------------------------------------------------------
if ! command -v python3 >/dev/null 2>&1; then
    echo "ERROR: python3 not found."
    exit 1
fi

if ! python3 -c "import serial" 2>/dev/null; then
    echo "ERROR: pyserial is not installed."
    echo "  Install: sudo apt-get install -y python3-serial"
    echo "        or: pip3 install pyserial"
    exit 1
fi

# ---------------------------------------------------------------------------
# Build argument list for bridge.sh
# ---------------------------------------------------------------------------
BRIDGE_ARGS=(
    "--ide=$IDE_URL"
    "--insecure"
    "--upload"
    "--no-reconnect"
    "--upload-port=$UPLOAD_PORT"
)

if [ -n "$SOC_PORT" ]; then
    BRIDGE_ARGS=("--port=$SOC_PORT" "${BRIDGE_ARGS[@]}")
fi

echo "  Running: $BRIDGE_SH ${BRIDGE_ARGS[*]}"
echo ""

exec "$BRIDGE_SH" "${BRIDGE_ARGS[@]}"
