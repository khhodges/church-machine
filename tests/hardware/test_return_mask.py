"""Isolated RTL simulation: accepted RETURN mask through validated cLoad commit."""

import pytest
from amaranth import Elaboratable, Module, Signal, Mux
from amaranth.sim import Simulator

from hardware.cload import ChurchCLoad
from hardware.decoder import ChurchDecoder
from hardware.hw_types import ChurchOpcode, GT_TYPE_INFORM, PERM_MASK_E, PERM_MASK_X, make_gt
from hardware.integrity32 import integrity32
from hardware.registers import ChurchRegisters
from hardware.ret import ChurchReturn
from hardware.call import ChurchCall
from hardware.thread_design import THREAD_STO_OFFSET


ELIGIBLE = (*range(5), *range(7, 12))


def cap(i):
    return (0xB2000000 | i) | ((0x5100 + i * 4) << 32) | ((0xA5000000 | i) << 64)


class ReturnHarness(Elaboratable):
    def __init__(self):
        self.dec = ChurchDecoder()
        self.ret = ChurchReturn()
        self.cload = ChurchCLoad(enable_seal_check=True)
        self.regs = ChurchRegisters()
        self.seed = Signal()
        self.seed_addr = Signal(4)
        self.seed_data = Signal(96)

    def elaborate(self, platform):
        m = Module()
        d, r, c, regs = self.dec, self.ret, self.cload, self.regs
        m.submodules.dec = d
        m.submodules.ret = r
        m.submodules.cload = c
        m.submodules.regs = regs
        pending = Signal()
        m.d.sync += pending.eq(r.complete & ~r.fault_valid)
        m.d.comb += [
            r.return_mask.eq(d.return_mask),
            c.cload_start.eq(pending),
            c.e_gt.eq(r.cload_e_gt),
            c.same_code.eq(r.cload_same_code),
            c.code_location.eq(r.cload_code_location),
            regs.return_mask.eq(r.return_mask_latched),
            regs.return_commit_en.eq(c.cr_wr_en & (c.cr_wr_addr == 6)),
            regs.m_return_commit_en.eq(regs.return_commit_en),
            regs.cr_wr_en.eq(self.seed | c.cr_wr_en),
            regs.cr_wr_addr.eq(Mux(c.cr_wr_en, c.cr_wr_addr, self.seed_addr)),
            regs.cr_wr_data.eq(Mux(c.cr_wr_en, c.cr_wr_data, self.seed_data)),
        ]
        return m


@pytest.mark.parametrize("mask", [0, 0xFFF, 0xA95, 0x060, 0xF9F])
@pytest.mark.parametrize("fault", [None, "frame", "mload", "seal"])
@pytest.mark.parametrize("saved_pc", [3, 10])
def test_return_mask_commit_latch_and_fault_atomicity(mask, fault, saved_pc):
    dut = ReturnHarness()
    r, c, regs = dut.ret, dut.cload, dut.regs
    egt = make_gt(GT_TYPE_INFORM, PERM_MASK_E, slot_id=2)
    memory = {
        0x4000 + THREAD_STO_OFFSET * 4: 241 | (1 << 12),
        0x4000 + 243 * 4: ((0x7FFF if fault == "frame" else saved_pc) << 13) | 243,
        0x4000 + 242 * 4: egt,
        0x8020: 0x6000,
        0x8024: 0,
        0x8028: integrity32(0x6000, 0) ^ int(fault == "seal"),
        0x802C: 0,
        0x6000: (2 << 23) | (32 << 10) | 12,
    }

    def read(ctx, i):
        return sum(ctx.get(regs.debug_cr_words[i][w]) << (32 * w) for w in range(3))

    async def bench(ctx):
        ctx.set(dut.seed, 1)
        for i in range(16):
            ctx.set(dut.seed_addr, i)
            ctx.set(dut.seed_data, cap(i))
            await ctx.tick()
        ctx.set(dut.seed, 0)
        ctx.set(regs.m_bit_device_wr_en, 1)
        ctx.set(regs.m_bit_device_word, 0xFFFF)
        await ctx.tick()
        ctx.set(regs.m_bit_device_wr_en, 0)
        ctx.set(r.cr5_heap.as_value(), cap(5))
        ctx.set(r.cr12_thread.as_value(), cap(12))
        ctx.set(r.thread_base, 0x4000)
        ctx.set(r.thread_hdr, (0x1F << 27) | (2 << 23) | (32 << 10) | (2 << 8) | 12)
        ctx.set(c.cr15_namespace.as_value(), 0x8000 << 32)
        # Upper immediate bits do not participate in the mask.
        ctx.set(dut.dec.instruction, (int(ChurchOpcode.RETURN) << 27) | 0x7000 | mask)
        ctx.set(r.return_start, 1)
        await ctx.tick()
        ctx.set(r.return_start, 0)
        ctx.set(dut.dec.instruction, (int(ChurchOpcode.RETURN) << 27) | (mask ^ 0xFFF))
        committed = False
        mload_pending = False
        for cycle in range(160):
            assert ctx.get(r.return_mask_latched) == mask
            # Values deliberately change after acceptance: retain means current
            # value, never restore a CALL/RETURN-time snapshot.
            if cycle < 16:
                ctx.set(dut.seed, 1)
                ctx.set(dut.seed_addr, cycle)
                ctx.set(dut.seed_data, cap(cycle) ^ (0x1234 << 64))
            else:
                ctx.set(dut.seed, 0)
            for addr, en, data, valid in [
                (r.mem_rd_addr, r.mem_rd_en, r.mem_rd_data, r.mem_rd_valid),
                (c.mem_addr, c.mem_rd_en, c.mem_rd_data, c.mem_rd_valid),
            ]:
                ctx.set(valid, ctx.get(en))
                ctx.set(data, memory.get(ctx.get(addr), 0))
            ctx.set(r.mload_done, mload_pending)
            mload_pending = bool(ctx.get(r.mload_start))
            ctx.set(r.mload_fault, int(fault == "mload"))
            ctx.set(r.mload_fault_type, 1)
            if ctx.get(regs.return_commit_en):
                assert fault is None
                # No eligible descriptor was cleared early.
                for i in ELIGIBLE:
                    assert read(ctx, i) == cap(i) ^ (0x1234 << 64)
                committed = True
            terminal = ctx.get(r.fault_valid) or ctx.get(c.cload_fault) or ctx.get(c.cload_done)
            await ctx.tick()
            if terminal:
                break
        else:
            pytest.fail("RETURN/cLoad did not terminate")
        assert committed == (fault is None)
        for i in ELIGIBLE:
            expected = cap(i) ^ ((0x1234 << 64) if i <= cycle else 0)
            if committed and not (mask & (1 << i)):
                expected = 0
            assert read(ctx, i) == expected
        assert read(ctx, 5) == cap(5) ^ ((0x1234 << 64) if cycle >= 5 else 0)
        if committed:
            assert read(ctx, 6) != cap(6) ^ (0x1234 << 64)
            assert read(ctx, 6) & 0xFFFFFFFF == egt
            assert (read(ctx, 6) >> 32) & 0xFFFFFFFF == 0x6000 + (256 - 12) * 4
            assert read(ctx, 15) == cap(15) ^ (0x1234 << 64)
            assert ctx.get(regs.m_bit_device_state) == 1 << 6
        else:
            assert ctx.get(regs.m_bit_device_state) == 0xFFFF

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()


@pytest.mark.parametrize("write_kind", ["full", "word", "gt", "call_masks"])
def test_return_reset_wins_same_edge_descriptor_write(write_kind):
    regs = ChurchRegisters()

    async def bench(ctx):
        ctx.set(regs.cr_wr_en, 1)
        ctx.set(regs.cr_wr_addr, 7)
        ctx.set(regs.cr_wr_data.as_value(), cap(7))
        await ctx.tick()
        ctx.set(regs.cr_wr_en, write_kind == "full")
        ctx.set(regs.cr_word_wr_en, write_kind == "word")
        ctx.set(regs.cr_word_wr_addr, 7)
        ctx.set(regs.cr_word_wr_data, 0xFFFFFFFF)
        ctx.set(regs.cr_gt_wr_en[7], write_kind == "gt")
        ctx.set(regs.cr_gt_wr_data[7].as_value(), 0xFFFFFFFF)
        ctx.set(regs.cr_b_clear_mask, (1 << 7) if write_kind == "call_masks" else 0)
        ctx.set(regs.return_commit_en, 1)
        await ctx.tick()
        assert all(ctx.get(word) == 0 for word in regs.debug_cr_words[7])

    sim = Simulator(regs)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()


@pytest.mark.parametrize("mask", [0, 0xFFF])
def test_call_cleanup_never_touches_cr5(mask):
    call = ChurchCall()

    async def bench(ctx):
        ctx.set(call.mask, mask)
        ctx.set(call.cr_rd_data.as_value(), make_gt(GT_TYPE_INFORM, PERM_MASK_E, slot_id=2))
        ctx.set(call.call_start, 1)
        await ctx.tick()
        ctx.set(call.call_start, 0)
        for _ in range(100):
            ctx.set(call.mload_done, 1)
            ctx.set(call.mem_rd_valid, 1)
            ctx.set(call.mem_rd_data, (2 << 23) | (32 << 10) | 12)
            null = ctx.get(call.cr_null_mask)
            b_clear = ctx.get(call.cr_b_clear_mask)
            assert not ((null | b_clear) & (1 << 5))
            if null | b_clear:
                assert (null | b_clear) == 0xFDF
                return
            await ctx.tick()
        pytest.fail("CALL did not reach cleanup")

    sim = Simulator(call)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()


@pytest.mark.parametrize("mask", [0, 0xFFF, 0xA95, 0x060])
@pytest.mark.parametrize("fault", [None, "invalid_x", "location", "seal"])
def test_lambda_return_rebuilds_cr6_from_code_identity(mask, fault):
    dut = ReturnHarness()
    r, c, regs = dut.ret, dut.cload, dut.regs
    xgt = make_gt(GT_TYPE_INFORM, PERM_MASK_X, slot_id=2)
    code = xgt | (0x6004 << 32) | (31 << 64)
    memory = {
        0x8020: 0x6000,
        0x8024: 0,
        0x8028: integrity32(0x6000, 0) ^ int(fault == "seal"),
        0x802C: 0,
        0x6000: (2 << 23) | (32 << 10) | 12,
    }

    def read(ctx, i):
        return sum(ctx.get(regs.debug_cr_words[i][w]) << (32 * w) for w in range(3))

    async def bench(ctx):
        ctx.set(dut.seed, 1)
        for i in range(16):
            ctx.set(dut.seed_addr, i)
            ctx.set(dut.seed_data, code if i == 14 else cap(i))
            await ctx.tick()
        ctx.set(dut.seed, 0)
        ctx.set(regs.m_bit_device_wr_en, 1)
        ctx.set(regs.m_bit_device_word, 0xFFFF)
        await ctx.tick()
        ctx.set(regs.m_bit_device_wr_en, 0)
        ctx.set(r.lambda_active, 1)
        ctx.set(r.lambda_pc, 0x6010)
        ctx.set(r.cr14_code.as_value(),
                0 if fault == "invalid_x" else code ^ ((4 << 32) if fault == "location" else 0))
        ctx.set(c.cr15_namespace.as_value(), 0x8000 << 32)
        ctx.set(dut.dec.instruction, (int(ChurchOpcode.RETURN) << 27) | mask)
        ctx.set(r.return_start, 1)
        await ctx.tick()
        ctx.set(r.return_start, 0)
        # Changing live operands does not change the accepted identity or mask.
        ctx.set(r.cr14_code.as_value(), 0)
        ctx.set(dut.dec.instruction, 0xFFF ^ mask)
        committed = False
        for _ in range(100):
            assert not ctx.get(r.mem_rd_en)  # no invented frame/snapshot reads
            assert not ctx.get(r.mem_wr_en)
            ctx.set(c.mem_rd_valid, ctx.get(c.mem_rd_en))
            ctx.set(c.mem_rd_data, memory.get(ctx.get(c.mem_addr), 0))
            if ctx.get(regs.return_commit_en):
                committed = True
                for i in ELIGIBLE:
                    assert read(ctx, i) == cap(i)
            terminal = ctx.get(r.fault_valid) or ctx.get(c.cload_fault) or ctx.get(c.cload_done)
            await ctx.tick()
            if terminal:
                break
        else:
            pytest.fail("lambda RETURN did not terminate")
        assert committed == (fault is None)
        for i in ELIGIBLE:
            assert read(ctx, i) == (cap(i) if fault or (mask & (1 << i)) else 0)
        assert read(ctx, 5) == cap(5)
        assert read(ctx, 14) == code
        assert read(ctx, 15) == cap(15)
        if committed:
            expected = make_gt(GT_TYPE_INFORM, PERM_MASK_E, slot_id=2)
            expected |= (0x6000 + (256 - 12) * 4) << 32
            expected |= 11 << 64
            assert read(ctx, 6) == expected
            # Descriptor CR5 is untouched, but CR5.M follows the existing
            # separate RETURN security boundary and is cleared.
            assert ctx.get(regs.m_bit_device_state) == 1 << 6
        else:
            assert read(ctx, 6) == cap(6)
            assert ctx.get(regs.m_bit_device_state) == 0xFFFF

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()