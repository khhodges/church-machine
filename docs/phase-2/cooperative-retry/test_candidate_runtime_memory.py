"""Real CSI3 installation followed by qualified runtime delivery on shared RAM."""
import struct
from amaranth import Module
from amaranth.back import rtlil
from amaranth.sim import Simulator
from candidate_test_support import module
from test_candidate_admission import load, send, header
from test_candidate_qualified_delivery import records


def test_install_runtime_hash_and_maintenance_cancellation():
    m = Module()
    m.submodules.admission = a = module("candidate_admission").CandidateAdmission(clock_hz=1000)
    m.submodules.delivery = d = module("candidate_qualified_delivery").QualifiedDelivery(
        a.runtime_memory, records(), clock_hz=1000)
    rx, o, mem = d.receiver, d.owner, a.memory
    m.d.comb += [d.enabled.eq(a.runtime_allowed), d.epoch.eq(a.admitted_epoch),
                 rx.tx_ack.eq(rx.tx_req)]
    rtlil.convert(m, ports=[])
    sim = Simulator(m)
    sim.add_clock(1e-6)

    async def bench(ctx):
        r = records()[0]
        ctx.set(d.request_namespace, r["namespace"])
        ctx.set(d.request_thread, 0x02070004)
        ctx.set(d.request_target, r["target"])
        ctx.set(d.request, 1)
        assert not ctx.get(d.accepted)
        ctx.set(a.transport.maintenance, 1)
        epoch = await load(ctx, a, bytes(131072))
        assert not ctx.get(o.active)
        await send(ctx, a.transport, header(3, epoch))
        assert not ctx.get(a.runtime_allowed), "maintenance must exclude delivery after START"
        ctx.set(a.transport.maintenance, 0)
        await ctx.tick().repeat(3)
        ctx.set(d.request, 0)
        assert ctx.get(o.active)
        assert ctx.get(rx.state) == rx.WAITING
        txn = ctx.get(o.transaction)
        await ctx.tick().repeat(20)

        async def serial(data):
            for b in data:
                ctx.set(rx.byte, b)
                ctx.set(rx.valid, 1)
                await ctx.tick()
                ctx.set(rx.valid, 0)
                await ctx.tick().repeat(2)

        def command(op, length=0):
            return b"CLQ1" + struct.pack(">BBHIII", op, 3, 0, epoch, txn, length)

        # Probe requests must neither steal hash reads nor receive their replies.
        ctx.set(a.probe.address, 0x10000)
        ctx.set(a.probe.read, 1)
        assert not ctx.get(a.probe.ready)
        raw = struct.pack("<64I", *r["words"])
        await serial(command(1, len(raw)))
        await serial(raw)
        await serial(command(2))
        for _ in range(1500):
            assert not ctx.get(a.probe.ready)
            assert not ctx.get(a.probe.rvalid)
            if ctx.get(rx.state) == rx.READY:
                break
            await ctx.tick()
        assert ctx.get(rx.state) == rx.READY
        await ctx.tick()
        assert ctx.get(rx.word) == r["words"][0]
        # Cancels on maintenance entry, before any new installer packet.
        ctx.set(a.transport.maintenance, 1)
        assert not ctx.get(a.runtime_allowed)
        assert not ctx.get(mem.receiver_enabled)
        assert not ctx.get(a.runtime_memory.inspect.rvalid)
        await ctx.tick().repeat(3)
        assert not ctx.get(o.active)
        assert ctx.get(a.probe.ready) and ctx.get(a.probe.rvalid)
        assert ctx.get(a.probe.rdata) == 0
        ctx.set(a.probe.read, 0)
        ctx.set(a.transport.maintenance, 0)
        ctx.set(d.request, 1)
        await ctx.tick()
        ctx.set(d.request, 0)
        await ctx.tick().repeat(3)
        assert ctx.get(o.transaction) == txn + 1
        assert ctx.get(rx.state) == rx.WAITING
        ctx.set(a.transport.maintenance, 1)
        await send(ctx, a.transport, header(1, epoch, 131072))
        assert ctx.get(a.control.execution_reset)
        assert ctx.get(a.control.state) == a.control.LOADING
        assert not ctx.get(o.active)
        assert not ctx.get(mem.receiver_enabled)

    sim.add_testbench(bench)
    sim.run()
