"""Focused RTL regressions for CALL CR6[row], method."""

from amaranth.sim import Simulator

from hardware.call import ChurchCall
from hardware.decoder import ChurchDecoder


def _cap(gt, location=0, limit=0):
    return gt | (location << 32) | (limit << 64)


def test_wukong_callhome_row6_decodes_as_indexed_call():
    dut = ChurchDecoder()
    # CALL CR6[WukongCallHome.hw], Main:
    # opcode=2, cr_dst=0, cr_src=6, method selector=1, c-list row=6.
    instruction = (2 << 27) | (6 << 15) | (1 << 5) | 6
    observed = {}

    async def bench(ctx):
        ctx.set(dut.instruction, instruction)
        ctx.set(dut.instr_valid, 1)
        observed.update(
            indexed=ctx.get(dut.call_indexed),
            row=ctx.get(dut.call_clist_row),
            method=ctx.get(dut.call_method_index),
        )

    sim = Simulator(dut)
    sim.add_testbench(bench)
    sim.run()

    assert observed == {"indexed": 1, "row": 6, "method": 1}


def test_cr6_register_bound_call_is_not_misdecoded_as_indexed():
    dut = ChurchDecoder()
    # A nonzero cr_dst retains the ordinary register-bound CALL meaning even
    # when the generic cr_src field happens to contain CR6.
    instruction = (2 << 27) | (6 << 19) | (6 << 15) | 3
    observed = {}

    async def bench(ctx):
        ctx.set(dut.instruction, instruction)
        ctx.set(dut.instr_valid, 1)
        observed.update(
            indexed=ctx.get(dut.call_indexed),
            method=ctx.get(dut.call_method_index),
        )

    sim = Simulator(dut)
    sim.add_testbench(bench)
    sim.run()

    assert observed == {"indexed": 0, "method": 3}


def test_indexed_call_reads_row6_directly_and_never_writes_cr0():
    dut = ChurchCall()
    # Inform Church-domain CR6 with L permission, base 0x200, rows 0..7.
    cr6_gt = (1 << 25) | (1 << 27) | (0b001 << 28) | 4
    cr6_cap = _cap(cr6_gt, location=0x200, limit=7)
    # Selected row is deliberately NULL so the focused test stops immediately
    # after proving the direct row fetch; no architectural write is required.
    observed = {"read_addresses": [], "write_addresses": []}

    async def bench(ctx):
        ctx.set(dut.cr_src, 6)
        ctx.set(dut.indexed_source, 1)
        ctx.set(dut.index, 6)
        ctx.set(dut.call_imm, 1)
        ctx.set(dut.cr_rd_data.as_value(), cr6_cap)
        ctx.set(dut.call_start, 1)
        await ctx.tick()
        ctx.set(dut.call_start, 0)

        previous_read = False
        previous_address = 0
        for _ in range(20):
            ctx.set(dut.cr_rd_data.as_value(), cr6_cap)
            ctx.set(dut.mem_rd_valid, previous_read)
            ctx.set(dut.mem_rd_data, 0)
            if ctx.get(dut.mem_rd_en):
                previous_address = ctx.get(dut.mem_rd_addr)
                observed["read_addresses"].append(previous_address)
                previous_read = True
            else:
                previous_read = False
            if ctx.get(dut.cr_wr_en):
                observed["write_addresses"].append(ctx.get(dut.cr_wr_addr))
            await ctx.tick()
            if ctx.get(dut.call_fault):
                break

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()

    assert 0x218 in observed["read_addresses"]  # 0x200 + row 6 * 4
    assert 0 not in observed["write_addresses"]