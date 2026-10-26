"""Independent counterexamples for capability/control-flow audit findings."""
import pytest
from amaranth.sim import Simulator
from hardware.msave import ChurchMSave
from hardware.call import ChurchCall
from hardware.lambda_unit import ChurchLambda
from hardware.hw_types import make_gt, GT_TYPE_INFORM, PERM_MASK_E, PERM_MASK_S, PERM_MASK_X
from hardware.integrity32 import integrity32
from hardware.core import ChurchCore
from hardware.hw_types import ChurchOpcode
from hardware.sim_boot_helpers import boot_core
from hardware.test_phase1_independent_execution import execute_data, snapshot


def run(dut, bench):
    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()


@pytest.mark.parametrize("slot,base,limit,valid", [
    (4097, 0, 255, False), (2, 0, 1, False),
    (1, 0xfffffff0, 255, False), (1, 0, 7, True),
])
def test_save_source_namespace_bounds(slot, base, limit, valid):
    dut = ChurchMSave()
    async def bench(ctx):
        ctx.set(dut.cr15_namespace.as_value(), (base << 32) | (limit << 64))
        ctx.set(dut.sub_dst_cap.as_value(),
                make_gt(GT_TYPE_INFORM, PERM_MASK_S, slot_id=2, b_flag=1) |
                (0x2000 << 32) | (7 << 64))
        ctx.set(dut.sub_src_gt, make_gt(GT_TYPE_INFORM, PERM_MASK_E, slot_id=slot, b_flag=1))
        ctx.set(dut.sub_index, 1)
        ctx.set(dut.sub_start, 1)
        await ctx.tick()
        ctx.set(dut.sub_start, 0)
        wrote = False
        for _ in range(30):
            addr = ctx.get(dut.mem_rd_addr) & 0xffff
            ctx.set(dut.mem_rd_data, {16: 0x1000, 20: 0, 24: integrity32(0x1000, 0)}.get(addr, 0))
            ctx.set(dut.mem_rd_valid, 1)
            ctx.set(dut.mem_wr_done, 1)
            if not valid:
                assert not ctx.get(dut.mem_rd_en)
                assert not ctx.get(dut.mem_wr_en)
            wrote |= bool(ctx.get(dut.mem_wr_en))
            if ctx.get(dut.sub_done) or ctx.get(dut.sub_fault):
                assert bool(ctx.get(dut.sub_fault)) != valid
                assert wrote == valid
                return
            await ctx.tick()
        pytest.fail("SAVE failed to terminate")
    run(dut, bench)


@pytest.mark.parametrize("header", [
    (31 << 27) | (1 << 10) | 255,  # impossible C-list
    (31 << 27) | (64 << 10),       # code includes allocation's header word
    (31 << 27) | (1 << 8) | (1 << 10),  # wrong object type
    1 << 10,                     # missing magic
    (31 << 27) | (9 << 23) | (1 << 10),
    (31 << 27) | (3 << 23) | (1 << 10),  # header larger than NS allocation
])
def test_call_rejects_malformed_header(header):
    dut = ChurchCall()
    async def bench(ctx):
        ctx.set(dut.cr_rd_data.as_value(),
                make_gt(GT_TYPE_INFORM, PERM_MASK_E, slot_id=2) | (255 << 64))
        ctx.set(dut.call_start, 1)
        await ctx.tick()
        ctx.set(dut.call_start, 0)
        for _ in range(100):
            ctx.set(dut.mload_done, 1)
            ctx.set(dut.mem_rd_valid, 1)
            ctx.set(dut.mem_rd_data, header)
            assert not ctx.get(dut.nia_set)
            assert not ctx.get(dut.mem_wr_en)
            assert not ctx.get(dut.cr_null_mask)
            if ctx.get(dut.call_fault):
                return
            await ctx.tick()
        pytest.fail("CALL accepted invalid header")
    run(dut, bench)


def test_lambda_pushes_single_protected_frame():
    dut = ChurchLambda()
    async def bench(ctx):
        ctx.set(dut.cr_rd_data.as_value(),
                make_gt(GT_TYPE_INFORM, PERM_MASK_X, slot_id=2) | (0x6020 << 32))
        ctx.set(dut.code_cap.as_value(),
                make_gt(GT_TYPE_INFORM, PERM_MASK_X, slot_id=2) | (0x6004 << 32) | (31 << 64))
        ctx.set(dut.thread_base, 0x4000)
        ctx.set(dut.thread_hdr, (31 << 27) | (2 << 23) | (32 << 10) | (2 << 8) | 12)
        ctx.set(dut.saved_nia, 0x6010)
        ctx.set(dut.flags, 5)
        ctx.set(dut.lambda_start, 1)
        await ctx.tick()
        ctx.set(dut.lambda_start, 0)
        writes = []
        for _ in range(40):
            ctx.set(dut.mem_rd_valid, 1)
            ctx.set(dut.mem_rd_data, 241 | (1 << 12))
            assert not ctx.get(dut.lambda_fault)
            if ctx.get(dut.mem_wr_en):
                writes.append((ctx.get(dut.mem_wr_addr), ctx.get(dut.mem_wr_data)))
            if ctx.get(dut.lambda_complete):
                assert writes == [
                    (0x4000 + 241 * 4, (5 << 28) | (3 << 13) | (1 << 12) | 241),
                    (0x4000 + 17 * 4, (5 << 28) | 240),
                ]
                return
            await ctx.tick()
        pytest.fail("LAMBDA did not complete")
    run(dut, bench)


def test_permission_fault_cannot_start_call_with_deferred_reset():
    dut = ChurchCore()
    async def bench(ctx):
        ctx.set(dut.defer_fault_reset, 1)
        await boot_core(ctx, dut)
        for _ in range(3):
            await execute_data(ctx, dut, 0xAF784000)
        # NULL type with E set: the generic checker and CALL must both reject.
        ctx.set(dut.dbg_cr_wr_en, 1)
        ctx.set(dut.dbg_cr_wr_addr, 0)
        ctx.set(dut.dbg_cr_wr_data.as_value(),
                make_gt(0, PERM_MASK_E, slot_id=2) | (0x6000 << 32) | (63 << 64))
        await ctx.tick()
        ctx.set(dut.dbg_cr_wr_en, 0)
        before = snapshot(ctx, dut)
        ctx.set(dut.imem_data, (int(ChurchOpcode.CALL) << 27) | (14 << 23))
        ctx.set(dut.imem_valid, 1)
        assert ctx.get(dut.fault_valid)
        await ctx.tick()
        ctx.set(dut.imem_valid, 0)
        for _ in range(40):
            assert not ctx.get(dut.dmem_wr_en)
            assert not ctx.get(dut.ns_wr_en)
            assert not ctx.get(dut.clist_wr_en)
            assert snapshot(ctx, dut)["cr"] == before["cr"]
            await ctx.tick()
    run(dut, bench)


@pytest.mark.parametrize("target_gt,expected_fault", [
    (0, 7),  # NULL_CAP
    (make_gt(GT_TYPE_INFORM, PERM_MASK_E, slot_id=2), 3),  # PERM_X
    (make_gt(GT_TYPE_INFORM, PERM_MASK_X, slot_id=2), None),
])
def test_lambda_checks_decoded_target_not_other_register(target_gt, expected_fault):
    dut = ChurchCore()
    async def bench(ctx):
        ctx.set(dut.defer_fault_reset, 1)
        await boot_core(ctx, dut)
        for _ in range(3):
            await execute_data(ctx, dut, 0xAF784000)
        # CR0 is executable, but LAMBDA targets CR3. Permission checking must
        # not be influenced by the idle unit's default read address (CR0).
        for register, gt in [(0, 0 if expected_fault is None else
                             make_gt(GT_TYPE_INFORM, PERM_MASK_X, slot_id=2)),
                             (3, target_gt)]:
            ctx.set(dut.dbg_cr_wr_en, 1)
            ctx.set(dut.dbg_cr_wr_addr, register)
            ctx.set(dut.dbg_cr_wr_data.as_value(), gt | (0x6000 << 32) | (63 << 64))
            await ctx.tick()
        ctx.set(dut.dbg_cr_wr_en, 0)
        before = snapshot(ctx, dut)
        ctx.set(dut.imem_data, (int(ChurchOpcode.LAMBDA) << 27) | (14 << 23) | (3 << 19))
        ctx.set(dut.imem_valid, 1)
        if expected_fault is None:
            # NULL in CR0 must not veto the valid X capability in CR3.
            assert not ctx.get(dut.fault_valid)
            return
        assert ctx.get(dut.fault_valid)
        assert ctx.get(dut.fault) == expected_fault
        await ctx.tick()
        ctx.set(dut.imem_valid, 0)
        for _ in range(20):
            assert not ctx.get(dut.dmem_wr_en)
            assert snapshot(ctx, dut)["cr"] == before["cr"]
            await ctx.tick()
    run(dut, bench)


def test_core_read_arbitration_has_no_structural_feedback():
    from amaranth.back import rtlil
    dut = ChurchCore()
    # Structural conversion traverses mux inputs even when behavioral benches
    # settle their selections. Keep this alongside permission regressions.
    text = rtlil.convert(dut, ports=[dut.imem_data, dut.imem_valid, dut.fault_valid])
    assert "module" in text
