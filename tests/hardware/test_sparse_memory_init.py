"""Regression for the missing first Namespace-limit initialization write."""

import re
import gc
import warnings

import pytest
from amaranth.back import rtlil
from amaranth.sim import Simulator

from hardware.sparse_memory_init import SparseMemoryInitializer


@pytest.mark.parametrize("count", [0, 1, 2, 17, 2693])
@pytest.mark.parametrize("pause", [False, True])
def test_every_pair_written_once_after_fetch(count, pause):
    pairs = [(1, 63)] if count else []
    pairs += [(i + 1, (0xDEAA5EEF + i) & 0xFFFFFFFF)
              for i in range(1, count)]
    dut = SparseMemoryInitializer(pairs)
    sim = Simulator(dut)
    sim.add_clock(1e-6)

    async def bench(ctx):
        for _ in range(3):
            assert ctx.get(dut.write_en) == 0
            await ctx.tick()
        writes = []
        active_cycles = 0
        for cycle in range(6 * count + 12):
            enabled = not pause or cycle % 5 not in (1, 2)
            ctx.set(dut.enable, enabled)
            done_before = ctx.get(dut.done)
            writing = ctx.get(dut.write_en)
            if not enabled or done_before:
                assert not writing
            elif enabled:
                # Alternate fetch and commit, independent of pause duration.
                assert writing == (active_cycles % 2 == 1)
                active_cycles += 1
            if writing:
                writes.append((ctx.get(dut.write_addr), ctx.get(dut.write_data)))
                assert not done_before
            await ctx.tick()
            assert ctx.get(dut.done) == (len(writes) == len(pairs))
            if ctx.get(dut.done):
                break
        else:
            pytest.fail("Initializer did not finish")
        assert writes == pairs
        # Completion is sticky; leaving enable high must not repeat any write.
        ctx.set(dut.enable, 1)
        for _ in range(5):
            assert ctx.get(dut.done)
            assert not ctx.get(dut.write_en)
            await ctx.tick()

    sim.add_testbench(bench)
    sim.run()


def test_rom_read_is_clocked_not_combinatorial():
    dut = SparseMemoryInitializer([(1, 63), (2, 0xDEAA5EEF)])
    text = rtlil.convert(dut, ports=[
        dut.enable, dut.done, dut.write_en, dut.write_addr, dut.write_data])
    readers = re.findall(r"cell \$memrd_v2 .*?\n  end", text, re.S)
    assert len(readers) == 1
    assert re.search(r"parameter \\CLK_ENABLE 1\b", readers[0])


@pytest.mark.parametrize("pair", [(-1, 1), (16384, 1), (0, -1), (0, 1 << 32)])
def test_invalid_pairs_rejected(pair):
    # Amaranth warns about unelaborated objects even when __init__ raises.
    from amaranth.hdl import UnusedElaboratable
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", UnusedElaboratable)
        with pytest.raises(ValueError):
            SparseMemoryInitializer([pair])
        gc.collect()


def test_writes_reach_memory_without_preloaded_contents():
    from amaranth import Elaboratable, Module, unsigned
    from amaranth.lib.memory import Memory

    # Use a real synchronous write port, not preloaded simulation memory.
    pairs = [(1, 63), (2, 0xDEAA5EEF), (16383, 0x87654321)]
    init = SparseMemoryInitializer(pairs)
    memory = Memory(shape=unsigned(32), depth=16384, init=[])

    class Harness(Elaboratable):
        def elaborate(self, platform):
            m = Module()
            m.submodules.initializer = init
            m.submodules.memory = memory
            wr = memory.write_port()
            m.d.comb += [
                init.enable.eq(1),
                wr.en.eq(init.write_en),
                wr.addr.eq(init.write_addr),
                wr.data.eq(init.write_data),
            ]
            return m

    dut = Harness()
    sim = Simulator(dut)
    sim.add_clock(1e-6)

    async def bench(ctx):
        writes = []
        for _ in range(2 * len(pairs) + 2):
            if ctx.get(init.write_en):
                writes.append((ctx.get(init.write_addr), ctx.get(init.write_data)))
            await ctx.tick()
            if ctx.get(init.done):
                break
        else:
            pytest.fail("Initialization did not complete")
        assert writes == pairs
        for addr, data in pairs:
            assert ctx.get(memory.data[addr]) == data
        assert ctx.get(memory.data[0]) == 0
        for _ in range(4):
            assert not ctx.get(init.write_en)
            await ctx.tick()

    sim.add_testbench(bench)
    sim.run()
