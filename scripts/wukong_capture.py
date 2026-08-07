#!/usr/bin/env python3
"""
wukong_capture.py — raw binary capture from Wukong UART (Windows COM port)

Usage:
    python wukong_capture.py COM3

Captures 5 seconds of raw bytes from the serial port and writes them to
wukong_raw.bin in the current directory.  No UTF-8 mangling, no encoding
conversion — pure bytes as sent by the CM trace unit.

Requires pyserial:  pip install pyserial
"""

import sys, time, serial

PORT = sys.argv[1] if len(sys.argv) > 1 else "COM3"
BAUD = 57600
SECS = 8
OUTFILE = "wukong_raw.bin"

print(f"Opening {PORT} at {BAUD} baud ...")
with serial.Serial(PORT, BAUD, timeout=0.1) as ser:
    ser.reset_input_buffer()
    print(f"Capturing {SECS}s of raw bytes — power-cycle the board NOW ...")
    time.sleep(0.5)
    buf = bytearray()
    deadline = time.time() + SECS
    while time.time() < deadline:
        chunk = ser.read(256)
        if chunk:
            buf += chunk
            print(f"  {len(buf):5d} bytes so far", end="\r")
    print()

with open(OUTFILE, "wb") as f:
    f.write(buf)

print(f"Saved {len(buf)} bytes → {OUTFILE}")

# Quick sanity check — count 0xAA sync bytes
aa = buf.count(0xAA)
print(f"0xAA sync bytes found: {aa}  (~{aa} trace packets)")

# Show first few packets
print("\nFirst packets (hex):")
i = 0
shown = 0
while i < len(buf) - 12 and shown < 8:
    if buf[i] == 0xAA:
        pkt     = buf[i:i+12]
        nia     = int.from_bytes(pkt[1:5], 'big')
        ev_type = pkt[5]
        payload = int.from_bytes(pkt[6:10], 'big')
        flags   = pkt[10]
        fault   = pkt[11]
        fault_code  = fault & 0x1F
        fault_valid = bool(fault & 0x40)
        bp_hit      = bool(fault & 0x80)
        nzcv = f"N={flags>>3&1} Z={flags>>2&1} C={flags>>1&1} V={flags&1}"
        print(f"  NIA=0x{nia:08x}  ev=0x{ev_type:02x}  payload=0x{payload:08x}  {nzcv}"
              f"  fault={'YES code='+str(fault_code) if fault_valid else 'no'}"
              f"{'  BP!' if bp_hit else ''}")
        i += 12
        shown += 1
    else:
        i += 1
