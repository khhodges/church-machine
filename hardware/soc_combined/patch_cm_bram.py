#!/usr/bin/env python3
"""patch_cm_bram.py — Fix CM BRAM initialisation in church_ti60_f225.v for Efinix EFX_MAP.

ROOT CAUSE
----------
EFX_MAP silently ignores `initial begin` blocks that initialise a 32-bit-wide
inferred array (`reg [31:0] dmem [...]`).  The CM BRAM comes out all-zeros
after synthesis, NIA stays stuck at 0x00000000, and the Sapphire firmware fires
the NULL_CAP fault watchdog on every boot.

FIX
---
EFX_MAP *does* correctly initialise BRAM inferred from **byte-wide** arrays
(`reg [7:0] lane [...]`) — exactly what Amaranth/SpinalHDL generates for the
Sapphire SoC firmware RAM.  This script rewrites the relevant section of
church_ti60_f225.v so that the single 32-bit-wide `dmem` array becomes four
byte-wide lane arrays (`dmem_b0`–`dmem_b3`), with matching updates to the
write and read `always` blocks.

The four-lane structure is:
  dmem_b0  → bits  7:0   (LSB)
  dmem_b1  → bits 15:8
  dmem_b2  → bits 23:16
  dmem_b3  → bits 31:24  (MSB)

Usage:
    python3 patch_cm_bram.py [PROJECT_DIR]

  PROJECT_DIR — directory that contains church_ti60_f225.v.
                Defaults to the directory containing this script.

Run BEFORE efx_map (Efinity synthesis).  Re-run whenever church_ti60_f225.v
is regenerated (build/church_ti60_f225.v → cp to SoC dir → patch → synth).
"""
import sys
import os
import re


# ── Patterns to locate the four regions we need to replace ──────────────────

# 1. Declaration: optional (* src ... *) attribute line + reg declaration
DECL_PAT = re.compile(
    r'(?:\(\* src[^*]*\*\)\n)?'       # optional Yosys src attribute
    r'  reg \[31:0\] dmem \[(\d+):0\];\n',  # captures depth-1
    re.MULTILINE,
)

# 2. Initial begin block (sparse — only assigned entries are listed)
INIT_PAT = re.compile(
    r'  initial begin\n'
    r'((?:    dmem\[\d+\] = 32\'d\d+;\n)*)'
    r'  end\n',
    re.MULTILINE,
)

# 3. Write always block
WRITE_PAT = re.compile(
    r'  always @\(posedge clk\) begin\n'
    r'    if \(dmem_wr__en\)\n'
    r'      dmem\[dmem_wr__addr\] <= dmem_wr__data;\n'
    r'  end\n',
    re.MULTILINE,
)

# 4. Read always block (includes the _0_ register declaration)
READ_PAT = re.compile(
    r'  reg \[31:0\] _0_;\n'
    r'  always @\(posedge clk\) begin\n'
    r'    _0_ <= dmem\[mem_addr\];\n'
    r'  end\n'
    r'  assign mem_rd_data = _0_;\n',
    re.MULTILINE,
)

ALREADY_PATCHED_SENTINEL = 'dmem_b0'


def main():
    if len(sys.argv) > 1:
        project_dir = os.path.abspath(sys.argv[1])
    else:
        project_dir = os.path.dirname(os.path.abspath(__file__))

    vpath = os.path.join(project_dir, 'church_ti60_f225.v')
    if not os.path.isfile(vpath):
        print(f'ERROR: not found: {vpath}')
        print('       Pass the directory that contains church_ti60_f225.v.')
        sys.exit(1)

    print(f'Reading {vpath} ...')
    src = open(vpath).read()

    if ALREADY_PATCHED_SENTINEL in src:
        print('church_ti60_f225.v already patched (dmem_b0 present) — nothing to do.')
        sys.exit(0)

    # Detect the OLD $readmemh patch (prev version of this script) — cannot
    # apply the byte-lane rewrite on top of it; need the original source.
    if '$readmemh' in src and 'church_dmem.mem' in src:
        print('ERROR: church_ti60_f225.v has the OLD $readmemh patch applied.')
        print('       Re-copy the original file from the repo, then re-run:')
        print()
        print('  cd ~/church_project/SoC/church-machine && git pull')
        print('  cp build/church_ti60_f225.v ~/church_project/SoC/church_ti60_f225.v')
        print(f'  python3 hardware/soc_combined/patch_cm_bram.py {project_dir}')
        sys.exit(1)

    # ── Step 1: find declaration, extract depth ──────────────────────────────
    dm = DECL_PAT.search(src)
    if not dm:
        print('ERROR: could not find  reg [31:0] dmem [N:0]  declaration.')
        sys.exit(1)
    depth = int(dm.group(1)) + 1          # e.g. 16383 → depth=16384
    depth_idx = depth - 1                 # Verilog [N:0] upper bound
    print(f'  dmem depth: {depth} words ({depth * 4 // 1024} KB)')

    # ── Step 2: find initial begin, parse values ─────────────────────────────
    im = INIT_PAT.search(src)
    if not im:
        print('ERROR: could not locate  initial begin  block with dmem[] entries.')
        sys.exit(1)
    block_body = im.group(1)
    vals = {}
    for line in block_body.splitlines():
        lm = re.match(r"    dmem\[(\d+)\] = 32'd(\d+);", line)
        if lm:
            vals[int(lm.group(1))] = int(lm.group(2))
    nonzero = sum(1 for v in vals.values() if v)
    print(f'  Initial block: {len(vals)} entries, {nonzero} non-zero')

    # ── Build replacement strings ─────────────────────────────────────────────

    # New lane declarations (depth index is [0:N-1] for Verilog byte arrays)
    new_decls = (
        f'  reg [7:0] dmem_b0 [0:{depth_idx}];\n'
        f'  reg [7:0] dmem_b1 [0:{depth_idx}];\n'
        f'  reg [7:0] dmem_b2 [0:{depth_idx}];\n'
        f'  reg [7:0] dmem_b3 [0:{depth_idx}];\n'
    )

    # New initial begin — one line per non-zero byte (skip zero bytes; BRAM
    # INIT params default to 0 so unspecified entries are correctly zero).
    init_lines = ['  initial begin']
    for idx in sorted(vals.keys()):
        w = vals[idx]
        if w == 0:
            continue
        b0 =  w        & 0xFF
        b1 = (w >>  8) & 0xFF
        b2 = (w >> 16) & 0xFF
        b3 = (w >> 24) & 0xFF
        if b0:
            init_lines.append(f"    dmem_b0[{idx}] = 8'h{b0:02x};")
        if b1:
            init_lines.append(f"    dmem_b1[{idx}] = 8'h{b1:02x};")
        if b2:
            init_lines.append(f"    dmem_b2[{idx}] = 8'h{b2:02x};")
        if b3:
            init_lines.append(f"    dmem_b3[{idx}] = 8'h{b3:02x};")
    init_lines.append('  end')
    new_init = '\n'.join(init_lines) + '\n'

    new_write = (
        '  always @(posedge clk) begin\n'
        '    if (dmem_wr__en) begin\n'
        '      dmem_b0[dmem_wr__addr] <= dmem_wr__data[7:0];\n'
        '      dmem_b1[dmem_wr__addr] <= dmem_wr__data[15:8];\n'
        '      dmem_b2[dmem_wr__addr] <= dmem_wr__data[23:16];\n'
        '      dmem_b3[dmem_wr__addr] <= dmem_wr__data[31:24];\n'
        '    end\n'
        '  end\n'
    )

    new_read = (
        '  reg [31:0] _0_;\n'
        '  always @(posedge clk) begin\n'
        '    _0_ <= {dmem_b3[mem_addr], dmem_b2[mem_addr],\n'
        '            dmem_b1[mem_addr], dmem_b0[mem_addr]};\n'
        '  end\n'
        '  assign mem_rd_data = _0_;\n'
    )

    # ── Apply substitutions ───────────────────────────────────────────────────
    out = src

    # 1. Declaration → lane declarations
    out, n1 = DECL_PAT.subn(new_decls, out, count=1)
    if n1 != 1:
        print('ERROR: declaration substitution failed.')
        sys.exit(1)

    # 2. Initial begin → byte-lane initial begin
    out, n2 = INIT_PAT.subn(new_init, out, count=1)
    if n2 != 1:
        print('ERROR: initial begin substitution failed.')
        sys.exit(1)

    # 3. Write always block
    out, n3 = WRITE_PAT.subn(new_write, out, count=1)
    if n3 != 1:
        print('ERROR: write always block substitution failed.')
        sys.exit(1)

    # 4. Read always block
    out, n4 = READ_PAT.subn(new_read, out, count=1)
    if n4 != 1:
        print('ERROR: read always block substitution failed.')
        sys.exit(1)

    if out == src:
        print('ERROR: all patterns matched but file is unchanged — logic bug.')
        sys.exit(1)

    with open(vpath, 'w') as f:
        f.write(out)

    init_byte_count = len(init_lines) - 2  # subtract 'initial begin' and 'end'
    print(f'  Patched: {vpath}')
    print(f'  Declaration:  reg [31:0] dmem [{depth_idx}:0]  →  4 × reg [7:0] dmem_b0..3 [0:{depth_idx}]')
    print(f'  Initial begin: {init_byte_count} non-zero byte assignments')
    print(f'  Write block:  dmem[addr] <= data  →  4-lane byte writes')
    print(f'  Read block:   _0_ <= dmem[addr]   →  concat of 4 lane reads')
    print()
    print('Done. Now run synthesis:')
    print('  bash work_syn/run_efx_map.sh')
    print('  bash work_pnr/run_efx_pnr.sh')
    print('  bash ~/church_project/SoC/church-machine/hardware/soc_combined/run_efx_pgm.sh \\')
    print('       ~/church_project/SoC/church_soc_cm.xml')
    print('  sudo openFPGALoader -b titanium_ti60_f225_jtag \\')
    print('       -f ~/church_project/SoC/outflow/church_soc_cm.hex')


if __name__ == '__main__':
    main()
