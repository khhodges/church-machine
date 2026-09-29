"""Synthetic IDX1 preflight tests; no legacy core, memory or device involved."""

import pytest
from amaranth.sim import Simulator

from hardware.idx1 import (
    IDX1Preflight, IDX1_HEADER_LENGTH, IDX1_OPCODE_MODE, IDX1_ROLE_MASK,
    IDX1_RESERVED_REPLACEMENT, IDX1_DESCRIPTOR,
)


# Exact fixtures from docs/isa-indexed-encoding.md §8, not assembled binaries.
VECTORS = [
    ("52B00002 070B0000", 0, 2, None),
    ("53B07FFF 070B0000", 0, -32767, None),
    ("52200001 0F308000", 1, 1, None),
    ("52200000 2F630000", 5, 0, None),
    ("52300001 27610000", 4, 1, None),
    ("52300001 27778000", 4, 1, None),
    ("52200004 17030060", 2, 4, None),
    ("55400001 17030007", 2, None, -1),
    ("56200004 17030000 01400001", 2, 4, -1),
    ("54900000 17180000", 2, None, 0),
    ("52FFFFFF 87094000", 16, 1048575, None),
    ("52200000 8F0B4000", 17, 0, None),
    ("52300002 97090008", 18, 2, None),
    ("52200000 9F098004", 19, 0, None),
    ("53000002 B8800000", 23, -2, None),
]


def decode(words, *, dr0=0, dr1=0, pc=0, n=0, z=0, c=0, v=0,
           count=None):
    dut = IDX1Preflight()
    values = [int(word, 16) for word in words.split()]
    observed = {}

    async def bench(ctx):
        for sig, value in [
            (dut.w0, values[0]), (dut.w1, values[1] if len(values) > 1 else 0),
            (dut.w2, values[2] if len(values) > 2 else 0),
            (dut.words_available, len(values) if count is None else count),
            (dut.dr0_value, dr0), (dut.dr1_value, dr1), (dut.pc_word, pc),
            (dut.n, n), (dut.z, z), (dut.c, c), (dut.v, v),
        ]:
            ctx.set(sig, value)
        for name in ("structure_ok", "structure_reason", "length", "opcode",
                     "role_mask", "role0_reg", "role1_reg", "predicate_pass",
                     "arithmetic_valid", "role0_value", "role1_value",
                     "role0_arithmetic_ok", "role1_arithmetic_ok",
                     "arithmetic_ok", "branch_target", "branch_target_u32_ok",
                     "bitfield_range_ok", "literal_row", "literal_method"):
            observed[name] = ctx.get(getattr(dut, name))

    sim = Simulator(dut)
    sim.add_testbench(bench)
    sim.run()
    return observed


def signed(value, bits=34):
    return value - (1 << bits) if value & (1 << (bits - 1)) else value


@pytest.mark.parametrize("words,opcode,role0,role1", VECTORS)
def test_all_fifteen_exact_specification_vectors(words, opcode, role0, role1):
    result = decode(words, dr0=0, dr1=0, pc=2)
    assert result["structure_ok"] == 1
    assert result["opcode"] == opcode
    assert result["length"] == len(words.split())
    assert result["predicate_pass"] == 1  # NE is true with Z=0
    expected_arithmetic = opcode == 23 or (
        (role0 is None or role0 >= 0) and (role1 is None or role1 >= 0))
    assert result["arithmetic_ok"] == int(expected_arithmetic)
    if role0 is not None:
        assert signed(result["role0_value"]) == role0
    if role1 is not None:
        assert signed(result["role1_value"]) == role1
    if opcode == 23:
        assert result["branch_target"] == 0


@pytest.mark.parametrize("words,reason", [
    ("50B00002 070B0000", IDX1_ROLE_MASK),
    ("56200004 17030000", IDX1_HEADER_LENGTH),
    ("56200004 17030000 03400001", IDX1_RESERVED_REPLACEMENT),
    ("52B00002 070B0001", IDX1_RESERVED_REPLACEMENT),
    ("54B00002 070B0000", IDX1_ROLE_MASK),
    ("52B00002 57000000", IDX1_OPCODE_MODE),
    ("52B00002 47000000", IDX1_OPCODE_MODE),
    ("52B00002 F7000000", IDX1_OPCODE_MODE),
    ("52200000 87090000", IDX1_OPCODE_MODE),
    ("52200000 170B0000", IDX1_OPCODE_MODE),
    ("52200004 17031060", IDX1_RESERVED_REPLACEMENT),
    ("52300001 27010000", IDX1_OPCODE_MODE),
    ("52200000 2F7F8000", IDX1_OPCODE_MODE),
    ("52300002 97090000", IDX1_OPCODE_MODE),
    ("53B00000 070B0000", IDX1_DESCRIPTOR),
    ("5AB00002 070B0000", IDX1_HEADER_LENGTH),
    ("56200004 17030000 01400000", IDX1_DESCRIPTOR),
    ("56200004 17030001 01400001", IDX1_RESERVED_REPLACEMENT),
    ("54900000 17180001", IDX1_RESERVED_REPLACEMENT),
    ("52200000 97090408", IDX1_OPCODE_MODE),
    ("52200000 070B0000 00000000", IDX1_HEADER_LENGTH),
])
def test_invalid_packets_precede_predication(words, reason):
    # For NV the structure error is still reported; no runtime arithmetic.
    fields = words.split()
    fields[1] = f"{int(fields[1], 16) | (15 << 23):08X}"
    result = decode(" ".join(fields), dr0=0xffffffff)
    assert result["structure_ok"] == 0
    assert result["structure_reason"] == reason
    assert result["arithmetic_valid"] == 0
    assert result["arithmetic_ok"] == 0


@pytest.mark.parametrize("words,opcode,role0,role1", VECTORS)
def test_every_selected_role_requires_its_canonical_zero_mask(words, opcode,
                                                                 role0, role1):
    fields = [int(w, 16) for w in words.split()]
    mask = (fields[0] >> 25) & 3
    if mask & 1:
        bit = 5 if opcode in (18, 19) else 0
        fields[1] |= 1 << bit
        result = decode(" ".join(f"{word:08X}" for word in fields))
        assert result["structure_reason"] == IDX1_RESERVED_REPLACEMENT
        fields[1] &= ~(1 << bit)
    if mask & 2:
        bit = 5 if opcode == 2 and ((fields[1] >> 15) & 15) == 6 else 0
        fields[1] |= 1 << bit
        result = decode(" ".join(f"{word:08X}" for word in fields))
        assert result["structure_reason"] == IDX1_RESERVED_REPLACEMENT


def test_false_predicate_skips_runtime_arithmetic_but_not_structure():
    words = "52B00002 070B0000"
    # EQ with Z=0 is false, despite unsigned32 arithmetic overflow.
    result = decode(words, dr0=0xffffffff)
    assert result["structure_ok"] == 1
    assert result["predicate_pass"] == 1  # AL
    assert result["arithmetic_ok"] == 0
    eq_word = int("070B0000", 16) & ~(15 << 23)
    result = decode(f"52B00002 {eq_word:08X}", dr0=0xffffffff)
    assert result["structure_ok"] == 1
    assert result["predicate_pass"] == 0
    assert result["arithmetic_valid"] == 0
    assert result["role0_value"] == 0
    assert result["arithmetic_ok"] == 0


@pytest.mark.parametrize("words,dr0,dr1,valid,value0,value1", [
    ("53B07FFF 070B0000", 1, 0, False, -32766, None),
    ("52B00002 070B0000", 0xffffffff, 0, False, 0x100000001, None),
    ("52B00002 070B0000", 0xfffffffd, 0, True, 0xffffffff, None),
    ("52B00002 070B0000", 0x80000000, 0, True, 0x80000002, None),
    ("56200004 17030000 01400001", 5, 2, True, 9, 1),
    ("56200004 17030000 01400001", 0xffffffff, 0, False,
     0x100000003, -1),
    ("56200004 17030000 01400001", 5, 0, False, 9, -1),
    ("55400001 17030007", 0, 2, True, None, 1),
])
def test_full32_role_arithmetic(words, dr0, dr1, valid, value0, value1):
    result = decode(words, dr0=dr0, dr1=dr1)
    assert result["structure_ok"] == 1
    assert result["arithmetic_ok"] == valid
    if value0 is not None:
        assert signed(result["role0_value"]) == value0
    if value1 is not None:
        assert signed(result["role1_value"]) == value1


def test_dr0_is_zero_and_branch_signed_pc_is_widened():
    result = decode("53000002 B8800000", dr0=0xffffffff, pc=2)
    assert signed(result["role0_value"]) == -2
    assert result["branch_target"] == 0
    assert result["arithmetic_ok"] == 1
    result = decode("52200002 B8800000", dr0=0xffffffff, pc=0xffffffff)
    assert result["branch_target"] == 0x100000000
    assert result["branch_target_u32_ok"] == 0
    assert result["arithmetic_ok"] == 0
    # Change DR number in W0 to DR1: full32 signed negative displacement.
    result = decode("53100002 B8800000", dr0=0x80000000, pc=2)
    assert signed(result["role0_value"]) == -0x80000002
    assert result["arithmetic_ok"] == 0


def test_bitfield_checked_range_and_call_literals():
    assert decode("52300002 97090008", dr0=22)["bitfield_range_ok"] == 1
    assert decode("52300002 97090008", dr0=23)["arithmetic_ok"] == 0
    assert decode("52300002 97090008", dr0=0xffffffff)["arithmetic_ok"] == 0
    row = decode("52200004 17030060")
    assert (row["literal_method"], row["literal_row"]) == (3, 0)
    method = decode("55400001 17030007")
    assert method["literal_row"] == 7