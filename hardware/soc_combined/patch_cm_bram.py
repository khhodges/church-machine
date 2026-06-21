#!/usr/bin/env python3
"""patch_cm_bram.py — Fix CM BRAM initialisation in church_ti60_f225.v for Efinix EFX_MAP.

ROOT CAUSE
----------
EFX_MAP silently ignores ALL forms of `initial begin` on inferred arrays —
whether 32-bit wide or byte-lane 8-bit wide.  Both approaches produce an
all-zero BRAM after synthesis.

The ONLY confirmed working pattern for non-zero BRAM initialisation in this
Efinity project is the one used by the Sapphire SoC ROM:

    reg [7:0] rom_lane [0:N];
    initial $readmemb("lane.bin", rom_lane);

where the .bin file (ASCII 0/1 text, one 8-bit value per line) is present in
the `work_syn/` directory before efx_map runs.

FIX
---
This script:
  1. Rewrites church_ti60_f225.v: converts the single `reg [31:0] dmem [N:0]`
     to four `reg [7:0] dmem_b0..b3 [0:N]`, each using `$readmemb`.
  2. Writes four binary data files (cm_dmem_b0.bin … cm_dmem_b3.bin) into
     `<project_dir>/work_syn/` so they are present when efx_map runs.

Usage:
    python3 patch_cm_bram.py [PROJECT_DIR]

  PROJECT_DIR — directory that contains church_ti60_f225.v and work_syn/.
                Defaults to the directory containing this script.

Run BEFORE efx_map (Efinity synthesis).  Re-run whenever church_ti60_f225.v
is regenerated (build/church_ti60_f225.v → cp to SoC dir → patch → synth).
"""
import sys
import os
import re


ALREADY_PATCHED_SENTINEL = 'readmemb'


# ── Patterns to locate the four regions we need to replace ──────────────────

DECL_PAT = re.compile(
    r'(?:\(\* src[^*]*\*\)\n)?'
    r'  reg \[31:0\] dmem \[(\d+):0\];\n',
    re.MULTILINE,
)

INIT_PAT = re.compile(
    r'  initial begin\n'
    r'((?:    dmem\[\d+\] = 32\'d\d+;\n)*)'
    r'  end\n',
    re.MULTILINE,
)

WRITE_PAT = re.compile(
    r'  always @\(posedge clk\) begin\n'
    r'    if \(dmem_wr__en\)\n'
    r'      dmem\[dmem_wr__addr\] <= dmem_wr__data;\n'
    r'  end\n',
    re.MULTILINE,
)

READ_PAT = re.compile(
    r'  reg \[31:0\] _0_;\n'
    r'  always @\(posedge clk\) begin\n'
    r'    _0_ <= dmem\[mem_addr\];\n'
    r'  end\n'
    r'  assign mem_rd_data = _0_;\n',
    re.MULTILINE,
)


def write_bin_files(vals: dict, depth: int, work_syn_dir: str) -> None:
    """Write four byte-lane .bin files in $readmemb text format.

    Each file has `depth` lines (one per address, 0 to depth-1).
    Each line is 8 ASCII characters '0' or '1', MSB first.
    Files go into work_syn_dir so efx_map finds them by bare filename.
    """
    os.makedirs(work_syn_dir, exist_ok=True)
    lanes = [bytearray(depth) for _ in range(4)]
    for idx, w in vals.items():
        if 0 <= idx < depth:
            lanes[0][idx] = w & 0xFF
            lanes[1][idx] = (w >> 8) & 0xFF
            lanes[2][idx] = (w >> 16) & 0xFF
            lanes[3][idx] = (w >> 24) & 0xFF

    for n, lane in enumerate(lanes):
        fpath = os.path.join(work_syn_dir, f'cm_dmem_b{n}.bin')
        with open(fpath, 'w') as f:
            for byte_val in lane:
                f.write(f'{byte_val:08b}\n')
        print(f'  Wrote {fpath}  ({depth} lines)')


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

    work_syn_dir = os.path.join(project_dir, 'work_syn')

    print(f'Reading {vpath} ...')
    src = open(vpath).read()

    if ALREADY_PATCHED_SENTINEL in src:
        print('church_ti60_f225.v already has $readmemb — re-writing bin files only.')
        # Still write/refresh the bin files in case work_syn was cleaned
        dm = re.search(r'reg \[7:0\] dmem_b0 \[0:(\d+)\]', src)
        if not dm:
            print('ERROR: $readmemb sentinel present but cannot parse depth.')
            sys.exit(1)
        depth = int(dm.group(1)) + 1
        # Parse values from the existing bin files or re-extract from history
        # For safety, re-run the full flow: ask user to cp original first.
        print('       To apply a fresh patch, restore from build/church_ti60_f225.v first:')
        print()
        print('  cd ~/church_project/SoC/church-machine && git pull')
        print('  cp build/church_ti60_f225.v ~/church_project/SoC/church_ti60_f225.v')
        print(f'  python3 hardware/soc_combined/patch_cm_bram.py {project_dir}')
        print()
        print('Re-writing bin files from existing patched Verilog is not supported.')
        print('Please restore the original Verilog and re-run.')
        sys.exit(0)

    if '$readmemh' in src and 'church_dmem.mem' in src:
        print('ERROR: church_ti60_f225.v has the OLD $readmemh patch applied.')
        print('       Re-copy the original file from the repo, then re-run:')
        print()
        print('  cd ~/church_project/SoC/church-machine && git pull')
        print('  cp build/church_ti60_f225.v ~/church_project/SoC/church_ti60_f225.v')
        print(f'  python3 hardware/soc_combined/patch_cm_bram.py {project_dir}')
        sys.exit(1)

    # ── Step 1: find declaration ─────────────────────────────────────────────
    dm = DECL_PAT.search(src)
    if not dm:
        print('ERROR: could not find  reg [31:0] dmem [N:0]  declaration.')
        sys.exit(1)
    depth = int(dm.group(1)) + 1
    depth_idx = depth - 1
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

    # ── Step 3: write .bin files to work_syn/ ───────────────────────────────
    print(f'  Writing bin files to {work_syn_dir}/ ...')
    write_bin_files(vals, depth, work_syn_dir)

    # ── Build replacement strings ─────────────────────────────────────────────

    new_decls = (
        f'  reg [7:0] dmem_b0 [0:{depth_idx}];\n'
        f'  reg [7:0] dmem_b1 [0:{depth_idx}];\n'
        f'  reg [7:0] dmem_b2 [0:{depth_idx}];\n'
        f'  reg [7:0] dmem_b3 [0:{depth_idx}];\n'
        f'  initial $readmemb("cm_dmem_b0.bin", dmem_b0);\n'
        f'  initial $readmemb("cm_dmem_b1.bin", dmem_b1);\n'
        f'  initial $readmemb("cm_dmem_b2.bin", dmem_b2);\n'
        f'  initial $readmemb("cm_dmem_b3.bin", dmem_b3);\n'
    )

    new_init = ''

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

    out, n1 = DECL_PAT.subn(new_decls, out, count=1)
    if n1 != 1:
        print('ERROR: declaration substitution failed.')
        sys.exit(1)

    out, n2 = INIT_PAT.subn(new_init, out, count=1)
    if n2 != 1:
        print('ERROR: initial begin substitution failed.')
        sys.exit(1)

    out, n3 = WRITE_PAT.subn(new_write, out, count=1)
    if n3 != 1:
        print('ERROR: write always block substitution failed.')
        sys.exit(1)

    out, n4 = READ_PAT.subn(new_read, out, count=1)
    if n4 != 1:
        print('ERROR: read always block substitution failed.')
        sys.exit(1)

    if out == src:
        print('ERROR: all patterns matched but file is unchanged — logic bug.')
        sys.exit(1)

    with open(vpath, 'w') as f:
        f.write(out)

    print()
    print(f'  Patched: {vpath}')
    print(f'  reg [31:0] dmem [{depth_idx}:0] → 4 × reg [7:0] dmem_b0..3 [0:{depth_idx}]')
    print(f'  Initialisation: initial begin → $readmemb from work_syn/cm_dmem_b*.bin')
    print(f'  Write block: single 32-bit → 4-lane byte writes')
    print(f'  Read block:  _0_ <= dmem[addr] → concat of 4 lane reads')
    print()
    print('Done. Now run synthesis (bin files are already in work_syn/):')
    print('  bash work_syn/run_efx_map.sh')
    print('  bash work_pnr/run_efx_pnr.sh')
    print('  bash ~/church_project/SoC/church-machine/hardware/soc_combined/run_efx_pgm.sh \\')
    print('       ~/church_project/SoC/church_soc_cm.xml')
    print('  sudo openFPGALoader -b titanium_ti60_f225_jtag \\')
    print('       -f ~/church_project/SoC/outflow/church_soc_cm.hex')


if __name__ == '__main__':
    main()
