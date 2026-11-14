import struct
import pytest
from amaranth import Module
from amaranth.sim import Simulator
from candidate_test_support import module
from test_candidate_qualified_delivery import records

BASE = module("candidate_service").BASE


@pytest.mark.parametrize("interruption", [False, True])
def test_native_bus_request_copy_commit_and_origin_guard(interruption):
    m = Module()
    m.submodules.memory = mem = module("candidate_memory").CandidateMemory()
    m.submodules.delivery = d = module("candidate_qualified_delivery").QualifiedDelivery(
        mem, records(), clock_hz=1000)
    m.submodules.service = svc = module("candidate_service").CandidateService(d)
    p, rx = svc.bus, d.receiver
    m.d.comb += [d.enabled.eq(svc.enabled), d.epoch.eq(7),
                 rx.tx_ack.eq(rx.tx_req)]
    sim = Simulator(m)
    sim.add_clock(1e-6)

    async def bench(ctx):
        ctx.set(svc.enabled, 1)
        ctx.set(svc.namespace, 0xabc)
        ctx.set(svc.thread, 0x02050002)
        await ctx.tick().repeat(3)

        async def write(offset, value, error=False):
            ctx.set(p.address, BASE + offset * 4)
            ctx.set(p.wdata, value)
            ctx.set(p.write, 1)
            assert ctx.get(p.ready)
            assert bool(ctx.get(p.error)) == error
            await ctx.tick()
            ctx.set(p.write, 0)

        async def read(offset, error=False):
            ctx.set(p.address, BASE + offset * 4)
            ctx.set(p.read, 1)
            assert bool(ctx.get(p.error)) == error
            await ctx.tick()
            ctx.set(p.read, 0)
            assert ctx.get(p.rvalid)
            return ctx.get(p.rdata)

        await read(0, error=True)
        await write(5, 1, error=True)  # incomplete handoff
        r = records()[0]
        values = [(r["namespace"] >> (32*i)) & 0xffffffff for i in range(3)]
        values += [0x02070004, r["target"]]
        await write(7, values[0])
        ctx.set(svc.namespace, 0xdef)
        await write(8, values[1], error=True)
        ctx.set(svc.namespace, 0xabc)
        for i in range(1, 5):
            await write(7+i, values[i])
        await write(5, 1)
        await ctx.tick().repeat(25)
        assert ctx.get(d.owner.active)
        assert ctx.get(d.owner.owner_namespace) == r["namespace"]
        await write(7, 0, error=True)
        if interruption:
            ctx.set(svc.enabled, 0)
            await ctx.tick().repeat(3)
            ctx.set(svc.enabled, 1)
            await ctx.tick()
            await write(5, 1, error=True)
            assert not ctx.get(d.owner.active)
            return
        txn = await read(3)
        raw = struct.pack("<64I", *r["words"])
        async def send(data):
            for b in data:
                ctx.set(rx.byte, b)
                ctx.set(rx.valid, 1)
                await ctx.tick()
                ctx.set(rx.valid, 0)
                await ctx.tick().repeat(2)
        def command(op, length=0):
            return b"CLQ1" + struct.pack(">BBHIII", op, 3, 0, 7, txn, length)
        await send(command(1, len(raw)))
        await send(raw)
        await send(command(2))
        for _ in range(1500):
            if ctx.get(rx.state) == rx.READY:
                break
            await ctx.tick()
        assert await read(1) == rx.READY
        assert await read(2) == r["target"]
        assert await read(4) == 64
        assert await read(6) == r["words"][0]
        await write(3, txn, error=True)  # body not consumed
        for word in r["words"]:
            assert await read(0) == word
            await ctx.tick()
        await read(0, error=True)
        await write(3, txn+1, error=True)
        await write(3, txn)
        await ctx.tick().repeat(2)
        assert not ctx.get(d.owner.active)

    sim.add_testbench(bench)
    sim.run()
