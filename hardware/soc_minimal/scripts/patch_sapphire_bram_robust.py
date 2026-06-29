#!/usr/bin/env python3
"""
hardware/soc_minimal/scripts/patch_sapphire_bram_robust.py

Robust replacement for patch_sapphire_init.py Variant B.

Uses a line-by-line state-machine parser instead of regex so it works
correctly whether sapphire.v contains:
  - The original 4-line stub  (4 assignments, 1 initial block)
  - A previously-patched file  (8192 assignments, 4 initial blocks)
  - Any mix of the above

All initial begin...end blocks that contain ram_symbol assignments are
removed and replaced with 4 fresh blocks (one per lane) at the position
of the first removed block.

Usage:
  python3 patch_sapphire_bram_robust.py <sapphire.v> <dir_with_bin_files>

  sapphire.v          -- modified in-place; .bak_robust kept for safety
  dir_with_bin_files  -- contains EfxSapphireSoc...symbol{0..3}.bin files
"""

import sys
import os
import re
import shutil

BIN_NAMES = [
    "EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol0.bin",
    "EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol1.bin",
    "EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol2.bin",
    "EfxSapphireSoc.v_toplevel_system_ramA_logic_ram_symbol3.bin",
]
RAM_NAMES = ["ram_symbol0", "ram_symbol1", "ram_symbol2", "ram_symbol3"]

OUTER_INDENT = "  "
INNER_INDENT = "            "


def load_lane(path, max_words):
    vals = []
    with open(path) as f:
        for line in f:
            s = line.strip()
            if s:
                vals.append(int(s, 2))
                if len(vals) >= max_words:
                    break
    return vals


def detect_depth(lines):
    for line in lines:
        m = re.search(r'reg\s+\[7:0\]\s+ram_symbol0\s+\[0:(\d+)\]', line)
        if m:
            return int(m.group(1)) + 1
    return 8192


def detect_inner_indent(lines):
    for line in lines:
        if 'ram_symbol0[0]' in line and "= 8'h" in line:
            return line[: len(line) - len(line.lstrip())]
    return INNER_INDENT


def find_ram_initial_blocks(lines):
    """
    State-machine scan.  Returns list of (start, end) half-open line ranges
    for every 'initial begin...end' block that contains a ram_symbol assignment.
    """
    ranges = []
    i = 0
    n = len(lines)
    while i < n:
        if lines[i].strip() == "initial begin":
            start = i
            i += 1
            has_ram = False
            while i < n:
                stripped = lines[i].strip()
                if any(rn + "[" in lines[i] and "= 8'h" in lines[i]
                       for rn in RAM_NAMES):
                    has_ram = True
                i += 1
                if stripped == "end":
                    break
            if has_ram:
                ranges.append((start, i))
        else:
            i += 1
    return ranges


def build_new_blocks(fw_lanes, depth, inner_indent):
    block_lines = []
    for lane_idx, ram_name in enumerate(RAM_NAMES):
        block_lines.append(f"{OUTER_INDENT}initial begin\n")
        for idx, v in enumerate(fw_lanes[lane_idx]):
            block_lines.append(f"{inner_indent}{ram_name}[{idx}] = 8'h{v:02X};\n")
        block_lines.append(f"{OUTER_INDENT}end\n")
    return block_lines


def patch(sapphire_path, bin_dir):
    if not os.path.exists(sapphire_path):
        print(f"ERROR: {sapphire_path} not found")
        sys.exit(1)

    for name in BIN_NAMES:
        p = os.path.join(bin_dir, name)
        if not os.path.exists(p):
            print(f"ERROR: {p} not found")
            print("Run 'make' in the firmware/ directory first.")
            sys.exit(1)

    with open(sapphire_path) as f:
        lines = f.readlines()

    depth = detect_depth(lines)
    print(f"  BRAM depth: {depth} words ({depth * 4 // 1024} KB per lane)")

    inner_indent = detect_inner_indent(lines)
    print(f"  Inner indent: {len(inner_indent)} chars")

    print("  Loading firmware lane files...")
    fw_lanes = []
    for name in BIN_NAMES:
        vals = load_lane(os.path.join(bin_dir, name), depth)
        vals += [0] * (depth - len(vals))
        fw_lanes.append(vals)
        nz = sum(1 for v in vals if v)
        print(f"    {name}: {nz} non-zero entries")

    block_ranges = find_ram_initial_blocks(lines)
    print(f"  Found {len(block_ranges)} ram_symbol initial block(s) to replace")

    if not block_ranges:
        print("ERROR: No ram_symbol initial blocks found in sapphire.v")
        print("Check that sapphire.v contains 'initial begin' with ram_symbol lines.")
        sys.exit(1)

    new_blocks = build_new_blocks(fw_lanes, depth, inner_indent)

    skip = set()
    for start, end in block_ranges:
        for j in range(start, end):
            skip.add(j)
    insert_at = block_ranges[0][0]

    out = []
    inserted = False
    for j, line in enumerate(lines):
        if j in skip:
            if j == insert_at and not inserted:
                out.extend(new_blocks)
                inserted = True
        else:
            out.append(line)

    bak = sapphire_path + ".bak_robust"
    if not os.path.exists(bak):
        shutil.copy2(sapphire_path, bak)
        print(f"  Safety backup: {bak}")

    with open(sapphire_path, "w") as f:
        f.writelines(out)

    nz = sum(1 for v in fw_lanes[0] if v)
    print(f"\nDone. {len(block_ranges)} block(s) replaced with 4 new blocks.")
    print(f"  Lane 0 non-zero entries: {nz}/{depth}")
    print(f"  Total assignments written: {len(RAM_NAMES) * depth:,}")
    print("\nNext: strip banned XML params, then run efx_map + efx_pnr.")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(f"Usage: python3 {sys.argv[0]} <sapphire.v> <dir_with_bin_files>")
        sys.exit(1)
    patch(sys.argv[1], sys.argv[2])
