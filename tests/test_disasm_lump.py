"""
tests/test_disasm_lump.py

Regression test for scripts/disasm_lump.py.

Verifies that the ISA disassembler correctly decodes
WukongCallHome.hw.1.1dcb7b09.lump — a 73-instruction real-hardware
binary whose encoding has been fully confirmed word-for-word.

Coverage:
  - LUMP header parsing (magic, lump_size, cw, cc, typ)
  - Instruction [0]: LOAD (Church-domain, c-list access via CR6)
  - Instruction [72]: BRANCH AL with negative signed offset, target [03]
  - CLI entry point produces output containing both instructions
"""

import os
import subprocess
import sys
import pytest

# ── Paths ──────────────────────────────────────────────────────────────────────
ROOT      = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SCRIPT    = os.path.join(ROOT, 'scripts', 'disasm_lump.py')
LUMP_FILE = os.path.join(ROOT, 'server', 'lumps',
                         'WukongCallHome.hw.1.1dcb7b09.lump')

# ── Helpers ───────────────────────────────────────────────────────────────────

def _import_disasm():
    """Import disasm_lump as a module (adds scripts/ to sys.path if needed)."""
    scripts_dir = os.path.join(ROOT, 'scripts')
    if scripts_dir not in sys.path:
        sys.path.insert(0, scripts_dir)
    import importlib
    import importlib.util
    spec = importlib.util.spec_from_file_location('disasm_lump', SCRIPT)
    mod  = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ── Tests: library API ────────────────────────────────────────────────────────

class TestDisasmLumpAPI:

    @pytest.fixture(scope='class')
    def mod(self):
        return _import_disasm()

    @pytest.fixture(scope='class')
    def lines(self, mod):
        return mod.disassemble_lump(LUMP_FILE)

    # ── Header decoding ────────────────────────────────────────────────────────

    def test_lump_file_exists(self):
        assert os.path.isfile(LUMP_FILE), \
            f'Reference lump not found: {LUMP_FILE}'

    def test_header_magic_valid(self, mod):
        import struct
        with open(LUMP_FILE, 'rb') as f:
            word0 = struct.unpack('>I', f.read(4))[0]
        hdr = mod.parse_lump_header(word0)
        assert hdr['valid'], \
            f'Header magic invalid: 0x{hdr["magic"]:02X} (expected 0x1F)'

    def test_header_lump_size(self, mod):
        import struct
        with open(LUMP_FILE, 'rb') as f:
            word0 = struct.unpack('>I', f.read(4))[0]
        hdr = mod.parse_lump_header(word0)
        assert hdr['lump_size'] == 128, \
            f'Expected lump_size=128, got {hdr["lump_size"]}'

    def test_header_cw(self, mod):
        import struct
        with open(LUMP_FILE, 'rb') as f:
            word0 = struct.unpack('>I', f.read(4))[0]
        hdr = mod.parse_lump_header(word0)
        assert hdr['cw'] == 73, \
            f'Expected cw=73, got {hdr["cw"]}'

    def test_header_cc(self, mod):
        import struct
        with open(LUMP_FILE, 'rb') as f:
            word0 = struct.unpack('>I', f.read(4))[0]
        hdr = mod.parse_lump_header(word0)
        assert hdr['cc'] == 2, \
            f'Expected cc=2, got {hdr["cc"]}'

    def test_header_typ(self, mod):
        import struct
        with open(LUMP_FILE, 'rb') as f:
            word0 = struct.unpack('>I', f.read(4))[0]
        hdr = mod.parse_lump_header(word0)
        assert hdr['typ'] == 0, \
            f'Expected typ=0 (lump), got {hdr["typ"]}'

    # ── Instruction [0]: LOAD ──────────────────────────────────────────────────

    def test_instruction_0_is_load(self, lines):
        """Instruction [0] must start with LOAD (case-sensitive, no cond suffix)."""
        instr0 = next((l for l in lines if l.startswith('[000]')), None)
        assert instr0 is not None, \
            'No [000] instruction line found in disassembly output'
        # The mnemonic field follows the address+hex columns
        assert '  LOAD  ' in instr0 or '  LOAD ' in instr0, \
            f'Instruction [0] is not LOAD: {instr0!r}'

    def test_instruction_0_loads_cr3(self, lines):
        """Instruction [0] loads LED0→CR3 from c-list slot 0 via CR6."""
        instr0 = next((l for l in lines if l.startswith('[000]')), None)
        assert 'CR3' in instr0, \
            f'Instruction [0] should target CR3: {instr0!r}'

    def test_instruction_0_uses_cr6_slot0(self, lines):
        """Instruction [0] loads from c-list slot 0 (CR6[0x0000])."""
        instr0 = next((l for l in lines if l.startswith('[000]')), None)
        assert 'CR6[0x0000]' in instr0, \
            f'Instruction [0] should reference CR6[0x0000]: {instr0!r}'

    # ── Instruction [72]: BRANCH AL to [03] ───────────────────────────────────

    def test_instruction_72_is_branch(self, lines):
        """Instruction [72] must be a BRANCH."""
        instr72 = next((l for l in lines if l.startswith('[072]')), None)
        assert instr72 is not None, \
            'No [072] instruction line found in disassembly output'
        assert 'BRANCH' in instr72, \
            f'Instruction [72] is not BRANCH: {instr72!r}'

    def test_instruction_72_is_unconditional(self, lines):
        """Instruction [72] must be unconditional (AL — no condition suffix)."""
        instr72 = next((l for l in lines if l.startswith('[072]')), None)
        # AL branch: mnemonic is exactly "BRANCH" (no suffix like EQ/NE/etc.)
        assert '  BRANCH  ' in instr72 or '  BRANCH ' in instr72, \
            f'Instruction [72] is not an unconditional BRANCH (AL): {instr72!r}'

    def test_instruction_72_targets_03(self, lines):
        """Instruction [72] BRANCH must target instruction [03] (loop_top)."""
        instr72 = next((l for l in lines if l.startswith('[072]')), None)
        assert '[03]' in instr72, \
            f'Instruction [72] should target [03]: {instr72!r}'

    def test_instruction_72_offset_minus_69(self, lines):
        """Instruction [72] BRANCH offset must be -69 (72 + (-69) = 3)."""
        instr72 = next((l for l in lines if l.startswith('[072]')), None)
        assert '-69' in instr72, \
            f'Instruction [72] BRANCH offset should be -69: {instr72!r}'

    # ── Output structure ───────────────────────────────────────────────────────

    def test_output_has_73_instructions(self, lines):
        """Output must contain exactly 73 [NNN] instruction lines."""
        instr_lines = [l for l in lines if l.startswith('[') and ']' in l
                       and l[0] == '[' and l[4] == ']']
        assert len(instr_lines) == 73, \
            f'Expected 73 instruction lines, got {len(instr_lines)}'

    def test_output_has_freespace_section(self, lines):
        """Output must include a freespace section comment."""
        assert any('Freespace' in l for l in lines), \
            'No freespace section found in disassembly output'

    def test_output_has_clist_section(self, lines):
        """Output must include a c-list section comment."""
        assert any('C-list' in l for l in lines), \
            'No c-list section found in disassembly output'

    def test_clist_slot0_gt(self, lines):
        """C-list slot[0] must carry the LED0 GT (0x32000003)."""
        clist_line = next((l for l in lines if 'slot[0]' in l), None)
        assert clist_line is not None, 'No c-list slot[0] line in output'
        assert '0x32000003' in clist_line.upper() or '32000003' in clist_line.upper(), \
            f'C-list slot[0] GT mismatch: {clist_line!r}'

    def test_clist_slot1_gt(self, lines):
        """C-list slot[1] must carry the UART_TX GT (0x32000002)."""
        clist_line = next((l for l in lines if 'slot[1]' in l), None)
        assert clist_line is not None, 'No c-list slot[1] line in output'
        assert '0x32000002' in clist_line.upper() or '32000002' in clist_line.upper(), \
            f'C-list slot[1] GT mismatch: {clist_line!r}'

    # ── Unit: disassemble_word ─────────────────────────────────────────────────

    def test_disassemble_word_load(self, mod):
        """word 0x071B0000 → LOAD CR3, CR6[0x0000]"""
        result = mod.disassemble_word(0x071B0000, idx=0)
        assert result == 'LOAD  CR3, CR6[0x0000]', \
            f'Unexpected: {result!r}'

    def test_disassemble_word_branch_al_target_03(self, mod):
        """word 0xBF007FBB at idx=72 → BRANCH  [03]  ; offset -69"""
        result = mod.disassemble_word(0xBF007FBB, idx=72)
        assert result.startswith('BRANCH  [03]'), \
            f'Unexpected: {result!r}'
        assert '-69' in result, \
            f'Expected offset -69 in: {result!r}'

    def test_disassemble_word_halt(self, mod):
        """All-zero word → HALT"""
        assert mod.disassemble_word(0x00000000) == 'HALT'

    def test_disassemble_word_iadd_imm(self, mod):
        """word 0xAF084001 → IADD DR1, DR0, #1"""
        result = mod.disassemble_word(0xAF084001, idx=2)
        assert result == 'IADD  DR1, DR0, #1', \
            f'Unexpected: {result!r}'

    def test_disassemble_word_dwrite_indexed(self, mod):
        """word 0x8F098000 → DWRITE DR1, CR3, #0, DR0"""
        result = mod.disassemble_word(0x8F098000, idx=3)
        assert result == 'DWRITE  DR1, CR3, #0, DR0', \
            f'Unexpected: {result!r}'

    def test_disassemble_word_header(self, mod):
        """Lump header word → .header lump ..."""
        result = mod.disassemble_word(0xF8812402)
        assert result.startswith('.header lump'), \
            f'Unexpected: {result!r}'

    def test_disassemble_word_unknown_opcode(self, mod):
        """Opcode in gap range (e.g. 10) → ??? ..."""
        # Opcode 10 = 0b01010 → word with top 5 bits = 01010
        w = (10 << 27) | (14 << 23)   # opcode=10, cond=AL, rest=0
        result = mod.disassemble_word(w)
        assert result.startswith('???'), \
            f'Expected ??? for unknown opcode, got: {result!r}'

    @pytest.mark.parametrize('dest', [12, 13, 14, 15])
    def test_switch_preserves_all_isolated_destinations(self, mod, dest):
        """SWITCH uses fld_a as the full 4-bit destination; none may alias."""
        word = (5 << 27) | (14 << 23) | (dest << 19) | (6 << 15) | 3
        assert mod.disassemble_word(word) == \
            f'SWITCH  CR{dest}, CR6, #0x0003'

    # ── Unit: IADD/ISUB immediate is 14-bit UNSIGNED (no sign extension) ──────

    def test_iadd_immediate_16383_is_unsigned(self, mod):
        """
        0xAF107FFF encodes IADD DR2, DR0, #16383 (not #-1).

        Bit 14 of imm is the immediate-mode flag; bits[13:0] are unsigned.
        The assembler encodes -1 as 16383 (0x3FFF) and displays it as 16383.
        Sign-extending would wrongly produce -1 for any immediate ≥ 8192.
        """
        # opcode=21(IADD) cond=14(AL) crDst=2(DR2) crSrc=0(DR0) imm=0x7FFF
        # imm bit14=1 (immediate mode), bits[13:0]=0x3FFF=16383
        w = 0xAF107FFF
        result = mod.disassemble_word(w, idx=60)
        assert result == 'IADD  DR2, DR0, #16383', \
            f'IADD imm=16383 must not be sign-extended to -1: {result!r}'

    def test_iadd_immediate_8192_is_unsigned(self, mod):
        """
        Immediate value 8192 (0x2000) has bit 13 set — the old sign-extension
        code treated it as -8192.  Correct display is #8192 (unsigned).
        """
        # imm = 0x4000 | 0x2000 = 0x6000; build a word with opcode=21, cond=AL,
        # crDst=1(DR1), crSrc=0(DR0)
        imm = 0x4000 | 0x2000        # 0x6000: immediate-mode flag + 8192
        w   = (21 << 27) | (14 << 23) | (1 << 19) | (0 << 15) | imm
        result = mod.disassemble_word(w, idx=0)
        assert result == 'IADD  DR1, DR0, #8192', \
            f'IADD imm=8192 must not be sign-extended to -8192: {result!r}'

    def test_isub_immediate_16383_is_unsigned(self, mod):
        """ISUB with imm bits[13:0]=0x3FFF → #16383 (not #-1)."""
        # opcode=22(ISUB) cond=14(AL) crDst=7(DR7) crSrc=6(DR6) imm=0x7FFF
        w = (22 << 27) | (14 << 23) | (7 << 19) | (6 << 15) | 0x7FFF
        result = mod.disassemble_word(w, idx=0)
        assert result == 'ISUB  DR7, DR6, #16383', \
            f'ISUB imm=16383 must not be sign-extended: {result!r}'

    def test_isub_immediate_8192_is_unsigned(self, mod):
        """ISUB with imm bits[13:0]=0x2000 → #8192 (not #-8192)."""
        imm = 0x4000 | 0x2000
        w   = (22 << 27) | (14 << 23) | (3 << 19) | (3 << 15) | imm
        result = mod.disassemble_word(w, idx=0)
        assert result == 'ISUB  DR3, DR3, #8192', \
            f'ISUB imm=8192 must not be sign-extended: {result!r}'

    def test_iadd_immediate_1_still_correct(self, mod):
        """Boundary check: small unsigned immediate 1 still decodes as #1."""
        result = mod.disassemble_word(0xAF084001, idx=2)
        assert result == 'IADD  DR1, DR0, #1', \
            f'IADD imm=1 regressed: {result!r}'

    def test_instruction_60_is_iadd_16383_not_minus1(self, lines):
        """
        Real binary: instruction [060] encodes the inner delay-loop counter
        load (IADD DR2, DR0, #16383).  Must not appear as #-1.
        """
        instr60 = next((l for l in lines if l.startswith('[060]')), None)
        assert instr60 is not None, 'No [060] line in disassembly'
        assert '#16383' in instr60, \
            f'[060] should show #16383 (not #-1): {instr60!r}'
        assert '#-1' not in instr60, \
            f'[060] must not show #-1 (sign-extension bug): {instr60!r}'


# ── Tests: CLI ────────────────────────────────────────────────────────────────

class TestDisasmLumpCLI:

    @pytest.fixture(scope='class')
    def cli_output(self):
        result = subprocess.run(
            [sys.executable, SCRIPT, LUMP_FILE],
            capture_output=True, text=True, timeout=15
        )
        assert result.returncode == 0, \
            f'CLI exited with code {result.returncode}:\n{result.stderr}'
        return result.stdout

    def test_cli_shows_instruction_0_as_load(self, cli_output):
        lines = cli_output.splitlines()
        instr0 = next((l for l in lines if l.startswith('[000]')), None)
        assert instr0 is not None, 'CLI: no [000] line'
        assert 'LOAD' in instr0, f'CLI: [000] is not LOAD: {instr0!r}'

    def test_cli_shows_instruction_72_branch_al_to_03(self, cli_output):
        lines = cli_output.splitlines()
        instr72 = next((l for l in lines if l.startswith('[072]')), None)
        assert instr72 is not None, 'CLI: no [072] line'
        assert 'BRANCH' in instr72, f'CLI: [072] is not BRANCH: {instr72!r}'
        assert '[03]' in instr72, \
            f'CLI: [072] BRANCH should target [03]: {instr72!r}'

    def test_cli_exits_nonzero_on_bad_file(self):
        result = subprocess.run(
            [sys.executable, SCRIPT, '/nonexistent/path.lump'],
            capture_output=True, text=True, timeout=10
        )
        assert result.returncode != 0, \
            'CLI should exit non-zero for a missing file'
