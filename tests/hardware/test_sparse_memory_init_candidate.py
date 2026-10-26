import pytest
from amaranth.sim import Simulator
from hardware.sparse_memory_init_candidate import AddressedSparseMemoryInitializer


@pytest.mark.parametrize("count", [0, 1, 2, 17, 1832])
@pytest.mark.parametrize("pause", [False, True])
def test_candidate_writes_exact_pairs_including_nonzero_address_zero(count, pause):
    pairs = [(0, 0xF8810100)] if count else []
    pairs += [(i * 3, (0x5EB25EE4 ^ i) & 0xffffffff) for i in range(1, count)]
    dut = AddressedSparseMemoryInitializer(pairs)
    sim = Simulator(dut)
    sim.add_clock(40e-9)

    async def bench(ctx):
        for _ in range(20):
            assert not ctx.get(dut.write_en)
            await ctx.tick()
        writes = []
        active_cycles = 0
        for cycle in range(8 * count + 20):
            enabled = not pause or cycle % 7 not in (1, 2, 4)
            ctx.set(dut.enable, enabled)
            writing = ctx.get(dut.write_en)
            if enabled and not ctx.get(dut.done):
                assert writing == (active_cycles % 3 == 2)
                active_cycles += 1
            else:
                assert not writing
            if writing:
                writes.append((ctx.get(dut.write_addr), ctx.get(dut.write_data)))
                assert writes[-1] == pairs[len(writes) - 1]
            await ctx.tick()
            assert bool(ctx.get(dut.done)) == (len(writes) == count)
            if ctx.get(dut.done):
                break
        else:
            pytest.fail("Candidate stalled")
        assert writes == pairs
        ctx.set(dut.enable, 1)
        for _ in range(5):
            assert ctx.get(dut.done) and not ctx.get(dut.write_en)
            await ctx.tick()

    sim.add_testbench(bench)
    sim.run()
