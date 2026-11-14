import struct
import pytest
from amaranth import Module
from amaranth.back import rtlil
from amaranth.sim import Simulator
from candidate_test_support import module
from test_candidate_delivery import record

Memory = module("candidate_memory").CandidateMemory
Delivery = module("candidate_qualified_delivery").QualifiedDelivery


def records():
    return [dict(record(0x12000), namespace=0x1000002000001, target=0x4a03000a),
            dict(record(0x18000), namespace=0x1800002000001, target=0x4a03000a)]


@pytest.mark.parametrize("cancel", ["fault", "disable", "epoch", "complete"])
def test_qualified_delivery_real_staging_and_stale_response(cancel):
    rs = records()
    m = Module()
    m.submodules.memory = mem = Memory(init=[0xa55aa55a] * 32768)
    m.submodules.delivery = d = Delivery(mem, rs, clock_hz=1000)
    rx, o = d.receiver, d.owner
    m.d.comb += [mem.cpu_enabled.eq(1), rx.tx_ack.eq(rx.tx_req)]
    # Detect structural loops as well as simulated behavior.
    rtlil.convert(m, ports=[])
    sim = Simulator(m)
    sim.add_clock(1e-6)

    async def bench(ctx):
        ctx.set(d.enabled, 1)
        ctx.set(d.epoch, 7)
        await ctx.tick().repeat(3)

        async def request(which):
            ctx.set(d.request_namespace, rs[which]["namespace"])
            ctx.set(d.request_thread, 0x02070004)
            ctx.set(d.request_target, rs[which]["target"])
            ctx.set(d.request, 1)
            assert ctx.get(d.accepted)
            await ctx.tick()
            ctx.set(d.request, 0)
            await ctx.tick().repeat(2)
            packet = []
            while ctx.get(rx.tx_req):
                packet.append(ctx.get(rx.tx_byte))
                await ctx.tick()
            # First byte was consumed on the last tick above.
            assert bytes(packet) == (b"CRQ1" + struct.pack(
                ">III", which + 3, ctx.get(d.epoch), ctx.get(o.transaction)))[1:]
            assert ctx.get(rx.state) == rx.WAITING

        async def send(data):
            for b in data:
                ctx.set(rx.byte, b)
                ctx.set(rx.valid, 1)
                await ctx.tick()
                ctx.set(rx.valid, 0)
                await ctx.tick().repeat(2)

        def command(op, selector, epoch, txn, length=0):
            return b"CLQ1" + struct.pack(">BBHIII", op, selector, 0, epoch, txn, length)

        await request(0)
        first = ctx.get(o.transaction)
        ctx.set(d.request_namespace, rs[1]["namespace"])
        ctx.set(d.request, 1)
        assert ctx.get(d.rejected)
        await ctx.tick()
        ctx.set(d.request, 0)
        assert ctx.get(o.owner_namespace) == rs[0]["namespace"]
        ctx.set(d.fault, 1)
        ctx.set(d.fault_namespace, rs[1]["namespace"])
        ctx.set(d.fault_thread, 0x02070004)
        await ctx.tick()
        assert ctx.get(o.active)
        ctx.set(d.fault, 0)
        raw = struct.pack("<64I", *rs[0]["words"])
        await send(command(1, 3, 7, first, len(raw)))
        await send(raw)
        await send(command(2, 3, 7, first))
        for _ in range(1500):
            if ctx.get(rx.state) == rx.READY:
                break
            await ctx.tick()
        assert ctx.get(rx.state) == rx.READY
        if cancel == "complete":
            for word in rs[0]["words"]:
                await ctx.tick()
                assert ctx.get(rx.word) == word
                ctx.set(rx.pop, 1)
                await ctx.tick()
                ctx.set(rx.pop, 0)
                await ctx.tick()
            ctx.set(rx.commit_transaction, first)
            ctx.set(rx.commit, 1)
            await ctx.tick()
            ctx.set(rx.commit, 0)
            assert ctx.get(d.completed)
        elif cancel == "fault":
            ctx.set(d.fault, 1)
            ctx.set(d.fault_namespace, rs[0]["namespace"])
        elif cancel == "disable":
            ctx.set(d.enabled, 0)
        else:
            ctx.set(d.epoch, 8)
        await ctx.tick().repeat(3)
        assert not ctx.get(o.active)
        ctx.set(d.fault, 0)
        ctx.set(d.enabled, 1)
        await request(1)
        assert ctx.get(o.transaction) == (1 if cancel == "epoch" else first + 1)
        # Delayed A response cannot supply B, even with identical target slots.
        await send(command(1, 3, 7, first, len(raw)))
        assert ctx.get(rx.state) != rx.RECEIVING
        await ctx.tick().repeat(3)
        assert not ctx.get(o.active)
        for address in (0x12000, 0x18000, 0x2000, 0x8000):
            ctx.set(mem.fetch.address, address)
            ctx.set(mem.fetch.read, 1)
            await ctx.tick()
            assert ctx.get(mem.fetch.rdata) == 0xa55aa55a

    sim.add_testbench(bench)
    sim.run()
