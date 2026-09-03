"""Capability checks for the target-bound isolated-register M device."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from amaranth.sim import Simulator

from hardware.dwrite import ChurchDWrite
from hardware.hw_types import (
    FaultType,
    GT_TYPE_ABSTRACT,
    GT_TYPE_INFORM,
    M_BIT_PORT_CR12,
    M_BIT_PORT_CR13,
    M_BIT_PORT_CR14,
    M_BIT_PORT_CR15,
    PERM_MASK_S,
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
           private=False, private_target=0):
    dut = ChurchDWrite()
    observed = {"m_write": False, "target": None, "value": None,
                "mem_write": False, "fault": FaultType.NONE}

    async def bench(ctx):
        ctx.set(dut.cr_src, 3)
        ctx.set(dut.dr_src, 4)
        ctx.set(dut.imm, imm)
        ctx.set(dut.cr_rd_data.as_value(), cap)
        ctx.set(dut.dr_rd_data, value)
        ctx.set(dut.namespace_authorized, namespace_authorized)
        ctx.set(dut.private_m_target, private_target)
        ctx.set(dut.private_m_value, value)
        ctx.set(dut.private_m_start, private)
        ctx.set(dut.start, not private)
        await ctx.tick()
        ctx.set(dut.start, 0)
        ctx.set(dut.private_m_start, 0)
        for _ in range(6):
            if ctx.get(dut.m_bit_wr_en):
                observed["m_write"] = True
                observed["target"] = ctx.get(dut.m_bit_wr_target)
                observed["value"] = ctx.get(dut.m_bit_wr_value)
            observed["mem_write"] |= bool(ctx.get(dut.dmem_wr_en))
            if ctx.get(dut.fault):
                observed["fault"] = ctx.get(dut.fault_type)
            await ctx.tick()

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()
    return observed


def test_exact_capability_controls_each_target_without_memory_write():
    ports = (M_BIT_PORT_CR12, M_BIT_PORT_CR13,
             M_BIT_PORT_CR14, M_BIT_PORT_CR15)
    for target, port in enumerate(ports):
        result = _write(_cap(GT_TYPE_ABSTRACT, PERM_MASK_S, port),
                        value=target & 1)
        assert result["m_write"]
        assert result["target"] == target
        assert result["value"] == (target & 1)
        assert not result["mem_write"]
        assert result["fault"] == FaultType.NONE


def test_raw_address_with_normal_write_permission_is_not_authority():
    result = _write(_cap(GT_TYPE_INFORM, PERM_MASK_W, M_BIT_PORT_CR14))
    assert result["fault"] == FaultType.PERM_S
    assert not result["m_write"]
    assert not result["mem_write"]


def test_wrong_rights_or_attenuation_cannot_use_device():
    cases = (
        _cap(GT_TYPE_ABSTRACT, 0, M_BIT_PORT_CR12),
        _cap(GT_TYPE_ABSTRACT, PERM_MASK_S, M_BIT_PORT_CR13, limit=1),
    )
    for cap in cases:
        result = _write(cap)
        assert result["fault"] != FaultType.NONE
        assert not result["m_write"]
        assert not result["mem_write"]


def test_other_abstraction_cannot_use_exact_namespace_device_capability():
    result = _write(
        _cap(GT_TYPE_ABSTRACT, PERM_MASK_S, M_BIT_PORT_CR15),
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
        private_target=2,
    )
    assert result["fault"] == FaultType.PERM_S
    assert not result["m_write"]
    assert not result["mem_write"]
