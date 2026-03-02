#!/usr/bin/env python3
"""Standalone upload script for Church Machine pico-ice.

Copy this single file to your machine and run:
    pip3 install pyserial
    python3 pico_upload.py --port /dev/ttyACM1

No other project files needed.
"""

import sys
import struct
import time
import argparse

NS_TABLE_BASE = 0xFD00
FNV_SEAL_MASK = (1 << 25) - 1

GT_TYPE_INFORM = 0b00
GT_TYPE_NULL   = 0b10

PERM_MASK_R = 1 << 0
PERM_MASK_W = 1 << 1
PERM_MASK_X = 1 << 2
PERM_MASK_L = 1 << 3
PERM_MASK_S = 1 << 4
PERM_MASK_E = 1 << 5

NS_WORDS = 192
CLIST_WORDS = 64
TOTAL_WORDS = NS_WORDS + CLIST_WORDS


def make_gt(gt_type, perms, index, version):
    return (version << 25) | (index << 8) | (perms << 2) | gt_type


def build_default_image():
    ns = []
    for i in range(16):
        location = NS_TABLE_BASE if i == 0 else i * 0x100
        limit = 0x80000000 | 8
        seal_word = 0
        ns.extend([location, limit, seal_word])
    while len(ns) < NS_WORDS:
        ns.append(0)

    clist = [
        make_gt(GT_TYPE_INFORM, PERM_MASK_R | PERM_MASK_X, 3, 0),
        make_gt(GT_TYPE_INFORM, PERM_MASK_X | PERM_MASK_E, 4, 0),
        make_gt(GT_TYPE_NULL, 0, 0, 0),
        make_gt(GT_TYPE_INFORM, PERM_MASK_E, 2, 0),
        make_gt(GT_TYPE_INFORM, PERM_MASK_E, 5, 0),
        make_gt(GT_TYPE_INFORM, PERM_MASK_L, 6, 0),
        make_gt(GT_TYPE_NULL, 0, 0, 0),
        make_gt(GT_TYPE_NULL, 0, 0, 0),
    ]
    while len(clist) < CLIST_WORDS:
        clist.append(0)

    return ns + clist


def image_to_bytes(image):
    data = struct.pack('<I', len(image))
    for word in image:
        data += struct.pack('<I', word)
    return data


def upload(port, image, timeout_s=10):
    try:
        import serial
    except ImportError:
        print("pyserial not installed. Run: pip3 install pyserial")
        sys.exit(1)

    data = image_to_bytes(image)

    print(f"Opening {port}...")
    ser = serial.Serial(port, 115200, timeout=1)
    time.sleep(0.1)
    ser.reset_input_buffer()

    print(f"Sending {len(data)} bytes ({len(image)} words)...")
    ser.write(data)
    ser.flush()

    print("Waiting for banner...")
    deadline = time.time() + timeout_s
    lines = []
    while time.time() < deadline:
        line = ser.readline()
        if line:
            text = line.decode('ascii', errors='replace').rstrip()
            print(f"  {text}")
            lines.append(text)
            if "HALT" in text:
                break

    ser.close()

    if any("CHURCH" in l for l in lines):
        print("\nUpload successful!")
        return True
    else:
        print("\nNo banner received.")
        print("Press the RP2040 reset button on pico-ice, then run this again quickly.")
        return False


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Upload to Church Machine pico-ice")
    parser.add_argument('--port', default='/dev/ttyACM1',
                        help='Serial port (default: /dev/ttyACM1)')
    args = parser.parse_args()

    image = build_default_image()
    print(f"Image: {len(image)} words ({len(image)*4} bytes)")
    print(f"  Namespace: words 0..{NS_WORDS-1}")
    print(f"  C-list:    words {NS_WORDS}..{TOTAL_WORDS-1}")
    upload(args.port, image)
