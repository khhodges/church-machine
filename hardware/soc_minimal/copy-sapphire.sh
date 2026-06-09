#!/usr/bin/env bash
# hardware/soc_minimal/copy-sapphire.sh
#
# Finds sapphire.v and sapphire_define.vh anywhere in the Efinity installation
# and copies them into hardware/soc_minimal/ so Efinity synthesis can find them.
#
# Run from the project root:
#   bash hardware/soc_minimal/copy-sapphire.sh
# or:
#   curl https://<IDE-URL>/dl/copy-sapphire | bash

set -e
DEST="$PWD/hardware/soc_minimal"

echo "[sapphire] Searching for sapphire.v under ~/efinity ..."
SAPPHIRE_V=$(find ~/efinity -name "sapphire.v" 2>/dev/null | head -1)

if [ -z "$SAPPHIRE_V" ]; then
    echo ""
    echo "ERROR: sapphire.v not found anywhere under ~/efinity."
    echo ""
    echo "This means the Sapphire SoC IP has not been generated yet."
    echo "To generate it:"
    echo "  1. Open Efinity 2025.2"
    echo "  2. Menu: Tools -> IP Manager"
    echo "  3. Click 'New IP', search for 'Sapphire', select Sapphire SoC"
    echo "  4. Set target device to Ti60F225, leave defaults, click Generate"
    echo "  5. Re-run this script after generation completes"
    exit 1
fi

SAPPHIRE_DIR=$(dirname "$SAPPHIRE_V")
echo "[sapphire] Found sapphire.v at: $SAPPHIRE_V"

# Look for sapphire_define.vh in the same directory first, then search broadly
SAPPHIRE_VH="$SAPPHIRE_DIR/sapphire_define.vh"
if [ ! -f "$SAPPHIRE_VH" ]; then
    echo "[sapphire] sapphire_define.vh not in same dir, searching..."
    SAPPHIRE_VH=$(find ~/efinity -name "sapphire_define.vh" 2>/dev/null | head -1)
fi

if [ -z "$SAPPHIRE_VH" ] || [ ! -f "$SAPPHIRE_VH" ]; then
    echo ""
    echo "ERROR: sapphire_define.vh not found anywhere under ~/efinity."
    echo "It should be generated alongside sapphire.v by the IP Manager."
    echo "Try re-generating the Sapphire SoC IP in Efinity's IP Manager."
    exit 1
fi

echo "[sapphire] Found sapphire_define.vh at: $SAPPHIRE_VH"

# Copy both into the project
cp "$SAPPHIRE_V"  "$DEST/sapphire.v"
cp "$SAPPHIRE_VH" "$DEST/sapphire_define.vh"

echo ""
echo "[sapphire] Copied:"
echo "  $DEST/sapphire.v"
echo "  $DEST/sapphire_define.vh"
echo ""

# Check addresses match what firmware expects
echo "[sapphire] Checking addresses in sapphire_define.vh ..."
UART_OK=1
GPIO_OK=1
ROM_OK=1
RAM_OK=1

grep -i "UART0\|APB_UART" "$DEST/sapphire_define.vh" | head -5
grep -i "GPIO\|APB_GPIO" "$DEST/sapphire_define.vh" | head -5

UART_ADDR=$(grep -i "APB_UART0_BASE\|UART0_BASE" "$DEST/sapphire_define.vh" | grep -o "32'h[0-9A-Fa-f]*\|0x[0-9A-Fa-f]*" | head -1)
GPIO_ADDR=$(grep -i "APB_GPIO\b\|APB_GPIO_BASE\b\|APB_GPIO_A_BASE" "$DEST/sapphire_define.vh" | grep -o "32'h[0-9A-Fa-f]*\|0x[0-9A-Fa-f]*" | head -1)

echo ""
if [ -n "$UART_ADDR" ]; then
    echo "[sapphire] UART0 base: $UART_ADDR  (firmware expects 0xF0010000)"
    if echo "$UART_ADDR" | grep -qi "F0010000"; then
        echo "           -> OK"
    else
        echo "           -> MISMATCH: update UART_BASE in hardware/soc_minimal/firmware/main.c"
        UART_OK=0
    fi
fi

if [ -n "$GPIO_ADDR" ]; then
    echo "[sapphire] GPIO  base: $GPIO_ADDR  (firmware expects 0xF0020000)"
    if echo "$GPIO_ADDR" | grep -qi "F0020000"; then
        echo "           -> OK"
    else
        echo "           -> MISMATCH: update GPIO_BASE in hardware/soc_minimal/firmware/main.c"
        GPIO_OK=0
    fi
fi

echo ""
if [ "$UART_OK" -eq 1 ] && [ "$GPIO_OK" -eq 1 ]; then
    echo "[sapphire] SUCCESS — both files copied and addresses match."
    echo "[sapphire] Next step: open church_soc.xml in Efinity and run synthesis."
else
    echo "[sapphire] Files copied but address mismatches detected above."
    echo "[sapphire] Update firmware/main.c then rebuild: make -C hardware/soc_minimal/firmware"
    echo "[sapphire] After rebuilding: cp hardware/soc_minimal/firmware/firmware.hex hardware/soc_minimal/"
fi
