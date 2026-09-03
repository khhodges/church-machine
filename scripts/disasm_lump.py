#!/usr/bin/env python3
"""
scripts/disasm_lump.py — Church Machine ISA disassembler

Decodes any .lump binary file and prints the full disassembly to stdout.
Optionally writes the output to a .asm file.

Usage:
    python3 scripts/disasm_lump.py <path/to/file.lump>
    python3 scripts/disasm_lump.py <path/to/file.lump> --out output.asm
    python3 scripts/disasm_lump.py <path/to/file.lump> -o output.asm

LUMP binary format (all words big-endian 32-bit):
    Word 0       : header — magic(5)|n_minus_6(4)|cw(13)|typ(2)|cc(8)
    Words 1..cw  : instruction words
    Words cw+1.. : zero-pad (freespace)
    Words lumpSize-cc..lumpSize-1 : c-list GT words (tail-packed)

ISA encoding (v2.0) — standard instruction word layout:
    bits[31:27]  opcode  (5 bits)
    bits[26:23]  cond    (4 bits, ARM ordering; 14=AL=always)
    bits[22:19]  crDst   (4 bits — CR register, or DR register for Turing ops)
    bits[18:15]  crSrc   (4 bits — CR register, or DR register for Turing ops)
    bits[14:0]   imm     (15 bits — interpretation varies by opcode)

Church-domain opcodes (0–9):
    0  LOAD        CRd ← c-list[CRs + offset]
    1  SAVE        c-list[CRs + offset] ← CRd
    2  CALL        invoke CRd (optional method selector in imm)
    3  RETURN      unwind call frame
    4  CHANGE      atomic c-list swap
    5  SWITCH      M-gated special LOAD into CR12–CR15
    6  TPERM       assert/attenuate GT permission
    7  LAMBDA      create closure from template
    8  ELOADCALL   fused load+call (c-list row in imm[4:0], method in imm[11:5])
    9  XLOADLAMBDA fused load+lambda

Turing-domain opcodes (16–25):
   16  DREAD       DRd ← device[CRs + offset] (immediate bit14=1) or indexed (bit14=0)
   17  DWRITE      device[CRs + offset] ← DRd
   18  BFEXT       bit-field extract
   19  BFINS       bit-field insert
   20  MCMP        compare, update condition flags
   21  IADD        DRd ← DRs + DRm  (or + imm14, when bit14=1)
   22  ISUB        DRd ← DRs − DRm  (or − imm14, when bit14=1)
   23  BRANCH      PC-relative conditional branch (15-bit signed offset)
   24  SHL         shift left
   25  SHR         shift right [ASR]

Special encodings:
   0x1E  WORD      inline 27-bit data constant (not executable)
   0x1F  (header)  lump header magic (word 0 only)

Opcodes 10–15 and 26–29 are unassigned and will disassemble as "???".
"""

import struct
import sys
import os
import argparse

# ── Condition code names (ARM ordering, index 0–15) ─────────────────────────
#   14 = AL (always / unconditional) — shown explicitly as "AL" here
_COND_NAMES = [
    'EQ', 'NE', 'CS', 'CC', 'MI', 'PL', 'VS', 'VC',
    'HI', 'LS', 'GE', 'LT', 'GT', 'LE', 'AL', 'NV',
]

# ── Opcode name table ─────────────────────────────────────────────────────────
_OP_NAMES = {
    0:  'LOAD',        1:  'SAVE',        2:  'CALL',     3:  'RETURN',
    4:  'CHANGE',      5:  'SWITCH',      6:  'TPERM',    7:  'LAMBDA',
    8:  'ELOADCALL',   9:  'XLOADLAMBDA',
    16: 'DREAD',       17: 'DWRITE',      18: 'BFEXT',    19: 'BFINS',
    20: 'MCMP',        21: 'IADD',        22: 'ISUB',     23: 'BRANCH',
    24: 'SHL',         25: 'SHR',
}

# ── TPERM preset names ────────────────────────────────────────────────────────
_TPERM_PRESETS = [
    'CLEAR', 'R', 'RW', 'X', 'RX', 'RWX', 'L', 'S',
    'E', 'LS', 'RSV3', 'RSV4', 'RSV5', 'FRAME', 'EXACT', 'RSV1',
]

# ── Object type names ─────────────────────────────────────────────────────────
_TYP_NAMES = ['lump', 'namespace', 'thread', '?']


def _hexoff(n):
    """Format a 15-bit offset as 0x-prefixed 4-digit hex (like assembler.js)."""
    return f'0x{n:04X}'


def _cdoff(n):
    """Format a c-list slot access via CR6."""
    return f'CR6[{_hexoff(n)}]'



def disassemble_word(word, idx=None, cw=None):
    """
    Disassemble a single 32-bit instruction word.

    Returns a string mnemonic.  When idx and cw are provided, BRANCH targets
    are shown as absolute instruction indices in square brackets (e.g. "[03]").

    Parameters
    ----------
    word : int
        32-bit big-endian instruction word.
    idx : int or None
        Instruction index (0-based within the code region).  Used to compute
        absolute BRANCH targets.
    cw : int or None
        Total code-word count from the lump header.  Not used for decoding;
        reserved for future bounds checks.
    """
    word = word & 0xFFFFFFFF

    if word == 0:
        return 'HALT'

    opcode = (word >> 27) & 0x1F
    cond   = (word >> 23) & 0xF
    cr_dst = (word >> 19) & 0xF
    cr_src = (word >> 15) & 0xF
    imm    = word & 0x7FFF

    # ── WORD inline data constant ────────────────────────────────────────────
    if opcode == 0x1E:
        payload = word & 0x7FFFFFF
        return f'WORD 0x{payload:07X}'

    # ── Lump header magic (should only appear at word 0) ────────────────────
    if opcode == 0x1F:
        n_minus_6 = (word >> 23) & 0xF
        cw_hdr    = (word >> 10) & 0x1FFF
        typ       = (word >>  8) & 0x3
        cc        = word & 0xFF
        lump_size = 1 << (n_minus_6 + 6)
        typ_name  = _TYP_NAMES[typ] if typ < len(_TYP_NAMES) else '?'
        return (f'.header {typ_name}  n-6={n_minus_6}→{lump_size}w'
                f'  cw={cw_hdr}  cc={cc}')

    # ── Unknown opcode ────────────────────────────────────────────────────────
    if opcode not in _OP_NAMES:
        return f'??? 0x{word:08X}'

    op       = _OP_NAMES[opcode]
    cond_str = _COND_NAMES[cond]
    mnemonic = op + cond_str if cond_str != 'AL' else op

    # ── Per-opcode formatting ─────────────────────────────────────────────────
    if opcode == 0:       # LOAD
        if cr_src == 6:
            return f'{mnemonic}  CR{cr_dst}, {_cdoff(imm)}'
        return f'{mnemonic}  CR{cr_dst}, CR{cr_src}[{_hexoff(imm)}]'

    if opcode == 1:       # SAVE
        if cr_src == 6:
            return f'{mnemonic}  CR{cr_dst}, {_cdoff(imm)}'
        return f'{mnemonic}  CR{cr_dst}, CR{cr_src}[{_hexoff(imm)}]'

    if opcode == 2:       # CALL
        if imm & 0x4000 or imm == 0:
            return f'{mnemonic}  CR{cr_dst}'
        sel = imm - 1
        return f'{mnemonic}  CR{cr_dst}, sel={sel}'

    if opcode == 3:       # RETURN
        ret_mask = imm & 0xFFF
        if ret_mask:
            return f'{mnemonic}  0b{ret_mask:012b}'
        return mnemonic

    if opcode == 4:       # CHANGE
        if cr_src == 6:
            return f'{mnemonic}  CR{cr_dst}, {_cdoff(imm)}'
        return f'{mnemonic}  CR{cr_dst}, CR{cr_src}[{_hexoff(imm)}]'

    if opcode == 5:       # SWITCH
        return f'{mnemonic}  CR{cr_dst}, CR{cr_src}, #{_hexoff(imm)}'

    if opcode == 6:       # TPERM
        b_flag    = (imm >> 4) & 1
        base_code = imm & 0xF
        base_name = _TPERM_PRESETS[base_code] if base_code < len(_TPERM_PRESETS) else 'RSV'
        if base_code == 14:  # EXACT mode
            return f'{mnemonic}  CR{cr_dst}, EXACT, CR{cr_src}'
        return f'{mnemonic}  CR{cr_dst}, {base_name}{"B" if b_flag else ""}'

    if opcode == 7:       # LAMBDA
        return f'{mnemonic}  CR{cr_dst}'

    if opcode == 8:       # ELOADCALL
        row    = imm & 0x1F
        method = (imm >> 5) & 0x7F
        src    = _cdoff(row) if cr_src == 6 else f'CR{cr_src}[{_hexoff(row)}]'
        if method > 0:
            return f'{mnemonic}  CR{cr_dst}, {src}, {method - 1}'
        return f'{mnemonic}  CR{cr_dst}, {src}'

    if opcode == 9:       # XLOADLAMBDA
        if cr_src == 6:
            return f'{mnemonic}  CR{cr_dst}, {_cdoff(imm)}'
        return f'{mnemonic}  CR{cr_dst}, CR{cr_src}[{_hexoff(imm)}]'

    if opcode in (16, 17):  # DREAD / DWRITE
        if imm & 0x4000:
            return f'{mnemonic}  DR{cr_dst}, CR{cr_src}, #{imm & 0x3FFF}'
        base = (imm >> 4) & 0x3FF
        drx  = imm & 0xF
        return f'{mnemonic}  DR{cr_dst}, CR{cr_src}, #{base}, DR{drx}'

    if opcode in (18, 19):  # BFEXT / BFINS
        pos   = (imm >> 5) & 0x1F
        width = imm & 0x1F
        return f'{mnemonic}  DR{cr_dst}, DR{cr_src}, #{pos}, #{width}'

    if opcode == 20:      # MCMP
        return f'{mnemonic}  DR{cr_dst}, DR{cr_src}'

    if opcode in (21, 22):  # IADD / ISUB
        if imm & 0x4000:
            # Immediate is 14-bit unsigned (bits[13:0]); matches assembler.js
            # `imm & 0x3FFF` — no sign extension.  Negative source literals are
            # stored as their two's-complement 14-bit encoding (e.g. -1 → 16383).
            return f'{mnemonic}  DR{cr_dst}, DR{cr_src}, #{imm & 0x3FFF}'
        return f'{mnemonic}  DR{cr_dst}, DR{cr_src}, DR{imm & 0xF}'

    if opcode == 23:      # BRANCH
        soff   = imm - 0x8000 if (imm & 0x4000) else imm
        target = (idx + soff) if idx is not None else None
        if target is not None:
            return f'{mnemonic}  [{target:02d}]  ; offset {soff:+d}'
        return f'{mnemonic}  {soff:+d}'

    if opcode == 24:      # SHL
        return f'{mnemonic}  DR{cr_dst}, DR{cr_src}, {imm & 0x1F}'

    if opcode == 25:      # SHR
        arith = (imm >> 5) & 1
        shamt = imm & 0x1F
        return f'{mnemonic}  DR{cr_dst}, DR{cr_src}, {shamt}{"  ASR" if arith else ""}'

    return f'??? 0x{word:08X}'


def parse_lump_header(word):
    """
    Parse a LUMP header word.

    Returns a dict with keys:
        valid     — bool, True when magic == 0x1F
        magic     — int (5-bit)
        n_minus_6 — int (4-bit)
        lump_size — int (words, power of 2)
        cw        — int (code-word count)
        typ       — int (0=lump, 1=namespace, 2=thread, 3=?)
        cc        — int (c-list slot count)
    """
    word      = word & 0xFFFFFFFF
    magic     = (word >> 27) & 0x1F
    n_minus_6 = (word >> 23) & 0xF
    cw        = (word >> 10) & 0x1FFF
    typ       = (word >>  8) & 0x3
    cc        = word & 0xFF
    lump_size = 1 << (n_minus_6 + 6)
    return {
        'valid':     magic == 0x1F,
        'magic':     magic,
        'n_minus_6': n_minus_6,
        'lump_size': lump_size,
        'cw':        cw,
        'typ':       typ,
        'cc':        cc,
    }


def disassemble_lump(path):
    """
    Disassemble a .lump file.

    Returns a list of strings (one per output line).  Does not include a
    trailing newline on each line.

    Raises ValueError if the file is not a valid .lump (bad magic).
    Raises FileNotFoundError / IOError for file-access problems (propagated).
    """
    with open(path, 'rb') as f:
        data = f.read()

    if len(data) < 4:
        raise ValueError(f'File too short to contain a lump header ({len(data)} bytes)')

    # Read all 32-bit big-endian words
    n_words = len(data) // 4
    words = struct.unpack_from(f'>{n_words}I', data)

    # ── Parse header ──────────────────────────────────────────────────────────
    hdr = parse_lump_header(words[0])
    if not hdr['valid']:
        raise ValueError(
            f"Not a valid LUMP file: header magic=0x{hdr['magic']:02X} "
            f"(expected 0x1F).  Word 0 = 0x{words[0]:08X}"
        )

    lump_size = hdr['lump_size']
    cw        = hdr['cw']
    cc        = hdr['cc']
    typ       = hdr['typ']
    typ_name  = _TYP_NAMES[typ] if typ < len(_TYP_NAMES) else '?'

    if lump_size > n_words:
        raise ValueError(
            f'LUMP claims lump_size={lump_size} words but file only has '
            f'{n_words} words ({len(data)} bytes)'
        )

    clist_base = lump_size - cc      # word index of first c-list slot

    lines = []

    # ── Header ───────────────────────────────────────────────────────────────
    lines.append(f'; Disassembly of: {os.path.basename(path)}')
    lines.append(f';')
    lines.append(f'; Header (word 0)  : 0x{words[0]:08X}')
    lines.append(f';   magic          : 0x{hdr["magic"]:02X}  ({"valid" if hdr["valid"] else "INVALID"})')
    lines.append(f';   n_minus_6      : {hdr["n_minus_6"]}  →  lump_size = {lump_size} words ({lump_size * 4} bytes)')
    lines.append(f';   cw             : {cw}  (code words, indices 0–{cw - 1})')
    lines.append(f';   typ            : {typ}  ({typ_name})')
    lines.append(f';   cc             : {cc}  (c-list slots)')
    lines.append(f';   c-list base    : word {clist_base}  (addr 0x{clist_base * 4:04X})')
    lines.append(f';')

    # ── Code section ─────────────────────────────────────────────────────────
    lines.append(f'; ── Code section  ({cw} instructions) ──────────────────────────────')
    for i in range(cw):
        wi   = 1 + i          # word index in file
        addr = wi * 4
        w    = words[wi] if wi < n_words else 0
        dis  = disassemble_word(w, idx=i, cw=cw)
        lines.append(f'[{i:03d}]  addr=0x{addr:04X}  {w:08X}  {dis}')

    # ── Freespace ─────────────────────────────────────────────────────────────
    free_start = 1 + cw
    free_end   = clist_base       # exclusive
    free_count = free_end - free_start
    if free_count > 0:
        lines.append(f';')
        lines.append(f'; ── Freespace  ({free_count} words, addr 0x{free_start * 4:04X}–0x{(free_end - 1) * 4:04X}) ──')
        all_zero = all((words[wi] if wi < n_words else 0) == 0
                       for wi in range(free_start, free_end))
        if all_zero:
            lines.append(f';   (all zero)')
        else:
            for wi in range(free_start, free_end):
                w = words[wi] if wi < n_words else 0
                if w:
                    lines.append(f';   word[{wi}]  addr=0x{wi * 4:04X}  {w:08X}')

    # ── C-list section ────────────────────────────────────────────────────────
    if cc > 0:
        lines.append(f';')
        lines.append(f'; ── C-list  ({cc} slots, addr 0x{clist_base * 4:04X}–0x{(lump_size - 1) * 4:04X}) ──')
        for slot in range(cc):
            wi = clist_base + slot
            w  = words[wi] if wi < n_words else 0
            lines.append(f';   slot[{slot}]  word[{wi}]  addr=0x{wi * 4:04X}  GT=0x{w:08X}')

    return lines


def main():
    parser = argparse.ArgumentParser(
        description='Church Machine ISA disassembler — decode a .lump file.',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument('lump', metavar='FILE.lump',
                        help='Path to the .lump binary file to disassemble.')
    parser.add_argument('-o', '--out', metavar='FILE.asm',
                        help='Write output to this file (default: stdout only).')
    args = parser.parse_args()

    try:
        lines = disassemble_lump(args.lump)
    except (ValueError, FileNotFoundError, IOError) as e:
        print(f'ERROR: {e}', file=sys.stderr)
        sys.exit(1)

    output = '\n'.join(lines) + '\n'
    print(output, end='')

    if args.out:
        with open(args.out, 'w') as f:
            f.write(output)
        print(f'; Written to {args.out}', file=sys.stderr)


if __name__ == '__main__':
    main()
