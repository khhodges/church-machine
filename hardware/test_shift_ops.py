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
    """IADD immediate: bit 14 selects an unsigned 14-bit payload."""
    if not 0 <= imm <= 0x3FFF:
        raise ValueError("IADD immediate must be unsigned 14-bit")
    return _enc(TuringOpcode.IADD, CondCode.AL, dr_dst, dr_src, 0x4000 | imm)


def encode_isub(dr_dst, dr_src, imm):
    """ISUB immediate; subtract from DR0 to construct negative values."""
    if not 0 <= imm <= 0x3FFF:
        raise ValueError("ISUB immediate must be unsigned 14-bit")
    return _enc(TuringOpcode.ISUB, CondCode.AL, dr_dst, dr_src, 0x4000 | imm)


def encode_shl(dr_dst, dr_src, shift_amt, *, cond=CondCode.AL):
    """SHL DR[dr_dst] = DR[dr_src] << shift_amt."""
    return _enc(TuringOpcode.SHL, cond, dr_dst, dr_src, shift_amt & 0x1F)


def encode_shr(dr_dst, dr_src, shift_amt, asr=False, *, cond=CondCode.AL):
    """SHR DR[dr_dst] = DR[dr_src] >> shift_amt; imm[5]=1 for ASR."""
    imm = (shift_amt & 0x1F) | (0x20 if asr else 0)
    return _enc(TuringOpcode.SHR, cond, dr_dst, dr_src, imm)


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
    nia = ctx.get(dut.nia)
    assert not ctx.get(dut.fault_valid)
    assert not ctx.get(dut.retire_fault_valid)
    assert ctx.get(dut.retire_valid), "Instruction was not accepted"
    assert ctx.get(dut.retire_instr) == instr
    assert ctx.get(dut.retire_nia) == nia
    # Independent ISA oracle checks every setup and shift result directly.
    opcode = (instr >> 27) & 0x1F
    dst, src = (instr >> 19) & 15, (instr >> 15) & 15
    value = ctx.get(dut.debug_dr_words[src])
    imm = instr & 0x7FFF
    if opcode in (TuringOpcode.IADD, TuringOpcode.ISUB):
        rhs = (imm & 0x3FFF) if imm & 0x4000 else ctx.get(dut.debug_dr_words[imm & 15])
        expected = value + rhs if opcode == TuringOpcode.IADD else value - rhs
    else:
        amount = imm & 31
        if opcode == TuringOpcode.SHL:
            expected = value << amount
            carry = (value >> (32 - amount)) & 1 if amount else 0
        else:
            assert opcode == TuringOpcode.SHR
            signed_value = value - (1 << 32) if imm & 0x20 and value & 0x80000000 else value
            expected = signed_value >> amount
            carry = (value >> (amount - 1)) & 1 if amount else 0
    expected &= 0xFFFFFFFF
    await ctx.tick()
    ctx.set(dut.imem_valid, 0)
    assert not ctx.get(dut.fault_valid)
    assert ctx.get(dut.nia) == nia + 4
    assert ctx.get(dut.debug_dr_words[dst]) == (expected if dst else 0)
    if opcode in (TuringOpcode.SHL, TuringOpcode.SHR):
        assert _get_flags(ctx, dut) == (expected >> 31, int(expected == 0), carry, 0)
    flags = _get_flags(ctx, dut)
    assert not ctx.get(dut.retire_valid)
    await ctx.tick()
    assert not ctx.get(dut.fault_valid)
    assert not ctx.get(dut.retire_valid)
    assert ctx.get(dut.nia) == nia + 4
    assert ctx.get(dut.debug_dr_words[dst]) == (expected if dst else 0)
    assert _get_flags(ctx, dut) == flags


# ---------------------------------------------------------------------------
# Test cases
# ---------------------------------------------------------------------------

async def _check_conditional_shift(ctx, dut, instr, *, taken, result, flags):
    """Observe one retirement and an idle cycle without a flag-changing probe."""
    before_dr = [ctx.get(word) for word in dut.debug_dr_words]
    before_flags = _get_flags(ctx, dut)
    nia = ctx.get(dut.nia)
    dst = (instr >> 19) & 15
    expected_dr = before_dr.copy()
    if taken and dst:
        expected_dr[dst] = result
    expected_flags = flags if taken else before_flags
    ctx.set(dut.imem_data, instr)
    ctx.set(dut.imem_valid, 1)
    assert not ctx.get(dut.fault_valid)
    assert not ctx.get(dut.retire_fault_valid)
    assert ctx.get(dut.retire_valid), "Conditional shift was not accepted"
    assert ctx.get(dut.retire_instr) == instr
    assert ctx.get(dut.retire_nia) == nia
    await ctx.tick()
    ctx.set(dut.imem_valid, 0)
    for _ in range(2):
        assert not ctx.get(dut.fault_valid)
        assert not ctx.get(dut.retire_fault_valid)
        assert not ctx.get(dut.retire_valid), "Conditional shift retired twice"
        assert ctx.get(dut.nia) == nia + 4, "Shift must advance NIA exactly once"
        assert [ctx.get(word) for word in dut.debug_dr_words] == expected_dr
        assert _get_flags(ctx, dut) == expected_flags
        await ctx.tick()
    assert ctx.get(dut.nia) == nia + 4
    assert [ctx.get(word) for word in dut.debug_dr_words] == expected_dr
    assert _get_flags(ctx, dut) == expected_flags


def _run_conditional_shift_cases(encoder, result, result_flags):
    dut = ChurchCore(iot_profile=True)

    async def testbench(ctx):
        await _boot(ctx, dut)
        for dst in (2, 1, 0):  # Separate destination, alias, and hardwired zero.
            for zero in (True, False):
                await _exec(ctx, dut, encode_isub(1, 0, 2))  # Source = -2.
                await _exec(ctx, dut, encode_iadd(2, 0, 0x123))
                if zero:
                    await _exec(ctx, dut, encode_isub(3, 0, 0))
                    initial_flags = (0, 1, 1, 0)
                else:
                    # Signed overflow supplies V=1: a skipped shift must not
                    # clear it. All flags are established by real instructions.
                    await _exec(ctx, dut, encode_iadd(3, 0, 1))
                    await _exec(ctx, dut, encode_shl(3, 3, 31))
                    await _exec(ctx, dut, encode_isub(3, 3, 1))
                    await _exec(ctx, dut, encode_iadd(3, 3, 1))
                    initial_flags = (1, 0, 0, 1)
                assert _get_flags(ctx, dut) == initial_flags
                false_cond = CondCode.NE if zero else CondCode.EQ
                true_cond = CondCode.EQ if zero else CondCode.NE
                await _check_conditional_shift(
                    ctx, dut, encoder(dst, false_cond), taken=False,
                    result=result, flags=result_flags)
                await _check_conditional_shift(
                    ctx, dut, encoder(dst, true_cond), taken=True,
                    result=result, flags=result_flags)

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    sim.run()


def test_conditional_shl():
    """False SHL preserves state; true SHL writes back, including alias/DR0."""
    _run_conditional_shift_cases(
        lambda dst, cond: encode_shl(dst, 1, 1, cond=cond),
        0xFFFFFFFC, (1, 0, 1, 0))


def test_conditional_shr_lsr():
    """False LSR preserves state; true LSR writes back, including alias/DR0."""
    _run_conditional_shift_cases(
        lambda dst, cond: encode_shr(dst, 1, 1, cond=cond),
        0x7FFFFFFF, (0, 0, 0, 0))


def test_conditional_shr_asr():
    """False ASR preserves state; true ASR writes back, including alias/DR0."""
    _run_conditional_shift_cases(
        lambda dst, cond: encode_shr(dst, 1, 1, asr=True, cond=cond),
        0xFFFFFFFF, (1, 0, 0, 0))


def test_arithmetic_setup_encoding():
    """Pin literal ISA words so the result oracle cannot hide helper drift."""
    assert encode_iadd(1, 0, 3) == 0xAF084003
    assert encode_iadd(2, 1, 10) == 0xAF10C00A  # ISA reference example
    assert encode_iadd(1, 0, 0) == 0xAF084000
    assert encode_iadd(1, 0, 16383) == 0xAF087FFF
    assert encode_isub(1, 0, 1) == 0xB7084001
    assert encode_shr(2, 1, 1) == 0xCF108001
    assert encode_shr(2, 1, 1, asr=True) == 0xCF108021
    for encoder in (encode_iadd, encode_isub):
        assert encoder(1, 0, 0) & 0x7FFF == 0x4000
        assert encoder(1, 0, 0x3FFF) & 0x7FFF == 0x7FFF
        for invalid in (-1, 16384, 0x7FFF):
            try:
                encoder(1, 0, invalid)
            except ValueError:
                pass
            else:
                raise AssertionError(f"Accepted non-ISA immediate {invalid}")


def test_first_shr_setup_and_retirement():
    """Reproduce old words, then prove the intended setup/SHR/writeback."""
    dut = ChurchCore(iot_profile=True)

    async def testbench(ctx):
        await _boot(ctx, dut)
        # Old 'immediate 3' was register DR3. Make the distinction observable.
        await _exec(ctx, dut, encode_iadd(3, 0, 9))
        await _exec(ctx, dut, 0xAF080003)
        assert ctx.get(dut.debug_dr_words[1]) == 9
        # Old '-1' was actually the largest positive immediate.
        await _exec(ctx, dut, 0xAF087FFF)
        assert ctx.get(dut.debug_dr_words[1]) == 16383
        await _exec(ctx, dut, encode_iadd(1, 0, 3))
        assert ctx.get(dut.debug_dr_words[1]) == 3
        await _exec(ctx, dut, encode_shr(2, 1, 1))
        assert ctx.get(dut.debug_dr_words[2]) == 1
        assert _get_flags(ctx, dut) == (0, 0, 1, 0)
        await _exec(ctx, dut, encode_isub(3, 2, 1))
        assert ctx.get(dut.debug_dr_words[3]) == 0
        assert _get_flags(ctx, dut) == (0, 1, 1, 0)
        await _exec(ctx, dut, encode_isub(1, 0, 1))
        assert ctx.get(dut.debug_dr_words[1]) == 0xFFFFFFFF
        await _exec(ctx, dut, encode_isub(1, 0, 2))
        assert ctx.get(dut.debug_dr_words[1]) == 0xFFFFFFFE

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    sim.run()


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
        await _exec(ctx, dut, encode_isub(3, 2, 1))  # DR3 = DR2 - 1
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
        await _exec(ctx, dut, encode_isub(3, 2, 1))  # DR3 = DR2 - 1
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

    Source = -1 (0xFFFFFFFF), constructed with ISUB DR1, DR0, #1.
    Shift right by 1 with ASR (imm[5]=1).
    Expected: result = 0xFFFFFFFF (-1), N=1, C=1 (bit 0 of src was 1).
    LSR of -1 would give 0x7FFFFFFF (N=0), so N=1 distinguishes ASR from LSR.
    """
    dut = ChurchCore(iot_profile=True)

    async def testbench(ctx):
        await _boot(ctx, dut)
        await _exec(ctx, dut, encode_isub(1, 0, 1))          # DR1 = -1
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

    Source = -2 (0xFFFFFFFE), constructed with ISUB DR1, DR0, #2.
    Shift right by 1 with ASR.
    Expected: result = 0xFFFFFFFF (-1), N=1, C=0 (bit 0 of src was 0).
    """
    dut = ChurchCore(iot_profile=True)

    async def testbench(ctx):
        await _boot(ctx, dut)
        await _exec(ctx, dut, encode_isub(1, 0, 2))          # DR1 = -2
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
        await _exec(ctx, dut, encode_isub(1, 0, 1))  # DR1 = -1 (0xFFFFFFFF)
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
        # Direct result check: DR2 - 2 should be 0 → Z=1 (result = 2).
        await _exec(ctx, dut, encode_isub(3, 2, 2))  # DR3 = DR2 - 2
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
        await _exec(ctx, dut, encode_isub(1, 0, 1))  # DR1 = -1 (0xFFFFFFFF)
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
        await _exec(ctx, dut, encode_isub(1, 0, 1))          # DR1 = -1
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
        await _exec(ctx, dut, encode_isub(1, 0, 1))  # DR1 = -1 (0xFFFFFFFF)
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
        await _exec(ctx, dut, encode_isub(1, 0, 1))  # DR1 = -1 (0xFFFFFFFF)
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
        await _exec(ctx, dut, encode_isub(3, 2, 1))  # DR3 = DR2 - 1
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
        # Direct result check: DR2 - 2 should be 0 → Z=1 (result = 2).
        await _exec(ctx, dut, encode_isub(3, 2, 2))  # DR3 = DR2 - 2
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

    Both values are built register-by-register since they exceed the unsigned
    14-bit immediate range. Direct result and NZCV checks cover every shift.
    """
    dut = ChurchCore(iot_profile=True)

    async def testbench(ctx):
        await _boot(ctx, dut)

        # Build 0x55555555 in DR7 using byte-at-a-time construction.
        # 0x55 = 85 fits in unsigned imm14; shifts and adds build the pattern.
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
        # 0xAA = 170 fits in unsigned imm14.
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
    test_conditional_shl,
    test_conditional_shr_lsr,
    test_conditional_shr_asr,
    test_arithmetic_setup_encoding,
    test_first_shr_setup_and_retirement,
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
