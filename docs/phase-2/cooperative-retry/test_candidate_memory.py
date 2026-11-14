"""Real banked RAM checks, not a core/ISA or physical qualification."""
from amaranth.sim import Simulator
import pytest
from candidate_test_support import module

memory = module("candidate_memory")


def run(bench):
    dut = memory.CandidateMemory()
    sim = Simulator(dut)
    sim.add_clock(1e-6)
    async def wrapped(ctx):
        await bench(ctx, dut)
    sim.add_testbench(wrapped)
    sim.run()


async def write(ctx, port, address, value, error=False):
    ctx.set(port.address, address)
    ctx.set(port.wdata, value)
    ctx.set(port.write, 1)
    assert ctx.get(port.ready)
    assert bool(ctx.get(port.error)) == error
    await ctx.tick()
    ctx.set(port.write, 0)


async def read(ctx, port, address, value=0, error=False):
    ctx.set(port.address, address)
    ctx.set(port.read, 1)
    assert ctx.get(port.ready)
    await ctx.tick()
    ctx.set(port.read, 0)
    assert ctx.get(port.rvalid)
    assert bool(ctx.get(port.rerror)) == error
    assert ctx.get(port.rdata) == (0 if error else value)


def test_banked_boundaries_and_full_observation_address():
    async def bench(ctx, d):
        ctx.set(d.maintenance, 1)
        addresses = [0, 4, 0xfffc, 0x10000, 0x10004, 0x1fffc]
        for i, a in enumerate(addresses):
            ctx.set(d.image.address, a)
            ctx.set(d.image.write, 1)
            assert ctx.get(d.commit_address) == a
            assert ctx.get(d.commit)
            await write(ctx, d.image, a, 0xabc000+i)
        await write(ctx, d.clear, 0x20000, 0x1234)
        await write(ctx, d.clear, 0x23ffc, 0x5678)
        for i, a in enumerate(addresses):
            await read(ctx, d.inspect, a, 0xabc000+i)
        await read(ctx, d.inspect, 0x20000, 0x1234)
        await read(ctx, d.inspect, 0x23ffc, 0x5678)
        ctx.set(d.maintenance, 0)
        ctx.set(d.cpu_enabled, 1)
        for p in (d.ns, d.clist, d.data, d.fetch):
            for i, a in enumerate(addresses):
                await read(ctx, p, a, 0xabc000+i)
    run(bench)


@pytest.mark.parametrize("name", ["ns", "clist", "data", "fetch", "inspect"])
def test_invalid_read_cannot_alias_ram_or_mmio(name):
    async def bench(ctx, d):
        ctx.set(d.maintenance, 1)
        await write(ctx, d.image, 0, 0xfeedface)
        ctx.set(d.maintenance, 0)
        ctx.set(d.cpu_enabled, 1)
        p = getattr(d, name)
        invalid = [1, 0x24000, 0x40000, 0x40000100, 0xfffffffc]
        if name != "inspect":
            invalid += [0x20000, 0x23ffc]
        for a in invalid:
            await read(ctx, p, a, error=True)
        await read(ctx, p, 0, 0xfeedface)
    run(bench)


@pytest.mark.parametrize("name", ["ns", "clist", "data", "image", "clear", "receive"])
def test_invalid_writes_have_no_commit_and_cannot_cross_regions(name):
    async def bench(ctx, d):
        ctx.set(d.maintenance, 1)
        await write(ctx, d.image, 0, 111)
        await write(ctx, d.clear, 0x20000, 222)
        ctx.set(d.maintenance, name in ("image", "clear"))
        ctx.set(d.cpu_enabled, 1)
        ctx.set(d.receiver_enabled, 1)
        p = getattr(d, name)
        other_region = 0 if name in ("clear", "receive") else 0x20000
        for a in (1, other_region, 0x24000, 0x40000, 0x40000100, 0xfffffffc):
            ctx.set(p.address, a)
            ctx.set(p.write, 1)
            assert not ctx.get(d.commit)
            await write(ctx, p, a, 999, error=True)
        await read(ctx, d.inspect, 0, 111)
        await read(ctx, d.inspect, 0x20000, 222)
    run(bench)


def test_arbitration_read_pipeline_and_stopped_cpu():
    async def bench(ctx, d):
        ctx.set(d.maintenance, 1)
        await write(ctx, d.image, 0, 10)
        await write(ctx, d.image, 0x10000, 20)
        ctx.set(d.data.write, 1)
        ctx.set(d.data.wdata, 99)
        ctx.set(d.cpu_enabled, 1)
        assert not ctx.get(d.data.ready)
        assert not ctx.get(d.commit)
        ctx.set(d.data.write, 0)
        ctx.set(d.maintenance, 0)
        # Concurrent physical read channels and consecutive bank selection.
        for a, expected in ((0, 10), (0x10000, 20), (0, 10)):
            for p in (d.ns, d.fetch, d.inspect):
                ctx.set(p.address, a)
                ctx.set(p.read, 1)
            ctx.set(d.clist.read, 1)
            assert not ctx.get(d.clist.ready)
            await ctx.tick()
            for p in (d.ns, d.fetch, d.inspect):
                assert ctx.get(p.rvalid) and ctx.get(p.rdata) == expected
        for p in (d.ns, d.clist, d.fetch, d.inspect):
            ctx.set(p.read, 0)
        ctx.set(d.receiver_enabled, 1)
        ctx.set(d.receive.write, 1)
        ctx.set(d.receive.address, 0x20000)
        ctx.set(d.data.write, 1)
        ctx.set(d.data.address, 0x10000)
        assert ctx.get(d.data.ready) and not ctx.get(d.receive.ready)
        await ctx.tick()
        ctx.set(d.data.write, 0)
        assert ctx.get(d.receive.ready)
        await ctx.tick()
    run(bench)


def test_malformed_operation_and_read_only_ports():
    async def bench(ctx, d):
        ctx.set(d.cpu_enabled, 1)
        for p in (d.data, d.fetch, d.inspect):
            ctx.set(p.read, 1)
            ctx.set(p.write, 1)
            assert ctx.get(p.ready) and ctx.get(p.error)
            assert not ctx.get(d.commit)
            await ctx.tick()
            assert ctx.get(p.rerror)
            ctx.set(p.read, 0)
            ctx.set(p.write, 0)
    run(bench)
