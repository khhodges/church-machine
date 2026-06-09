#!/usr/bin/env python3
"""
hardware/soc_minimal/scripts/split_firmware.py

Split a flat firmware binary into four $readmemb-format byte-lane files
required by patch_sapphire_init.py to bake firmware into Sapphire SoC BRAM.

Background
----------
The Sapphire SoC ROM is a 32-bit-wide BRAM split across four 8-bit byte
lanes.  patch_sapphire_init.py reads one .bin file per lane and inlines the
values as Verilog assignments.  Each .bin file uses $readmemb format: one
8-bit binary string per line (e.g. "01001010"), one entry per 32-bit word.

Lane mapping (little-endian RISC-V, 32-bit words):
  symbol0  bits  7:0   byte offset 0 of each word  (0, 4,  8, 12 ...)
  symbol1  bits 15:8   byte offset 1 of each word  (1, 5,  9, 13 ...)
  symbol2  bits 23:16  byte offset 2 of each word  (2, 6, 10, 14 ...)
  symbol3  bits 31:24  byte offset 3 of each word  (3, 7, 11, 15 ...)

Usage (run from hardware/soc_minimal/)
--------------------------------------
  python3 scripts/split_firmware.py firmware/firmware.raw work_syn

  firmware.raw  -- flat binary produced by:
                     objcopy -O binary firmware.elf firmware.raw
  work_syn      -- output directory; four .bin files are written here

ROM size
--------
Matches link.ld: ROM = 16 KB = 4096 32-bit words.
Firmware shorter than 16 KB is zero-padded; truncation is an error.
"""

import os
import sys

ROM_BYTES  = 16 * 1024          # 16 KB — must match link.ld ROM LENGTH
ROM_WORDS  = ROM_BYTES // 4     # 4096 32-bit words

BIN_NAMES = [
    "EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol0.bin",
    "EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol1.bin",
    "EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol2.bin",
    "EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol3.bin",
]


def split(raw_path, out_dir):
    with open(raw_path, "rb") as f:
        data = f.read()

    print(f"  firmware.raw: {len(data)} bytes")

    if len(data) > ROM_BYTES:
        print(f"ERROR: firmware ({len(data)} B) exceeds ROM size ({ROM_BYTES} B).")
        sys.exit(1)

    # Zero-pad to full ROM size
    data = data + b'\x00' * (ROM_BYTES - len(data))

    os.makedirs(out_dir, exist_ok=True)

    for lane in range(4):
        fname = os.path.join(out_dir, BIN_NAMES[lane])
        lines = []
        for word_idx in range(ROM_WORDS):
            byte_val = data[word_idx * 4 + lane]
            lines.append(f"{byte_val:08b}")
        with open(fname, "w") as f:
            f.write("\n".join(lines) + "\n")
        print(f"  Written {fname}  ({ROM_WORDS} entries)")

    print(f"\nDone — 4 symbol files written to {out_dir}/")
    print("Next: cp sapphire.v.bak sapphire.v && "
          "python3 scripts/patch_sapphire_init.py sapphire.v work_syn")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(f"Usage: python3 {sys.argv[0]} <firmware.raw> <work_syn_dir>")
        sys.exit(1)
    split(sys.argv[1], sys.argv[2])
