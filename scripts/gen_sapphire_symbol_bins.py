#!/usr/bin/env python3
"""
scripts/gen_sapphire_symbol_bins.py

Generate the four $readmemb symbol-bin files that patch_sapphire_init.py
needs from a raw firmware binary (firmware.bin).

Each symbol file is one byte lane of the word-addressed system_ramA BRAM:
  symbol0 — bits[7:0]   of each 32-bit word
  symbol1 — bits[15:8]
  symbol2 — bits[23:16]
  symbol3 — bits[31:24]

Each line in the output file is an 8-character binary string (e.g. "00010111")
representing one byte, compatible with Verilog $readmemb.

The output files are written to the same directory as the firmware binary
(unless --out-dir is specified), with the exact names that patch_sapphire_init.py
expects:
  EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol{0..3}.bin

Usage:
    python3 scripts/gen_sapphire_symbol_bins.py firmware/firmware.bin
    python3 scripts/gen_sapphire_symbol_bins.py firmware/firmware.bin --out-dir .
"""

import sys
import os
import argparse

SYMBOL_NAMES = [
    "EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol0.bin",
    "EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol1.bin",
    "EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol2.bin",
    "EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol3.bin",
]

RAM_WORDS = 8192


def gen_symbol_bins(firmware_path, out_dir):
    with open(firmware_path, "rb") as f:
        data = f.read()

    fw_words = (len(data) + 3) // 4
    if fw_words > RAM_WORDS:
        print(
            f"ERROR: firmware is {fw_words} words ({len(data)} bytes) but "
            f"system_ramA is only {RAM_WORDS} words ({RAM_WORDS*4} bytes).",
            file=sys.stderr,
        )
        sys.exit(1)

    padded = data + bytes(RAM_WORDS * 4 - len(data))

    nonzero_per_lane = [0, 0, 0, 0]
    for lane in range(4):
        out_path = os.path.join(out_dir, SYMBOL_NAMES[lane])
        with open(out_path, "w") as f:
            for word_idx in range(RAM_WORDS):
                byte_offset = word_idx * 4 + lane
                b = padded[byte_offset]
                f.write(f"{b:08b}\n")
                if b:
                    nonzero_per_lane[lane] += 1
        print(
            f"  Wrote {out_path}  "
            f"({RAM_WORDS} entries, {nonzero_per_lane[lane]} non-zero)"
        )

    print(
        f"\nSymbol bins ready.  Firmware: {len(data)} bytes ({fw_words} words), "
        f"padded to {RAM_WORDS} words."
    )


def main():
    parser = argparse.ArgumentParser(description="Generate sapphire symbol bins from firmware.bin")
    parser.add_argument("firmware", help="Path to firmware.bin (raw RISC-V binary)")
    parser.add_argument(
        "--out-dir",
        default=None,
        help="Directory to write symbol bin files (default: same directory as firmware.bin)",
    )
    args = parser.parse_args()

    out_dir = args.out_dir if args.out_dir else os.path.dirname(os.path.abspath(args.firmware))
    if not out_dir:
        out_dir = "."

    gen_symbol_bins(args.firmware, out_dir)


if __name__ == "__main__":
    main()
