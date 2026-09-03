"""Capability checks for the target-bound isolated-register M device."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from amaranth.sim import Simulator

from hardware.dread import ChurchDRead
from hardware.dwrite import ChurchDWrite
from hardware.hw_types import (
    FaultType,
    GT_TYPE_INFORM,
    M_BIT_DEVICE_NS_SLOT,
    M_BIT_PORT,
    PERM_MASK_R,
    PERM_MASK_W,
    make_gt,
)


def _cap(gt_type, perms, location, limit=0):
    return (
        make_gt(gt_type=gt_type, perms=perms)
        | (location << 32)
        | (limit << 64)
    )


def _write(cap, *, imm=0x4000, value=1, namespace_authorized=True,
           private=False):
    dut = ChurchDWrite()
    observed = {"m_write": False, "word": None,
                "mem_write": False, "fault": FaultType.NONE}

    async def bench(ctx):
        ctx.set(dut.cr_src, 3)
        ctx.set(dut.dr_src, 4)
        ctx.set(dut.imm, imm)
        ctx.set(dut.cr_rd_data.as_value(), cap)
        ctx.set(dut.dr_rd_data, value)
        ctx.set(dut.namespace_authorized, namespace_authorized)
        ctx.set(dut.private_m_word, value & 0xFFFF)
        ctx.set(dut.private_m_start, private)
        ctx.set(dut.start, not private)
        await ctx.tick()
        ctx.set(dut.start, 0)
        ctx.set(dut.private_m_start, 0)
        for _ in range(6):
            if ctx.get(dut.m_bit_wr_en):
                observed["m_write"] = True
                observed["word"] = ctx.get(dut.m_bit_wr_word)
            observed["mem_write"] |= bool(ctx.get(dut.dmem_wr_en))
            if ctx.get(dut.fault):
                observed["fault"] = ctx.get(dut.fault_type)
            await ctx.tick()

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()
    return observed


def _read(cap, *, imm=0x4000, value=0, namespace_authorized=True,
          authorization_after_start=None):
    dut = ChurchDRead()
    observed = {"m_read": False, "word": None,
                "mem_read": False, "fault": FaultType.NONE}

    async def bench(ctx):
        ctx.set(dut.cr_src, 3)
        ctx.set(dut.dr_dst, 4)
        ctx.set(dut.imm, imm)
        ctx.set(dut.cr_rd_data.as_value(), cap)
        ctx.set(dut.m_bit_rd_word, value & 0xFFFF)
        ctx.set(dut.namespace_authorized, namespace_authorized)
        ctx.set(dut.start, 1)
        await ctx.tick()
        ctx.set(dut.start, 0)
        if authorization_after_start is not None:
            ctx.set(dut.namespace_authorized, authorization_after_start)
        for _ in range(6):
            if ctx.get(dut.dr_wr_en):
                observed["m_read"] = True
                observed["word"] = ctx.get(dut.dr_wr_data)
            observed["mem_read"] |= bool(ctx.get(dut.dmem_rd_en))
            if ctx.get(dut.fault):
                observed["fault"] = ctx.get(dut.fault_type)
            await ctx.tick()

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()
    return observed


def test_exact_capability_writes_one_low_16_bit_word_without_memory_write():
    cap = _cap(
        GT_TYPE_INFORM,
        PERM_MASK_R | PERM_MASK_W,
        M_BIT_PORT,
    ) | M_BIT_DEVICE_NS_SLOT
    result = _write(cap, value=0xA55A)
    assert result["m_write"]
    assert result["word"] == 0xA55A
    assert not result["mem_write"]
    assert result["fault"] == FaultType.NONE


def test_exact_capability_reads_zero_extended_m_register_without_memory_read():
    cap = _cap(
        GT_TYPE_INFORM,
        PERM_MASK_R | PERM_MASK_W,
        M_BIT_PORT,
    ) | M_BIT_DEVICE_NS_SLOT
    result = _read(cap, value=0xA55A)
    assert result["m_read"]
    assert result["word"] == 0x0000A55A
    assert not result["mem_read"]
    assert result["fault"] == FaultType.NONE


def test_m_register_read_latches_namespace_authorization_at_acceptance():
    cap = _cap(
        GT_TYPE_INFORM,
        PERM_MASK_R,
        M_BIT_PORT,
    ) | M_BIT_DEVICE_NS_SLOT
    result = _read(
        cap,
        value=1 << 12,
        namespace_authorized=True,
        authorization_after_start=False,
    )
    assert result["m_read"]
    assert result["word"] == 1 << 12
    assert result["fault"] == FaultType.NONE


def test_other_abstraction_cannot_read_namespace_m_register():
    cap = _cap(
        GT_TYPE_INFORM,
        PERM_MASK_R,
        M_BIT_PORT,
    ) | M_BIT_DEVICE_NS_SLOT
    result = _read(cap, value=0xFFFF, namespace_authorized=False)
    assert result["fault"] == FaultType.PERM_S
    assert not result["m_read"]
    assert not result["mem_read"]


def test_raw_read_address_is_not_m_register_authority():
    result = _read(_cap(GT_TYPE_INFORM, PERM_MASK_R, M_BIT_PORT))
    assert result["fault"] == FaultType.PERM_S
    assert not result["m_read"]
    assert not result["mem_read"]


def test_raw_address_with_normal_write_permission_is_not_authority():
    result = _write(_cap(GT_TYPE_INFORM, PERM_MASK_W, M_BIT_PORT))
    assert result["fault"] == FaultType.PERM_S
    assert not result["m_write"]
    assert not result["mem_write"]


def test_wrong_rights_or_attenuation_cannot_use_device():
    cases = (
        _cap(GT_TYPE_INFORM, 0, M_BIT_PORT) | M_BIT_DEVICE_NS_SLOT,
        _cap(GT_TYPE_INFORM, PERM_MASK_W, M_BIT_PORT, limit=1) | M_BIT_DEVICE_NS_SLOT,
    )
    for cap in cases:
        result = _write(cap)
        assert result["fault"] != FaultType.NONE
        assert not result["m_write"]
        assert not result["mem_write"]


def test_other_abstraction_cannot_use_exact_namespace_device_capability():
    result = _write(
        _cap(GT_TYPE_INFORM, PERM_MASK_W, M_BIT_PORT) | M_BIT_DEVICE_NS_SLOT,
        namespace_authorized=False,
    )
    assert result["fault"] == FaultType.PERM_S
    assert not result["m_write"]
    assert not result["mem_write"]


def test_other_abstraction_cannot_select_hidden_private_bank():
    result = _write(
        0,
        namespace_authorized=False,
        private=True,
    )
    assert result["fault"] == FaultType.PERM_S
    assert not result["m_write"]
    assert not result["mem_write"]
