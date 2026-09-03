"""Focused hardware regressions for the corrected isolated SWITCH contract."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from amaranth.sim import Simulator

from hardware.registers import ChurchRegisters
from hardware.integrity32 import integrity32
from hardware.hw_types import (
    FaultType,
    GT_TYPE_INFORM,
    PERM_MASK_L,
    SWITCH_TGT_CR12,
    SWITCH_TGT_CR13,
    SWITCH_TGT_CR14,
    SWITCH_TGT_CR15,
    make_gt,
)
from hardware.switch import ChurchSwitch


def _cap(*, perms=PERM_MASK_L, location=0x1000, limit=7):
    return (
        make_gt(gt_type=GT_TYPE_INFORM, perms=perms, slot_id=1)
        | (location << 32)
        | (limit << 64)
    )


def _run(*, target, target_m, source=None, source_after_start=None, ticks=16):
    dut = ChurchSwitch()
    result = {
        "fault": FaultType.NONE,
        "mem_read": False,
        "mem_write": False,
        "cr_write": False,
        "thread_write": False,
        "read_addresses": [],
    }

    async def bench(ctx):
        ctx.set(dut.cr_src, 9)
        ctx.set(dut.target, target)
        ctx.set(dut.target_m, target_m)
        ctx.set(dut.index, 0)
        ctx.set(dut.cr_rd_data.as_value(), source if source is not None else _cap())
        ctx.set(dut.cr15_namespace.as_value(), _cap(location=0x2000, limit=0xFFFF))
        ctx.set(dut.switch_start, 1)
        await ctx.tick()
        ctx.set(dut.switch_start, 0)
        if source_after_start is not None:
            ctx.set(dut.cr_rd_data.as_value(), source_after_start)

        for _ in range(ticks):
            await ctx.tick()
            result["mem_read"] |= bool(ctx.get(dut.mem_rd_en))
            result["cr_write"] |= bool(ctx.get(dut.cr_wr_en))
            result["thread_write"] |= bool(ctx.get(dut.thread_wr_en))
            result["read_addresses"].append(ctx.get(dut.cr_rd_addr))
            if ctx.get(dut.switch_fault):
                result["fault"] = ctx.get(dut.fault_type)

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()
    return result


def test_all_four_isolated_targets_are_accepted():
    for target in (
        SWITCH_TGT_CR12,
        SWITCH_TGT_CR13,
        SWITCH_TGT_CR14,
        SWITCH_TGT_CR15,
    ):
        result = _run(target=target, target_m=1)
        assert result["fault"] != FaultType.INVALID_OP
        assert result["mem_read"], f"CR{target} did not enter normal mLoad"
        assert 9 in result["read_addresses"], "full 4-bit CR source was truncated"


def test_nonisolated_and_malformed_targets_fault_without_side_effects():
    for target in range(12):
        result = _run(target=target, target_m=1)
        assert result["fault"] == FaultType.INVALID_OP
        assert not result["mem_read"]
        assert not result["cr_write"]
        assert not result["thread_write"]


def test_isolated_source_registers_are_malformed_and_never_read():
    for source_cr in range(12, 16):
        dut = ChurchSwitch()
        observed = {"fault": FaultType.NONE, "mem_read": False,
                    "cr_write": False, "read_addresses": []}

        async def bench(ctx):
            ctx.set(dut.cr_src, source_cr)
            ctx.set(dut.target, SWITCH_TGT_CR12)
            ctx.set(dut.target_m, 1)
            ctx.set(dut.cr_rd_data.as_value(), _cap())
            ctx.set(dut.switch_start, 1)
            await ctx.tick()
            ctx.set(dut.switch_start, 0)
            for _ in range(6):
                await ctx.tick()
                observed["mem_read"] |= bool(ctx.get(dut.mem_rd_en))
                observed["cr_write"] |= bool(ctx.get(dut.cr_wr_en))
                observed["read_addresses"].append(ctx.get(dut.cr_rd_addr))
                if ctx.get(dut.switch_fault):
                    observed["fault"] = ctx.get(dut.fault_type)

        sim = Simulator(dut)
        sim.add_clock(1e-6)
        sim.add_testbench(bench)
        sim.run()
        assert observed["fault"] == FaultType.INVALID_OP
        assert not observed["mem_read"]
        assert not observed["cr_write"]
        # mLoad remains idle, so it never presents the malformed source.
        assert source_cr not in observed["read_addresses"]


def test_destination_m_clear_faults_before_source_or_memory_access():
    result = _run(target=SWITCH_TGT_CR14, target_m=0)
    assert result["fault"] == FaultType.PERM_L
    assert not result["mem_read"]
    assert not result["cr_write"]
    assert not result["thread_write"]


def test_destination_m_is_latched_at_instruction_acceptance():
    # Clearing the live input after acceptance cannot revoke an already
    # accepted operation; the accepted value is the authorization decision.
    dut = ChurchSwitch()
    observed = {"mem_read": False}

    async def bench(ctx):
        ctx.set(dut.cr_src, 2)
        ctx.set(dut.target, SWITCH_TGT_CR12)
        ctx.set(dut.target_m, 1)
        ctx.set(dut.index, 0)
        ctx.set(dut.cr_rd_data.as_value(), _cap())
        ctx.set(dut.cr15_namespace.as_value(), _cap(location=0x2000, limit=0xFFFF))
        ctx.set(dut.switch_start, 1)
        await ctx.tick()
        ctx.set(dut.switch_start, 0)
        ctx.set(dut.target_m, 0)
        for _ in range(12):
            await ctx.tick()
            observed["mem_read"] |= bool(ctx.get(dut.mem_rd_en))

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()
    assert observed["mem_read"]


def test_source_requires_normal_load_l_permission():
    result = _run(
        target=SWITCH_TGT_CR15,
        target_m=1,
        source=_cap(perms=0),
        ticks=12,
    )
    assert result["fault"] == FaultType.PERM_L
    assert not result["mem_read"]
    assert not result["cr_write"]


def test_only_successful_switch_consume_control_clears_accepted_destination_m():
    """The register-file consume wire is the sole successful-SWITCH lifecycle."""
    dut = ChurchRegisters()
    samples = []

    async def bench(ctx):
        # Seed CR14's M latch through its dedicated device port.
        ctx.set(dut.m_bit_device_target, 2)
        ctx.set(dut.m_bit_device_value, 1)
        ctx.set(dut.m_bit_device_wr_en, 1)
        await ctx.tick()
        ctx.set(dut.m_bit_device_wr_en, 0)
        samples.append(ctx.get(dut.isolated_m_flags))

        # A fault/no-completion path supplies no consume pulse and preserves M.
        await ctx.tick()
        samples.append(ctx.get(dut.isolated_m_flags))

        # A successful SWITCH completion consumes only CR14's M latch.
        ctx.set(dut.m_switch_consume_target, 2)
        ctx.set(dut.m_switch_consume_en, 1)
        await ctx.tick()
        ctx.set(dut.m_switch_consume_en, 0)
        samples.append(ctx.get(dut.isolated_m_flags))

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()
    assert samples == [0b0100, 0b0100, 0]


def test_successful_switch_emits_consumption_for_accepted_target():
    """Exercise the complete normal mLoad/NS-gate path, not a forced success."""
    dut = ChurchSwitch()
    source = _cap(location=0x1000, limit=0)
    loaded_gt = make_gt(
        gt_type=GT_TYPE_INFORM, perms=PERM_MASK_L, slot_id=1)
    ns_w1 = 7
    memory = {
        0x1000: loaded_gt,
        0x2010: 0x3000,
        0x2014: ns_w1,
        0x2018: integrity32(0x3000, ns_w1),
        0x201C: 0,
    }
    observed = {"complete": False, "consume": False, "target": None}

    async def bench(ctx):
        ctx.set(dut.cr_src, 6)
        ctx.set(dut.target, SWITCH_TGT_CR12)
        ctx.set(dut.target_m, 1)
        ctx.set(dut.index, 0)
        ctx.set(dut.cr_rd_data.as_value(), source)
        ctx.set(
            dut.cr15_namespace.as_value(),
            _cap(location=0x2000, limit=1),
        )
        ctx.set(dut.switch_start, 1)
        pending = None
        await ctx.tick()
        ctx.set(dut.switch_start, 0)
        for _ in range(96):
            ctx.set(dut.mem_rd_valid, int(pending is not None))
            ctx.set(dut.mem_rd_data, memory.get(pending, 0))
            await ctx.tick()
            if ctx.get(dut.switch_complete):
                observed["complete"] = True
            if ctx.get(dut.m_consume_en):
                observed["consume"] = True
                observed["target"] = ctx.get(dut.m_consume_target)
            pending = (
                ctx.get(dut.mem_addr) if ctx.get(dut.mem_rd_en) else None
            )

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()
    assert observed == {"complete": True, "consume": True, "target": 0}
