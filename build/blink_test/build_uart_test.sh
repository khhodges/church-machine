#!/bin/bash
set -e
echo "=== Yosys ==="
yosys -p "read_verilog uart_test.v; synth_gowin -top top -json uart_test.json"
echo "=== nextpnr ==="
nextpnr-himbaechel \
  --device GW2AR-LV18QN88C8/I7 \
  --vopt family=GW2A-18C \
  --vopt partname=GW2AR-LV18QN88C8/I7 \
  --vopt cst=uart_test.cst \
  --json uart_test.json \
  --write uart_test_pnr.json
echo "=== gowin_pack ==="
gowin_pack -d GW2A-18C -o uart_test.fs uart_test_pnr.json
echo "=== Done ==="
echo "Program: openFPGALoader -b tangnano20k uart_test.fs"
echo "Then: screen /dev/ttyUSB0 115200"
echo "  or: screen /dev/ttyUSB1 115200"
echo "You should see HELLO repeating continuously."
ls -la uart_test.fs
