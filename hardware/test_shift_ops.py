"""Hardware simulation tests for SHR/SHL — ASR mode and carry-out (C flag).

Covers the four cases called out in Task #858:
  1. SHR LSR C-flag  (shift_amt > 0, last bit shifted out)
  2. SHR ASR result + C-flag (imm[5]=1 — sign-extending a negative value)
  3. SHL C-flag      (shift_amt > 0, last bit shifted out the top)
  4. SHR / SHL shift-by-zero → C = 0

Run with:  python -m hardware.test_shift_ops
"""

from amaranth.sim import Simulator

from .core import ChurchCore
from .hw_types import TuringOpcode, CondCode
from .sim_boot_helpers import boot_core


# ---------------------------------------------------------------------------
# Instruction encoding helpers
# ---------------------------------------------------------------------------

# Church Machine instruction format:
#   [31:27] opcode (5 bits)
#   [26:23] cond   (4 bits)
#   [22:19] cr_dst (4 bits)  ← DR destination register
#   [18:15] cr_src (4 bits)  ← DR source register
#   [14:0]  immediate (15 bits)

def _enc(opcode, cond, dr_dst, dr_src, imm15):
    return (
        ((int(opcode) & 0x1F) << 27) |
        ((int(cond)   & 0x0F) << 23) |
        ((dr_dst      & 0x0F) << 19) |
        ((dr_src      & 0x0F) << 15) |
        ( imm15       & 0x7FFF)
    )


def encode_iadd(dr_dst, dr_src, imm):
    """IADD DR[dr_dst] = DR[dr_src] + sign_extend(imm15); cond=AL."""
    return _enc(TuringOpcode.IADD, CondCode.AL, dr_dst, dr_src, imm & 0x7FFF)


def encode_shl(dr_dst, dr_src, shift_amt):
    """SHL DR[dr_dst] = DR[dr_src] << shift_amt; cond=AL."""
    return _enc(TuringOpcode.SHL, CondCode.AL, dr_dst, dr_src, shift_amt & 0x1F)


def encode_shr(dr_dst, dr_src, shift_amt, asr=False):
    """SHR DR[dr_dst] = DR[dr_src] >> shift_amt; imm[5]=1 for ASR; cond=AL."""
    imm = (shift_amt & 0x1F) | (0x20 if asr else 0)
    return _enc(TuringOpcode.SHR, CondCode.AL, dr_dst, dr_src, imm)


# ---------------------------------------------------------------------------
# Flag helpers — access COND_FLAGS_LAYOUT fields directly via ctx.get(sig[field])
# ---------------------------------------------------------------------------

def _get_flags(ctx, dut):
    """Return (N, Z, C, V) as a 4-tuple of ints (0 or 1)."""
    return (
        ctx.get(dut.flags["N"]),
        ctx.get(dut.flags["Z"]),
        ctx.get(dut.flags["C"]),
        ctx.get(dut.flags["V"]),
    )


# ---------------------------------------------------------------------------
# Shared boot helper
# ---------------------------------------------------------------------------

async def _boot(ctx, dut):
    """Await the full boot handshake, including Namespace.Init."""
    await boot_core(ctx, dut)


async def _exec(ctx, dut, instr):
    """Execute one Turing instruction and wait for its 1-cycle stall to clear.

    Timing:
      tick 0 — instruction is decoded; write-back fires (DR + flags updated)
               busy_reg ← 1, NIA ← NIA+4
      tick 1 — stall cycle; busy_reg ← 0 (unit idle again)

    Flags and DR values are stable after both ticks.
    """
    ctx.set(dut.imem_valid, 1)
    ctx.set(dut.imem_data,  instr)
    await ctx.tick()
    ctx.set(dut.imem_valid, 0)
    await ctx.tick()


# ---------------------------------------------------------------------------
# Test cases
# ---------------------------------------------------------------------------

def test_shr_lsr_c_set():
    """SHR LSR — C = last bit shifted out = 1.

    Source = 3 (0b11).  Shift right by 1 (logical).
    Expected: result = 1, N = 0, Z = 0, C = 1.
    """
    dut = ChurchCore(iot_profile=True)

    async def testbench(ctx):
        await _boot(ctx, dut)
        await _exec(ctx, dut, encode_iadd(1, 0, 3))   # DR1 = 3
        await _exec(ctx, dut, encode_shr(2, 1, 1))     # DR2 = DR1 >> 1 (LSR)  → expect 1
        N, Z, C, V = _get_flags(ctx, dut)
        assert C == 1, f"SHR LSR C-set: expected C=1, got C={C} (N={N} Z={Z} V={V})"
        assert N == 0, f"SHR LSR C-set: expected N=0, got N={N}"
        assert Z == 0, f"SHR LSR C-set: expected Z=0, got Z={Z}"
        # Direct result check: DR2 + (-1) should be 0 → Z=1
        # imm15=0x7FFF sign-extends to -1 (0xFFFFFFFF)
        await _exec(ctx, dut, encode_iadd(3, 2, 0x7FFF))  # DR3 = DR2 + (-1)
        _, Z2, _, _ = _get_flags(ctx, dut)
        assert Z2 == 1, f"SHR LSR C-set: result check failed — DR2 should be 1, got Z2={Z2} (DR2+(-1) ≠ 0)"
        print("  PASS: SHR LSR (shift_amt=1, src=3) → result=1, C=1, N=0, Z=0")

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()
    print("PASS: test_shr_lsr_c_set")


def test_shr_lsr_c_clear():
    """SHR LSR — C = last bit shifted out = 0.

    Source = 2 (0b10).  Shift right by 1 (logical).
    Expected: result = 1, N = 0, Z = 0, C = 0.
    """
    dut = ChurchCore(iot_profile=True)

    async def testbench(ctx):
        await _boot(ctx, dut)
        await _exec(ctx, dut, encode_iadd(1, 0, 2))   # DR1 = 2
        await _exec(ctx, dut, encode_shr(2, 1, 1))     # DR2 = DR1 >> 1 (LSR)  → expect 1
        N, Z, C, V = _get_flags(ctx, dut)
        assert C == 0, f"SHR LSR C-clear: expected C=0, got C={C} (N={N} Z={Z} V={V})"
        assert N == 0, f"SHR LSR C-clear: expected N=0, got N={N}"
        # Direct result check: DR2 + (-1) should be 0 → Z=1
        await _exec(ctx, dut, encode_iadd(3, 2, 0x7FFF))  # DR3 = DR2 + (-1)
        _, Z2, _, _ = _get_flags(ctx, dut)
        assert Z2 == 1, f"SHR LSR C-clear: result check failed — DR2 should be 1, got Z2={Z2} (DR2+(-1) ≠ 0)"
        print("  PASS: SHR LSR (shift_amt=1, src=2) → result=1, C=0, N=0")

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()
    print("PASS: test_shr_lsr_c_clear")


def test_shr_asr_negative_result():
    """SHR ASR — sign-extension of a negative value.

    Source = -1 (0xFFFFFFFF).  imm15=0x7FFF → sign_extend15 = 0xFFFFFFFF.
    Shift right by 1 with ASR (imm[5]=1).
    Expected: result = 0xFFFFFFFF (-1), N=1, C=1 (bit 0 of src was 1).
    LSR of -1 would give 0x7FFFFFFF (N=0), so N=1 distinguishes ASR from LSR.
    """
    dut = ChurchCore(iot_profile=True)

    async def testbench(ctx):
        await _boot(ctx, dut)
        # imm15=0x7FFF (bit14=1 → sign bit set) → 0xFFFFFFFF (-1 in 32-bit)
        await _exec(ctx, dut, encode_iadd(1, 0, 0x7FFF))      # DR1 = -1
        await _exec(ctx, dut, encode_shr(2, 1, 1, asr=True))  # DR2 = DR1 >>> 1  → expect -1
        N, Z, C, V = _get_flags(ctx, dut)
        assert N == 1, (
            f"SHR ASR negative: expected N=1 (result negative), "
            f"got N={N} Z={Z} C={C} V={V}")
        assert Z == 0, f"SHR ASR negative: expected Z=0, got Z={Z}"
        assert C == 1, (
            f"SHR ASR negative: expected C=1 (src bit-0 was 1), "
            f"got C={C} (N={N} Z={Z} V={V})")
        assert V == 0, f"SHR ASR negative: expected V=0, got V={V}"
        # Direct result check: DR2 + 1 should be 0 → Z=1  (result = -1 = 0xFFFFFFFF)
        await _exec(ctx, dut, encode_iadd(3, 2, 1))  # DR3 = DR2 + 1
        _, Z2, _, _ = _get_flags(ctx, dut)
        assert Z2 == 1, (
            f"SHR ASR negative: result check failed — DR2 should be -1, "
            f"got Z2={Z2} (DR2+1 ≠ 0)")
        print("  PASS: SHR ASR (shift_amt=1, src=-1) → result=-1, N=1, Z=0, C=1, V=0")

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()
    print("PASS: test_shr_asr_negative_result")


def test_shr_asr_c_clear():
    """SHR ASR — C = 0 when the bit shifted out is 0.

    Source = -2 (0xFFFFFFFE).  imm15=0x7FFE → sign_extend15 = 0xFFFFFFFE.
    Shift right by 1 with ASR.
    Expected: result = 0xFFFFFFFF (-1), N=1, C=0 (bit 0 of src was 0).
    """
    dut = ChurchCore(iot_profile=True)

    async def testbench(ctx):
        await _boot(ctx, dut)
        # imm15=0x7FFE (bit14=1 → sign bit set) → 0xFFFFFFFE (-2 in 32-bit)
        await _exec(ctx, dut, encode_iadd(1, 0, 0x7FFE))      # DR1 = -2
        await _exec(ctx, dut, encode_shr(2, 1, 1, asr=True))  # DR2 = DR1 >>> 1  → expect -1
        N, Z, C, V = _get_flags(ctx, dut)
        assert N == 1, f"SHR ASR C-clear: expected N=1, got N={N}"
        assert C == 0, (
            f"SHR ASR C-clear: expected C=0 (src bit-0 was 0), "
            f"got C={C} (N={N} Z={Z} V={V})")
        # Direct result check: DR2 + 1 should be 0 → Z=1  (result = -1 = 0xFFFFFFFF)
        await _exec(ctx, dut, encode_iadd(3, 2, 1))  # DR3 = DR2 + 1
        _, Z2, _, _ = _get_flags(ctx, dut)
        assert Z2 == 1, (
            f"SHR ASR C-clear: result check failed — DR2 should be -1, "
            f"got Z2={Z2} (DR2+1 ≠ 0)")
        print("  PASS: SHR ASR (shift_amt=1, src=-2) → result=-1, N=1, C=0")

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()
    print("PASS: test_shr_asr_c_clear")


def test_shl_c_set():
    """SHL — C = last bit shifted out the top = 1.

    Source = -1 (0xFFFFFFFF).  Shift left by 1.
    Last bit out = source[31] = 1.
    Expected: result = 0xFFFFFFFE (-2), N=1, C=1.
    """
    dut = ChurchCore(iot_profile=True)

    async def testbench(ctx):
        await _boot(ctx, dut)
        await _exec(ctx, dut, encode_iadd(1, 0, 0x7FFF))  # DR1 = -1 (0xFFFFFFFF)
        await _exec(ctx, dut, encode_shl(2, 1, 1))         # DR2 = DR1 << 1  → expect -2 (0xFFFFFFFE)
        N, Z, C, V = _get_flags(ctx, dut)
        assert C == 1, (
            f"SHL C-set: expected C=1 (src[31]=1), "
            f"got C={C} (N={N} Z={Z} V={V})")
        assert N == 1, f"SHL C-set: expected N=1 (result bit-31=1), got N={N}"
        assert Z == 0, f"SHL C-set: expected Z=0, got Z={Z}"
        assert V == 0, f"SHL C-set: expected V=0, got V={V}"
        # Direct result check: DR2 + 2 should be 0 → Z=1  (result = -2 = 0xFFFFFFFE)
        await _exec(ctx, dut, encode_iadd(3, 2, 2))  # DR3 = DR2 + 2
        _, Z2, _, _ = _get_flags(ctx, dut)
        assert Z2 == 1, (
            f"SHL C-set: result check failed — DR2 should be -2, "
            f"got Z2={Z2} (DR2+2 ≠ 0)")
        print("  PASS: SHL (shift_amt=1, src=-1) → result=-2, N=1, Z=0, C=1, V=0")

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()
    print("PASS: test_shl_c_set")


def test_shl_c_clear():
    """SHL — C = 0 when the bit shifted out the top is 0.

    Source = 1.  Shift left by 1.
    Last bit out = source[31] = 0.
    Expected: result = 2, N = 0, Z = 0, C = 0.
    """
    dut = ChurchCore(iot_profile=True)

    async def testbench(ctx):
        await _boot(ctx, dut)
        await _exec(ctx, dut, encode_iadd(1, 0, 1))  # DR1 = 1
        await _exec(ctx, dut, encode_shl(2, 1, 1))   # DR2 = DR1 << 1  → expect 2
        N, Z, C, V = _get_flags(ctx, dut)
        assert C == 0, (
            f"SHL C-clear: expected C=0 (src[31]=0), "
            f"got C={C} (N={N} Z={Z} V={V})")
        assert N == 0, f"SHL C-clear: expected N=0, got N={N}"
        assert Z == 0, f"SHL C-clear: expected Z=0, got Z={Z}"
        # Direct result check: DR2 + (-2) should be 0 → Z=1  (result = 2; -2 = imm15 0x7FFE)
        await _exec(ctx, dut, encode_iadd(3, 2, 0x7FFE))  # DR3 = DR2 + (-2)
        _, Z2, _, _ = _get_flags(ctx, dut)
        assert Z2 == 1, (
            f"SHL C-clear: result check failed — DR2 should be 2, "
            f"got Z2={Z2} (DR2+(-2) ≠ 0)")
        print("  PASS: SHL (shift_amt=1, src=1) → result=2, N=0, Z=0, C=0")

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()
    print("PASS: test_shl_c_clear")


def test_shr_shift_by_zero_c_clear():
    """SHR shift-by-zero — C must be 0 regardless of source.

    Source = -1 (all ones, every bit set).  Shift right by 0 (LSR).
    Expected: C = 0 (no bits shifted out).
    """
    dut = ChurchCore(iot_profile=True)

    async def testbench(ctx):
        await _boot(ctx, dut)
        await _exec(ctx, dut, encode_iadd(1, 0, 0x7FFF))  # DR1 = -1 (0xFFFFFFFF)
        await _exec(ctx, dut, encode_shr(2, 1, 0))         # DR2 = DR1 >> 0 (LSR, amt=0)
        N, Z, C, V = _get_flags(ctx, dut)
        assert C == 0, (
            f"SHR shift-by-zero: expected C=0, "
            f"got C={C} (N={N} Z={Z} V={V})")
        assert N == 1, f"SHR shift-by-zero: expected N=1 (src=-1), got N={N}"
        assert Z == 0, f"SHR shift-by-zero: expected Z=0, got Z={Z}"
        print("  PASS: SHR LSR shift-by-zero (src=-1) → C=0, N=1, Z=0")

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()
    print("PASS: test_shr_shift_by_zero_c_clear")


def test_shr_asr_shift_by_zero_c_clear():
    """SHR ASR shift-by-zero — C must be 0 (ASR mode, shift_amt=0).

    Source = -1 (all ones).  Shift right by 0 with ASR flag set.
    Expected: C = 0, result = -1 (N=1).
    """
    dut = ChurchCore(iot_profile=True)

    async def testbench(ctx):
        await _boot(ctx, dut)
        await _exec(ctx, dut, encode_iadd(1, 0, 0x7FFF))      # DR1 = -1
        await _exec(ctx, dut, encode_shr(2, 1, 0, asr=True))  # DR2 = DR1 >>> 0
        N, Z, C, V = _get_flags(ctx, dut)
        assert C == 0, (
            f"SHR ASR shift-by-zero: expected C=0, "
            f"got C={C} (N={N} Z={Z} V={V})")
        assert N == 1, f"SHR ASR shift-by-zero: expected N=1, got N={N}"
        print("  PASS: SHR ASR shift-by-zero (src=-1) → C=0, N=1")

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()
    print("PASS: test_shr_asr_shift_by_zero_c_clear")


def test_shl_shift_by_zero_c_clear():
    """SHL shift-by-zero — C must be 0 regardless of source.

    Source = -1 (all ones, bit 31 = 1).  Shift left by 0.
    Expected: C = 0 (no bits shifted out).
    """
    dut = ChurchCore(iot_profile=True)

    async def testbench(ctx):
        await _boot(ctx, dut)
        await _exec(ctx, dut, encode_iadd(1, 0, 0x7FFF))  # DR1 = -1 (0xFFFFFFFF)
        await _exec(ctx, dut, encode_shl(2, 1, 0))         # DR2 = DR1 << 0
        N, Z, C, V = _get_flags(ctx, dut)
        assert C == 0, (
            f"SHL shift-by-zero: expected C=0, "
            f"got C={C} (N={N} Z={Z} V={V})")
        assert N == 1, f"SHL shift-by-zero: expected N=1 (src=-1), got N={N}"
        assert Z == 0, f"SHL shift-by-zero: expected Z=0, got Z={Z}"
        print("  PASS: SHL shift-by-zero (src=-1) → C=0, N=1, Z=0")

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()
    print("PASS: test_shl_shift_by_zero_c_clear")


def test_shr_lsr_large_shift():
    """SHR LSR — larger shift amount (shift_amt=4), C = last bit out.

    Source = 0x1F (0b00011111).  Shift right by 4 (LSR).
    Last bit out = source[3] = 1 (bit 3 of 0x1F is 1).
    Expected: result = 0x01, N = 0, Z = 0, C = 1.
    """
    dut = ChurchCore(iot_profile=True)

    async def testbench(ctx):
        await _boot(ctx, dut)
        await _exec(ctx, dut, encode_iadd(1, 0, 0x1F))  # DR1 = 0x1F = 31
        await _exec(ctx, dut, encode_shr(2, 1, 4))       # DR2 = DR1 >> 4 (LSR)
        N, Z, C, V = _get_flags(ctx, dut)
        assert C == 1, (
            f"SHR LSR large-shift: expected C=1 (src[3]=1), "
            f"got C={C} (N={N} Z={Z} V={V})")
        assert N == 0, f"SHR LSR large-shift: expected N=0, got N={N}"
        assert Z == 0, f"SHR LSR large-shift: expected Z=0 (result=1), got Z={Z}"
        print("  PASS: SHR LSR (shift_amt=4, src=0x1F) → C=1, N=0, Z=0")

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()
    print("PASS: test_shr_lsr_large_shift")


def test_shl_large_shift_c_set():
    """SHL — larger shift amount (shift_amt=31), C = source[1].

    Source = 3 (0b11).  Shift left by 31.
    Last bit out = source[32 - 31] = source[1] = 1.
    Expected: result = 0x80000000, N = 1, Z = 0, C = 1.
    """
    dut = ChurchCore(iot_profile=True)

    async def testbench(ctx):
        await _boot(ctx, dut)
        await _exec(ctx, dut, encode_iadd(1, 0, 3))   # DR1 = 3
        await _exec(ctx, dut, encode_shl(2, 1, 31))   # DR2 = DR1 << 31
        N, Z, C, V = _get_flags(ctx, dut)
        assert C == 1, (
            f"SHL large-shift C-set: expected C=1 (src[1]=1), "
            f"got C={C} (N={N} Z={Z} V={V})")
        assert N == 1, (
            f"SHL large-shift C-set: expected N=1 (result=0x80000000), "
            f"got N={N}")
        assert Z == 0, f"SHL large-shift C-set: expected Z=0, got Z={Z}"
        print("  PASS: SHL (shift_amt=31, src=3) → C=1, N=1, Z=0")

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()
    print("PASS: test_shl_large_shift_c_set")


def test_shr_lsr_shift_by_31():
    """SHR LSR shift_amt=31 — only the top bit survives as the result bit.

    Source = 0xFFFFFFFF (-1, all bits set).  Shift right (logical) by 31.
    Result = 0xFFFFFFFF >> 31 = 1.
    C = source[30] (last bit shifted out) = 1.
    Expected: result = 1, N = 0, Z = 0, C = 1.
    """
    dut = ChurchCore(iot_profile=True)

    async def testbench(ctx):
        await _boot(ctx, dut)
        await _exec(ctx, dut, encode_iadd(1, 0, 0x7FFF))  # DR1 = -1 (0xFFFFFFFF)
        await _exec(ctx, dut, encode_shr(2, 1, 31))        # DR2 = DR1 >> 31 (LSR)  → expect 1
        N, Z, C, V = _get_flags(ctx, dut)
        assert N == 0, (
            f"SHR LSR shift-by-31: expected N=0 (result=1), "
            f"got N={N} Z={Z} C={C} V={V}")
        assert Z == 0, f"SHR LSR shift-by-31: expected Z=0, got Z={Z}"
        assert C == 1, (
            f"SHR LSR shift-by-31: expected C=1 (src[30]=1), "
            f"got C={C} (N={N} Z={Z} V={V})")
        # Direct result check: DR2 + (-1) should be 0 → Z=1  (result = 1)
        await _exec(ctx, dut, encode_iadd(3, 2, 0x7FFF))  # DR3 = DR2 + (-1)
        _, Z2, _, _ = _get_flags(ctx, dut)
        assert Z2 == 1, (
            f"SHR LSR shift-by-31: result check failed — DR2 should be 1, "
            f"got Z2={Z2} (DR2+(-1) ≠ 0)")
        print("  PASS: SHR LSR (shift_amt=31, src=0xFFFFFFFF) → result=1, N=0, Z=0, C=1")

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()
    print("PASS: test_shr_lsr_shift_by_31")


def test_shr_asr_positive_no_sign_extend():
    """SHR ASR — positive source must NOT sign-extend (N stays 0).

    Source = 4 (positive, bit 31 = 0).  Shift right by 1 with ASR flag.
    Expected: result = 2, N = 0 (no sign-extension), Z = 0, C = 0 (bit 0 of 4 is 0).
    If ASR incorrectly sign-extends a positive value, N would be 1.
    """
    dut = ChurchCore(iot_profile=True)

    async def testbench(ctx):
        await _boot(ctx, dut)
        await _exec(ctx, dut, encode_iadd(1, 0, 4))           # DR1 = 4
        await _exec(ctx, dut, encode_shr(2, 1, 1, asr=True))  # DR2 = DR1 >>> 1  → expect 2
        N, Z, C, V = _get_flags(ctx, dut)
        assert N == 0, (
            f"SHR ASR positive: expected N=0 (no sign-extension for positive src), "
            f"got N={N} Z={Z} C={C} V={V}")
        assert Z == 0, f"SHR ASR positive: expected Z=0, got Z={Z}"
        assert C == 0, (
            f"SHR ASR positive: expected C=0 (src bit-0 of 4 is 0), "
            f"got C={C} (N={N} Z={Z} V={V})")
        # Direct result check: DR2 + (-2) should be 0 → Z=1  (result = 2; -2 = imm15 0x7FFE)
        await _exec(ctx, dut, encode_iadd(3, 2, 0x7FFE))  # DR3 = DR2 + (-2)
        _, Z2, _, _ = _get_flags(ctx, dut)
        assert Z2 == 1, (
            f"SHR ASR positive: result check failed — DR2 should be 2, "
            f"got Z2={Z2} (DR2+(-2) ≠ 0)")
        print("  PASS: SHR ASR (shift_amt=1, src=4) → result=2, N=0, Z=0, C=0 (no sign-extension)")

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()
    print("PASS: test_shr_asr_positive_no_sign_extend")


def test_shl_alternating_bits():
    """SHL — alternating-bit patterns confirm no carry leakage.

    Case A: src = 0x55555555 (0101…), shift left by 1.
      Bit 31 of 0x55555555 = 0  → C = 0.
      Result = 0xAAAAAAAA        → N = 1 (bit 31 = 1), Z = 0.

    Case B: src = 0xAAAAAAAA (1010…), shift left by 1.
      Bit 31 of 0xAAAAAAAA = 1  → C = 1.
      Result = 0x55555554        → N = 0 (bit 31 = 0), Z = 0.

    Both values are built register-by-register since they exceed the 15-bit
    immediate range.  The test verifies the C and N flags only; an incorrect
    carry would corrupt bit 31 and flip N.
    """
    dut = ChurchCore(iot_profile=True)

    async def testbench(ctx):
        await _boot(ctx, dut)

        # Build 0x55555555 in DR7 using byte-at-a-time construction.
        # 0x55 = 85 fits in imm15; shifting and adding builds the full pattern.
        await _exec(ctx, dut, encode_iadd(1, 0, 0x55))   # DR1 = 0x00000055
        await _exec(ctx, dut, encode_shl(2, 1, 8))        # DR2 = 0x00005500
        await _exec(ctx, dut, encode_iadd(2, 2, 0x55))    # DR2 = 0x00005555
        await _exec(ctx, dut, encode_shl(3, 2, 8))        # DR3 = 0x00555500
        await _exec(ctx, dut, encode_iadd(3, 3, 0x55))    # DR3 = 0x00555555
        await _exec(ctx, dut, encode_shl(4, 3, 8))        # DR4 = 0x55555500
        await _exec(ctx, dut, encode_iadd(4, 4, 0x55))    # DR4 = 0x55555555

        # Case A: 0x55555555 << 1
        await _exec(ctx, dut, encode_shl(5, 4, 1))        # DR5 = 0xAAAAAAAA
        N, Z, C, V = _get_flags(ctx, dut)
        assert C == 0, (
            f"SHL alternating A: expected C=0 (src[31] of 0x55555555 = 0), "
            f"got C={C} (N={N} Z={Z} V={V})")
        assert N == 1, (
            f"SHL alternating A: expected N=1 (result 0xAAAAAAAA has bit31=1), "
            f"got N={N} (C={C} Z={Z} V={V})")
        assert Z == 0, f"SHL alternating A: expected Z=0, got Z={Z}"
        print("  PASS: SHL (shift_amt=1, src=0x55555555) → N=1, Z=0, C=0 (no carry leakage)")

        # Build 0xAAAAAAAA in DR8 using byte-at-a-time construction.
        # 0xAA = 170 fits in imm15.
        await _exec(ctx, dut, encode_iadd(6, 0, 0xAA))   # DR6 = 0x000000AA
        await _exec(ctx, dut, encode_shl(7, 6, 8))        # DR7 = 0x0000AA00
        await _exec(ctx, dut, encode_iadd(7, 7, 0xAA))    # DR7 = 0x0000AAAA
        await _exec(ctx, dut, encode_shl(8, 7, 8))        # DR8 = 0x00AAAA00
        await _exec(ctx, dut, encode_iadd(8, 8, 0xAA))    # DR8 = 0x00AAAAAA
        await _exec(ctx, dut, encode_shl(9, 8, 8))        # DR9 = 0xAAAAAA00
        await _exec(ctx, dut, encode_iadd(9, 9, 0xAA))    # DR9 = 0xAAAAAAAA

        # Case B: 0xAAAAAAAA << 1
        await _exec(ctx, dut, encode_shl(10, 9, 1))       # DR10 = 0x55555554
        N, Z, C, V = _get_flags(ctx, dut)
        assert C == 1, (
            f"SHL alternating B: expected C=1 (src[31] of 0xAAAAAAAA = 1), "
            f"got C={C} (N={N} Z={Z} V={V})")
        assert N == 0, (
            f"SHL alternating B: expected N=0 (result 0x55555554 has bit31=0), "
            f"got N={N} (C={C} Z={Z} V={V})")
        assert Z == 0, f"SHL alternating B: expected Z=0, got Z={Z}"
        print("  PASS: SHL (shift_amt=1, src=0xAAAAAAAA) → N=0, Z=0, C=1 (no carry leakage)")

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    with sim.write_vcd("/dev/null"):
        sim.run()
    print("PASS: test_shl_alternating_bits")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

_ALL_TESTS = (
    test_shr_lsr_c_set,
    test_shr_lsr_c_clear,
    test_shr_asr_negative_result,
    test_shr_asr_c_clear,
    test_shl_c_set,
    test_shl_c_clear,
    test_shr_shift_by_zero_c_clear,
    test_shr_asr_shift_by_zero_c_clear,
    test_shl_shift_by_zero_c_clear,
    test_shr_lsr_large_shift,
    test_shl_large_shift_c_set,
    test_shr_lsr_shift_by_31,
    test_shr_asr_positive_no_sign_extend,
    test_shl_alternating_bits,
)

if __name__ == "__main__":
    print("=" * 60)
    print("ChurchCore SHL/SHR Hardware Simulation Tests")
    print("=" * 60)
    failures = []
    for fn in _ALL_TESTS:
        print(f"\n[{fn.__name__}]")
        try:
            fn()
        except AssertionError as e:
            failures.append((fn.__name__, str(e)))
        except Exception as e:
            failures.append((fn.__name__, f"{type(e).__name__}: {e}"))

    print()
    if failures:
        print("=== SUMMARY: FAILURES ===")
        for name, msg in failures:
            print(f"  FAIL: {name}: {msg}")
        raise SystemExit(1)
    else:
        print(f"=== SUMMARY: ALL {len(_ALL_TESTS)} TESTS PASSED ===")
