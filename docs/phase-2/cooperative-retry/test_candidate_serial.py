"""Byte-level routing and cancellation; not physical UART timing evidence."""
from types import SimpleNamespace
from amaranth import Signal
from amaranth.sim import Simulator
from candidate_test_support import module


def endpoint():
    return SimpleNamespace(**{k: Signal(8 if k in ("byte", "tx_byte") else 1)
        for k in ("maintenance", "valid", "error", "byte", "tx_req",
                  "tx_byte", "tx_last", "tx_ack")})


def test_cancelled_runtime_packet_does_not_lock_out_installation():
    tr, rx = endpoint(), endpoint()
    d = SimpleNamespace(receiver=rx, enabled=Signal())
    route = module("candidate_serial").CandidateSerial(tr, d)
    sim = Simulator(route)
    sim.add_clock(1e-6)

    async def bench(ctx):
        ctx.set(route.valid, 1)
        ctx.set(route.error, 1)
        ctx.set(route.byte, 0xab)
        ctx.set(d.enabled, 1)
        assert ctx.get(rx.valid) and ctx.get(rx.error)
        assert not ctx.get(tr.valid)
        ctx.set(route.ready, 1)
        ctx.set(rx.tx_req, 1)
        ctx.set(rx.tx_byte, 0x43)
        await ctx.tick()
        assert ctx.get(rx.tx_ack)
        # Installer wants to reply but must not interleave an active packet.
        ctx.set(tr.tx_req, 1)
        ctx.set(tr.tx_byte, 0x99)
        assert not ctx.get(tr.tx_ack)
        ctx.set(route.maintenance, 1)
        assert ctx.get(tr.valid) and ctx.get(tr.error)
        assert not ctx.get(rx.valid) and not ctx.get(rx.error)
        assert not ctx.get(rx.tx_ack)
        await ctx.tick().repeat(2)
        assert ctx.get(tr.tx_ack) and ctx.get(route.tx_data) == 0x99
        ctx.set(tr.tx_last, 1)
        await ctx.tick()
        ctx.set(tr.tx_req, 0)
        ctx.set(route.maintenance, 0)
        ctx.set(d.enabled, 0)
        assert not ctx.get(rx.valid) and not ctx.get(rx.tx_ack)

    sim.add_testbench(bench)
    sim.run()
