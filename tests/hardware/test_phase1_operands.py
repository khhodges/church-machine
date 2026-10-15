"""H03/H06/H09 core-level accepted operand routing and forbidden effects."""
import pytest
from phase1_support import MASK, run_core, set_cr, set_dr, snapshot, word, seal


@pytest.mark.parametrize("op,index,mag,subtract", [
    (op, index, mag, subtract)
    for op in (0, 2, 5)
    for index, mag, subtract in [
    (0, 0, False), (0, 31, False), (32, 31, True),
    (0, 31, True), (MASK, 1, False), (0x80000000, 1, True),
    (1023, 1023, True), (0, 1023, False),
    ] if op != 2 or mag <= 31
])
def test_checked_clist_row_before_any_effect(op, index, mag, subtract):
    async def bench(ctx, core):
        await set_dr(ctx, core, 11, index)
        await set_cr(ctx, core, 6, 0x3a000002, 0x2000, 31)  # L+S
        await set_cr(ctx, core, 2, 0x82000003, 0x3000, 63)  # transferable
        ctx.set(core.dbg_m_bit_word, 0x8000)
        ctx.set(core.dbg_m_bit_wr_en, 1)
        await ctx.tick()
        ctx.set(core.dbg_m_bit_wr_en, 0)
        instruction = (0x175c0000 | int(subtract) << 13 | mag) if op == 2 else word(
            op, 0 if op == 5 else 2, 6, int(subtract) << 14 | mag << 4 | 11)
        row = index + (-mag if subtract else mag)
        valid = 0 <= row <= 31
        before = snapshot(ctx, core)
        nia = ctx.get(core.nia)
        ctx.set(core.defer_fault_reset, 1)
        ctx.set(core.imem_data, instruction)
        ctx.set(core.imem_valid, 1)
        reads = []
        for _ in range(96):
            if ctx.get(core.dmem_rd_en):
                reads.append(ctx.get(core.dmem_addr))
            assert not ctx.get(core.dmem_wr_en), (hex(instruction), reads)
            if ctx.get(core.retire_fault_valid) or ctx.get(core.fault_valid):
                assert snapshot(ctx, core) == before
                assert ctx.get(core.nia) == nia
                if valid:
                    assert reads and reads[0] == 0x2000 + row * 4, (hex(instruction), reads)
                else:
                    assert reads == [], (hex(instruction), reads)
                return
            request = ctx.get(core.dmem_rd_en)
            await ctx.tick()
            ctx.set(core.imem_valid, 0)
            ctx.set(core.dmem_rd_valid, request)
            # NULL selected row ends LOAD/CALL/SWITCH before publication.
            ctx.set(core.dmem_rd_data, 0)
        pytest.fail(("bounded fault absent", hex(instruction), reads))
    run_core(bench)


@pytest.mark.parametrize("index,mag,subtract", [
    (0, 0, False), (0, 2047, False), (2048, 2047, True),
    (0, 1, True), (MASK, 1, False), (0x7fffffff, 1, False),
    (0x80000000, 2047, True),
])
def test_h03_runtime_direct_call_checked_method(index, mag, subtract):
    async def bench(ctx, core):
        await set_dr(ctx, core, 11, index)
        await set_cr(ctx, core, 2, 0x4a000002, 0x2000, 4095)
        await set_cr(ctx, core, 15, 0x1a000000, 0x8000, 255)
        method = index + (-mag if subtract else mag)
        instruction = 0x1711b000 | int(subtract) << 11 | mag
        memory = {0x8020: 0x2000, 0x8024: 4095,
                  0x8028: seal(0x2000, 4095), 0x802c: 0,
                  0x2000: 0xfb300001}  # allocation=4096, cw=3072, cc=1
        ctx.set(core.defer_fault_reset, 1)
        ctx.set(core.imem_data, instruction)
        ctx.set(core.imem_valid, 1)
        reads = []
        for _ in range(160):
            request, address = ctx.get(core.dmem_rd_en), ctx.get(core.dmem_addr)
            if request:
                reads.append(address)
            assert not ctx.get(core.dmem_wr_en), reads
            if 0 < method <= 3072 and request and address == 0x2000 + 4*method:
                return
            if method == 0 and ctx.get(core.dbg_cr_wr_en):
                pytest.fail("unexpected debug write")
            if ctx.get(core.retire_fault_valid):
                if method == 0:
                    # No public method table read for entry word 1. Subsequent
                    # missing Thread context is outside this operand fixture.
                    assert 0x2000 in reads and all(a < 0x2004 or a >= 0x8000 for a in reads)
                elif 0 < method <= 3072:
                    pytest.fail(("valid method never read", method, reads))
                else:
                    assert all(not 0x2004 <= a < 0x6000 for a in reads), reads
                return
            await ctx.tick()
            ctx.set(core.imem_valid, 0)
            ctx.set(core.dmem_rd_valid, request)
            ctx.set(core.dmem_rd_data, memory.get(address, 0))
        pytest.fail(("runtime CALL did not reach method boundary", method, reads))
    run_core(bench)
