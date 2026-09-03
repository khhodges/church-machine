"""Focused hardware tests for M-authorized SAVE from isolated CR12-CR15."""

from amaranth.sim import Simulator

from hardware.hw_types import FaultType, GT_TYPE_INFORM, PERM_MASK_S, make_gt
from hardware.integrity32 import integrity32
from hardware.registers import ChurchRegisters
from hardware.save import ChurchSave


def _cap(gt, location=0x100, limit=3, far=False):
    value = 0
    value |= gt
    value |= location << 32
    # limit_offset occupies the low bits of word2.
    value |= (limit | (int(far) << 31)) << 64
    return value


def _run_save(
        *, source_m, source_gt, dst_gt=None, dst_far=False, index=1,
        complete_write=True, source_m_after_accept=None, source_reg=12):
    dut = ChurchSave()
    observed = {
        "fault": None,
        "complete": False,
        "consume": [],
        "consume_targets": [],
        "writes": [],
    }
    dst_gt = dst_gt if dst_gt is not None else make_gt(
        GT_TYPE_INFORM, PERM_MASK_S, slot_id=2, b_flag=1)
    dst_cap = _cap(dst_gt, far=dst_far)
    src_cap = _cap(source_gt)
    ns_location = 0x200
    ns_word1 = 0
    ns_integrity = integrity32(ns_location, ns_word1)

    async def testbench(ctx):
        ctx.set(dut.save_start, 1)
        ctx.set(dut.cr_src, 6)
        ctx.set(dut.cr_dst, source_reg)
        ctx.set(dut.index, index)
        ctx.set(dut.source_m, source_m)
        await ctx.tick()
        ctx.set(dut.save_start, 0)
        # Decoder outputs are live and may already describe the next
        # instruction. The in-flight SAVE must use only accepted operands.
        ctx.set(dut.cr_src, 5)
        ctx.set(dut.cr_dst, 15)
        ctx.set(dut.index, 99)
        if source_m_after_accept is not None:
            ctx.set(dut.source_m, source_m_after_accept)

        for _ in range(32):
            rd_addr = ctx.get(dut.cr_rd_addr)
            ctx.set(
                dut.cr_rd_data.as_value(),
                dst_cap if rd_addr == 6 else src_cap)
            if ctx.get(dut.mem_rd_en):
                addr = ctx.get(dut.mem_rd_addr)
                offset = addr & 0xF
                ns_word = {
                    0: ns_location,
                    4: ns_word1,
                    8: ns_integrity,
                }.get(offset, 0)
                ctx.set(dut.mem_rd_data, ns_word)
                ctx.set(dut.mem_rd_valid, 1)
            else:
                ctx.set(dut.mem_rd_valid, 0)
            ctx.set(dut.mem_wr_done, int(complete_write and ctx.get(dut.mem_wr_en)))
            observed["writes"].append(ctx.get(dut.mem_wr_en))
            observed["consume"].append(ctx.get(dut.m_consume_en))
            if ctx.get(dut.m_consume_en):
                observed["consume_targets"].append(
                    ctx.get(dut.m_consume_target))
            if ctx.get(dut.save_fault):
                observed["fault"] = ctx.get(dut.fault_type)
                return
            if ctx.get(dut.save_complete):
                observed["complete"] = True
                return
            await ctx.tick()

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    sim.run()
    return observed


def test_isolated_save_rejects_m_zero_without_write_or_consumption():
    result = _run_save(
        source_m=0,
        source_gt=make_gt(GT_TYPE_INFORM, 0, slot_id=3),
        # Authorization is bound to acceptance, not a later device write.
        source_m_after_accept=1)
    assert result["fault"] == int(FaultType.PERM_L)
    assert not any(result["writes"])
    assert not any(result["consume"])


def test_isolated_save_m_one_bypasses_source_bind_and_consumes_on_success():
    result = _run_save(
        source_m=1,
        # B=0 proves accepted M bypasses the ordinary source export gate.
        source_gt=make_gt(GT_TYPE_INFORM, 0, slot_id=3, b_flag=0),
        # F=1 proves the same accepted authority bypasses the remote-export
        # gate without bypassing destination S.
        dst_gt=make_gt(GT_TYPE_INFORM, PERM_MASK_S, slot_id=2, b_flag=1),
        dst_far=True,
        # Consumption is likewise tied to accepted M=1 even if the live bit
        # changes while the multi-cycle SAVE is in flight.
        source_m_after_accept=0)
    assert result["complete"]
    assert any(result["writes"])
    assert any(result["consume"])


def test_each_isolated_source_register_uses_its_own_m_consumption_target():
    for source_reg in range(12, 16):
        result = _run_save(
            source_m=1,
            source_reg=source_reg,
            source_gt=make_gt(
                GT_TYPE_INFORM, 0, slot_id=3, b_flag=1))
        assert result["complete"], f"CR{source_reg} SAVE did not complete"
        assert result["consume_targets"] == [source_reg - 12]


def test_ordinary_save_still_rejects_far_export():
    result = _run_save(
        source_m=0,
        source_reg=1,
        source_gt=make_gt(GT_TYPE_INFORM, 0, slot_id=3, b_flag=1),
        dst_far=True)
    assert result["fault"] == int(FaultType.F_BIT)
    assert not any(result["writes"])
    assert not any(result["consume"])


def test_isolated_save_still_requires_destination_s():
    result = _run_save(
        source_m=1,
        source_gt=make_gt(GT_TYPE_INFORM, 0, slot_id=3),
        dst_gt=make_gt(GT_TYPE_INFORM, 0, slot_id=2, b_flag=1))
    assert result["fault"] == int(FaultType.PERM_S)
    assert not any(result["writes"])
    assert not any(result["consume"])


def test_isolated_save_m_does_not_bypass_destination_bind():
    result = _run_save(
        source_m=1,
        source_gt=make_gt(GT_TYPE_INFORM, 0, slot_id=3),
        dst_gt=make_gt(
            GT_TYPE_INFORM, PERM_MASK_S, slot_id=2, b_flag=0))
    assert result["fault"] == int(FaultType.BIND)
    assert not any(result["writes"])
    assert not any(result["consume"])


def test_isolated_save_failure_is_atomic_and_preserves_m():
    result = _run_save(
        source_m=1,
        source_gt=make_gt(GT_TYPE_INFORM, 0, slot_id=3),
        index=4)
    assert result["fault"] == int(FaultType.BOUNDS)
    assert not any(result["writes"])
    assert not any(result["consume"])


def test_successful_save_consumes_only_the_accepted_source_m_bit():
    dut = ChurchRegisters()
    observed = {}

    async def testbench(ctx):
        ctx.set(dut.m_bit_device_wr_en, 1)
        ctx.set(dut.m_bit_device_word, 0xF000)
        await ctx.tick()
        ctx.set(dut.m_bit_device_wr_en, 0)

        # Model a successful SAVE from CR13.
        ctx.set(dut.m_save_consume_en, 1)
        ctx.set(dut.m_save_consume_target, 1)
        await ctx.tick()
        ctx.set(dut.m_save_consume_en, 0)
        observed["m_bits"] = ctx.get(dut.m_bit_device_state)

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(testbench)
    sim.run()

    assert observed["m_bits"] == 0xD000