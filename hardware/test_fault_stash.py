import pytest
from amaranth.sim import Simulator
from .fault_stash import FaultStash


@pytest.mark.parametrize("failure", [None, "grant", "response", "mismatch", "unsafe"])
@pytest.mark.parametrize("word", [0, 4, 30])
def test_direct_stash(failure, word):
    dut = FaultStash(thread_base=1024, thread_words=256, handler_gt=0x4a070004)
    sim = Simulator(dut)
    sim.add_clock(1e-6)

    async def bench(ctx):
        memory, writes = {}, []
        ctx.set(dut.thread_gt, 0x02030002)
        ctx.set(dut.namespace_gt, 0x02040001)
        ctx.set(dut.fault_code, 7)
        ctx.set(dut.fault_address, 0x8124)
        ctx.set(dut.fault_instruction, 0xf7000000)
        ctx.set(dut.safe, 1)
        ctx.set(dut.start, 1)
        await ctx.tick()
        ctx.set(dut.start, 0)
        next_read = None
        for _ in range(110):
            ctx.set(dut.read_valid, next_read is not None)
            if next_read is not None:
                ctx.set(dut.read_data, next_read)
            next_read = None
            if ctx.get(dut.write_en):
                index = len(writes)
                if failure == "unsafe" and index == word:
                    ctx.set(dut.safe, 0)
                granted = not (failure == "grant" and index == word)
                ctx.set(dut.write_granted, granted)
                if ctx.get(dut.write_en) and granted:
                    addr, value = ctx.get(dut.address), ctx.get(dut.write_data)
                    memory[addr] = value
                    writes.append((addr, value))
            if ctx.get(dut.read_en):
                index = len(writes) - 1
                if not (failure == "response" and index == word):
                    next_read = memory[ctx.get(dut.address)]
                    if failure == "mismatch" and index == word:
                        next_read ^= 1
            if ctx.get(dut.done) or ctx.get(dut.catastrophic):
                break
            await ctx.tick()
        assert ctx.get(dut.catastrophic) == bool(failure)
        assert ctx.get(dut.done) == (failure is None)
        if failure is None:
            caps = 244
            expected = [(caps + 1, 0x02030002), (caps + 2, 0x02040001),
                        (2, 7), (3, 0x8124), (5, 0xf7000000),
                        (1, 0), (4, 0), (6, 0)]
            expected += [(n + 1, 0) for n in range(6, 16)]
            expected += [(caps, 0x4a070004)]
            expected += [(caps + n, 0) for n in range(3, 12)]
            expected += [(caps - 2, 0x4a070004),
                         (caps - 1, (caps - 1) | 0x1000 | (0x7fff << 13)),
                         (17, (caps - 3) | 0x1000)]
            assert writes == [(1024 + offset * 4, value) for offset, value in expected]
        # Terminal means no retries, even when the external condition clears.
        ctx.set(dut.safe, 1)
        ctx.set(dut.write_granted, 1)
        ctx.set(dut.start, 1)
        for _ in range(5):
            await ctx.tick()
            assert not ctx.get(dut.write_en)
            assert not ctx.get(dut.read_en)
    sim.add_testbench(bench)
    sim.run()


@pytest.mark.parametrize("base,size,gt", [
    (1, 256, 0x4a000004), (65536, 256, 0x4a000004),
    (65024, 256, 0x4a000004), (0, 255, 0x4a000004),
    (0, 256, 0x02000004), (0, 256, 0x4a000000),
])
def test_configuration_rejects_alias_or_wrong_gt(base, size, gt):
    with pytest.raises(ValueError):
        FaultStash(thread_base=base, thread_words=size, handler_gt=gt)
