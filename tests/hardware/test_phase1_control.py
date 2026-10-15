"""H03/H05/H09: independent encoded forms and committed RETURN keep masks."""
import pytest
from amaranth.sim import Simulator
from hardware.decoder import ChurchDecoder
from hardware.registers import ChurchRegisters
from hardware.call import ChurchCall
from phase1_support import word


@pytest.mark.parametrize("row", [0, 31])
@pytest.mark.parametrize("method", [0, 127])
@pytest.mark.parametrize("signs", range(4))
def test_h03_approved_indexed_call_mode(row, method, signs):
    dut = ChurchDecoder()
    # DR0 selectors isolate approved literal magnitudes from runtime arithmetic.
    instruction = 0x17040000 | (signs << 12) | (method << 5) | row
    async def bench(ctx):
        ctx.set(dut.instruction, instruction)
        ctx.set(dut.instr_valid, 1)
        assert ctx.get(dut.exec_enable)
        assert ctx.get(dut.call_indexed) == 1, hex(instruction)
        assert ctx.get(dut.call_clist_row) == row, hex(instruction)
        assert ctx.get(dut.call_method_index) == method, hex(instruction)
    sim = Simulator(dut)
    sim.add_testbench(bench)
    sim.run()


@pytest.mark.parametrize("target", range(16))
@pytest.mark.parametrize("method", [0, 1, 32767])
def test_h03_direct_immediate_call(target, method):
    dut = ChurchDecoder()
    instruction = word(2, target, 0, method)
    async def bench(ctx):
        ctx.set(dut.instruction, instruction)
        ctx.set(dut.instr_valid, 1)
        assert ctx.get(dut.call_indexed) == 0
        assert ctx.get(dut.call_method_index) == method
        assert ctx.get(dut.cr_dst) == target
    sim = Simulator(dut)
    sim.add_testbench(bench)
    sim.run()


@pytest.mark.parametrize("method,entry", [(0, 1), (1, 2), (4, 4), (1, 0), (1, 5), (5, 2)])
def test_h05_method_selection_before_frame_boundary(method, entry):
    """CALL unit wired to a deterministic validated-descriptor responder.

    Stop before protected-frame construction: its exact packing is unresolved.
    The responder is not mLoad evidence; NS gate tests cover real validation.
    """
    dut = ChurchCall()
    crs = [0x02000000+i | (0x9000+i*256) << 32 | 255 << 64 for i in range(16)]
    crs[2] = 0x4a000002 | 0x2000 << 32 | 63 << 64
    crs[6] = 0x1a000003 | 0x3000 << 32 | 3 << 64
    header = 0xf8001001  # 64 words, cw=4, cc=1
    memory = {0x2000: header, 0x2000+4*method: entry}
    memory[0x2000] = header
    valid = method <= 4 and (method == 0 or 1 <= entry <= 4)
    async def bench(ctx):
        ctx.set(dut.cr_src, 2)
        ctx.set(dut.call_imm, method)
        ctx.set(dut.cr14_code.as_value(), crs[2])
        ctx.set(dut.call_start, 1)
        await ctx.tick()
        ctx.set(dut.call_start, 0)
        # Change accepted fields to catch accidental later live-input use.
        ctx.set(dut.cr_src, 9)
        ctx.set(dut.call_imm, 32767)
        for _ in range(96):
            ctx.set(dut.cr_rd_data.as_value(), crs[ctx.get(dut.cr_rd_addr)])
            if ctx.get(dut.call_fault):
                assert not valid, ("early CALL fault", ctx.get(dut.fault_type))
                assert not ctx.get(dut.nia_set)
                return
            assert not ctx.get(dut.mem_wr_en), "frame writes before method validation"
            if ctx.get(dut.nia_set):
                assert valid
                assert ctx.get(dut.nia_value) == 0x2000 + 4 * (1 if method == 0 else entry)
                return
            if ctx.get(dut.cr_wr_en):
                crs[ctx.get(dut.cr_wr_addr)] = ctx.get(dut.cr_wr_data.as_value())
            pending = ctx.get(dut.mload_start)
            if pending:
                assert ctx.get(dut.mload_direct_gt) == 0x4a000002
                crs[ctx.get(dut.mload_cr_dst)] = 0x4a000002 | 0x2000 << 32 | 63 << 64
            request, addr = ctx.get(dut.mem_rd_en), ctx.get(dut.mem_rd_addr)
            # CR6 final reconstruction precedes stack construction and is
            # independently observable without selecting a frame oracle.
            if valid and ctx.get(dut.cr_wr_en) and ctx.get(dut.cr_wr_addr) == 6:
                cap = ctx.get(dut.cr_wr_data.as_value())
                if (cap >> 32 & 0xffffffff) == 0x20fc:
                    assert cap & 0xffffffff == 0x1a000002
                    assert cap >> 64 == 0
                    return
            await ctx.tick()
            ctx.set(dut.mload_done, pending)
            ctx.set(dut.mem_rd_valid, request)
            ctx.set(dut.mem_rd_data, memory.get(addr, 0xdead0000))
        pytest.fail("CALL method validation timeout")
    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()


@pytest.mark.parametrize("mask", [0, 4095, *(1 << bit for bit in range(12))])
def test_h05_return_committed_keep_mask_no_snapshot(mask):
    dut = ChurchRegisters()
    caps = [0x82000000 + i | (0x5100 + 4*i) << 32 | (0xa5000000+i) << 64
            for i in range(16)]
    data = [0 if i == 0 else 0x12340000+i for i in range(16)]
    async def bench(ctx):
        ctx.set(dut.cr_wr_en, 1)
        ctx.set(dut.dr_wr_en, 1)
        for i in range(16):
            ctx.set(dut.cr_wr_addr, i)
            ctx.set(dut.cr_wr_data.as_value(), caps[i])
            ctx.set(dut.dr_wr_addr, i)
            ctx.set(dut.dr_wr_data, data[i])
            await ctx.tick()
        ctx.set(dut.cr_wr_en, 0)
        ctx.set(dut.dr_wr_en, 0)
        before = [sum(ctx.get(w) << (32*j) for j, w in enumerate(reg))
                  for reg in dut.debug_cr_words]
        assert before == caps
        # Successful validated-return commit boundary. Frame validation is not
        # claimed by this register-file test; that oracle is explicitly blocked.
        ctx.set(dut.return_mask, mask)
        ctx.set(dut.return_commit_en, 1)
        await ctx.tick()
        ctx.set(dut.return_commit_en, 0)
        for i, reg in enumerate(dut.debug_cr_words):
            expected = 0 if i in (*range(5), *range(7, 12)) and not mask & (1 << i) else caps[i]
            assert sum(ctx.get(w) << (32*j) for j, w in enumerate(reg)) == expected
        assert [ctx.get(r) for r in dut.debug_dr_words] == data
    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()


@pytest.mark.parametrize("case", [
    "H05 nested CALL and RETURN continuation, empty/root/corrupt frame",
    "H05 LAMBDA validated continuation and caller scope",
    "H08 valid/suspended/root Thread and restored-CR mLoad",
    "H08 unused invalid c-list row followed by use",
    "H09 self/helper/other CHANGE save-load ordering",
    "H09 SWITCH Namespace and fixed slot-2 Thread activation",
])
def test_frame_dependent_scenarios_blocked(case):
    pytest.skip("BLOCKED: " + case +
                "; exact protected frame/indicator or LAMBDA continuation oracle "
                "not closed in instruction-set.md §Oracle closure. Not a pass.")
