"""Phase 1 operand behavior, including arithmetic containment and input capture."""
import pytest
from amaranth.sim import Simulator
from hardware.core import ChurchCore
from hardware.dread import ChurchDRead
from hardware.dwrite import ChurchDWrite
from hardware.call import ChurchCall
from hardware.sim_boot_helpers import boot_core
from hardware.test_phase1_independent_execution import execute_data, snapshot


@pytest.mark.parametrize("write", [False, True])
@pytest.mark.parametrize("imm,index,offset", [
    (0x0032, 5, 8), (0x4032, 5, 2), (0x0030, 0xFFFFFFFF, 3),
    (0x0002, 15, 15), (0x0012, 15, None),
    (0x4012, 0, None), (0x0012, 0xFFFFFFFF, None),
    (0x3FF2, 0, None),
])
def test_data_offset_and_accepted_index_capture(write, imm, index, offset):
    dut = ChurchDWrite() if write else ChurchDRead()

    async def bench(ctx):
        gt = 0x22000001 if write else 0x12000001
        ctx.set(dut.cr_rd_data.as_value(), gt | (0x1000 << 32) | (15 << 64))
        ctx.set(dut.cr_src, 1)
        ctx.set(dut.imm, imm)
        ctx.set(dut.start, 1)
        if write:
            ctx.set(dut.dr_src, 3)
            ctx.set(dut.dr_rd_data, 0xA55A)
            ctx.set(dut.dr_rd_data2, index)
        else:
            ctx.set(dut.dr_dst, 3)
            ctx.set(dut.dr_rd_data, index)
            ctx.set(dut.dmem_rd_data, 0xA55A)
        await ctx.tick()
        ctx.set(dut.start, 0)
        ctx.set(dut.imm, 0x7FFF)
        ctx.set(dut.dr_rd_data2 if write else dut.dr_rd_data, 12345)
        accesses = []
        for _ in range(20):
            enable = dut.dmem_wr_en if write else dut.dmem_rd_en
            if ctx.get(enable):
                accesses.append(ctx.get(dut.dmem_addr))
                assert offset is not None
                assert ctx.get(dut.dmem_addr) == 0x1000 + 4 * offset
                if write:
                    assert ctx.get(dut.dmem_wr_data) == 0xA55A
            if ctx.get(dut.fault):
                assert offset is None
                assert ctx.get(dut.fault_type) == 8
                assert not accesses
                return
            if ctx.get(dut.done):
                assert offset is not None and accesses
                return
            await ctx.tick()
        pytest.fail("Data operation did not terminate")
    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()


@pytest.mark.parametrize("setup,word,delta,fault", [
    (0xAF104005, 0xBF100003, 32, None),   # DR2+3 words
    (0xAF104005, 0xBF140003, 8, None),    # DR2-3 words
    (0xAF104005, 0xBF000003, 12, None),   # DR0+3 words
    (0xAF104000, 0xBF140064, None, 8),    # target below zero
    (0xB7104001, 0xBF100001, None, 8),    # target above 32 bits
    (0xAF104000, 0xBF03FFFF, None, 8),    # 32-bit target outside active code fence
    (0xAF104000, 0x17042001, None, 8),    # CALL row DR0-1
    (0xAF104000, 0x17090801, None, 8),    # CALL direct method DR0-1
    (0xB7104001, 0x17140001, None, 8),    # CALL row DR2+1 overflow
    (0xAF104000, 0x17030026, None, 11),   # retired indexed CALL layout
])
def test_branch_target_and_call_pre_admission_faults(setup, word, delta, fault):
    dut = ChurchCore()

    async def bench(ctx):
        ctx.set(dut.defer_fault_reset, 1)
        await boot_core(ctx, dut)
        for _ in range(3):
            await execute_data(ctx, dut, 0xAF784000)
        await execute_data(ctx, dut, setup)
        before = snapshot(ctx, dut)
        ctx.set(dut.imem_data, word)
        ctx.set(dut.imem_valid, 1)
        for en in (dut.dmem_wr_en, dut.ns_wr_en, dut.clist_wr_en, dut.dmem_rd_en):
            assert not ctx.get(en)
        if fault is not None:
            assert ctx.get(dut.fault_valid)
            assert ctx.get(dut.fault) == fault
            # The trace interface reports fault retirement, not successful
            # execution. Require its explicit fault marker and exact origin.
            assert ctx.get(dut.retire_fault_valid)
            assert ctx.get(dut.retire_fault_code) == fault
            assert ctx.get(dut.retire_instr) == word
            assert ctx.get(dut.retire_nia) == before["nia"]
            assert snapshot(ctx, dut) == before
            await ctx.tick()
            ctx.set(dut.imem_valid, 0)
            assert snapshot(ctx, dut) == before
        else:
            assert not ctx.get(dut.fault_valid)
            assert ctx.get(dut.retire_valid)
            await ctx.tick()
            ctx.set(dut.imem_valid, 0)
            after = snapshot(ctx, dut)
            assert after["nia"] == before["nia"] + delta
            for name in ("dr", "cr", "flags", "m"):
                assert after[name] == before[name]
    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()


@pytest.mark.parametrize("word,index,expected", [
    (0x97098821, 4, 1),          # extract bit DR2+1 from32
    (0x9F098821, 4, 31),         # insert low zero bit at DR2+1 into63
    (0x9709C821, 6, 1),          # subtract position magnitude:6-1
    (0x97098820, 4, None),       # width0
    (0x9709883F, 4, None),       # position5 + width31 exceeds32
    (0x9709C821, 0, None),       # negative position
    (0x97098821, 31, None),      # position32
])
def test_bitfield_index_and_invalid_no_effects(word, index, expected):
    dut = ChurchCore()

    async def bench(ctx):
        ctx.set(dut.defer_fault_reset, 1)
        await boot_core(ctx, dut)
        for _ in range(3):
            await execute_data(ctx, dut, 0xAF784000)
        for setup in (0xAF08403F, 0xAF104000 | index, 0xAF184020):
            await execute_data(ctx, dut, setup)
        if expected is not None:
            before, after = await execute_data(ctx, dut, word)
            dr = before["dr"].copy()
            dr[1] = expected
            assert after["dr"] == dr
            assert after["flags"] == (0, int(expected == 0), 0, 0)
        else:
            before = snapshot(ctx, dut)
            ctx.set(dut.imem_valid, 1)
            ctx.set(dut.imem_data, word)
            assert ctx.get(dut.fault_valid)
            assert ctx.get(dut.fault) == 8
            assert ctx.get(dut.retire_fault_valid)
            assert ctx.get(dut.retire_fault_code) == 8
            assert ctx.get(dut.retire_instr) == word
            assert ctx.get(dut.retire_nia) == before["nia"]
            for en in (dut.dmem_wr_en, dut.ns_wr_en, dut.clist_wr_en):
                assert not ctx.get(en)
            assert snapshot(ctx, dut) == before
            await ctx.tick()
            ctx.set(dut.imem_valid, 0)
            assert snapshot(ctx, dut) == before
    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()


@pytest.mark.parametrize("row,expected_fault", [(6, None), (0x10006, 8)])
def test_call_row_is_latched_and_not_truncated(row, expected_fault):
    dut = ChurchCall()
    cap = 0x1A000004 | (0x200 << 32) | (7 << 64)

    async def bench(ctx):
        ctx.set(dut.cr_src, 6)
        ctx.set(dut.indexed_source, 1)
        ctx.set(dut.index, row)
        ctx.set(dut.call_imm, 3)
        ctx.set(dut.cr_rd_data.as_value(), cap)
        ctx.set(dut.call_start, 1)
        await ctx.tick()
        ctx.set(dut.call_start, 0)
        # Poison every live selector after acceptance. The accepted source
        # remains CR6 and the accepted row must not become 0 or truncated6.
        ctx.set(dut.cr_src, 1)
        ctx.set(dut.indexed_source, 0)
        ctx.set(dut.index, 0)
        ctx.set(dut.call_imm, 0)
        reads = []
        previous_request = False
        for _ in range(32):
            ctx.set(dut.mem_rd_valid, previous_request)
            ctx.set(dut.mem_rd_data, 0)  # explicit NULL row; stop before callee entry
            previous_request = bool(ctx.get(dut.mem_rd_en))
            if previous_request:
                reads.append(ctx.get(dut.mem_rd_addr))
            assert not ctx.get(dut.cr_wr_en)
            assert not ctx.get(dut.mem_wr_en)
            if ctx.get(dut.call_fault):
                # The valid-row case stops at target admission. Its NULL/E
                # fault priority is outside this address/capture fixture.
                if expected_fault is not None:
                    assert ctx.get(dut.fault_type) == expected_fault
                assert (reads and all(x == 0x218 for x in reads)) if row == 6 else not reads
                return
            await ctx.tick()
        pytest.fail("CALL row fixture did not reach expected rejection")
    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()
