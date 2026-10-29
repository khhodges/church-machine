"""Packet ownership tests; no serial device or external service is used."""
import pytest
from amaranth import Module
from amaranth.lib.fifo import SyncFIFOBuffered
from amaranth.sim import Simulator
from hardware.uart_packet_arbiter import UartPacketArbiter


@pytest.mark.parametrize("low,length", [(1, 8), (2, 4), (3, 1), (4, 6), (5, 292), (6, 12)])
@pytest.mark.parametrize("arrival", [0, 1, 3, 5, 11])
def test_higher_priority_waits_for_packet_boundary(low, length, arrival):
    arb = UartPacketArbiter(7)
    observed = []

    async def bench(ctx):
        ctx.set(arb.ready, 1)
        ctx.set(arb.req[low], 1)
        pos = 0
        urgent = False
        sent_urgent = False
        for cycle in range(length * 3 + 20):
            if pos >= min(arrival, length - 1) and not sent_urgent:
                urgent = True
            ready = cycle % 3 != 1  # exercise the UART busy/DONE gap
            ctx.set(arb.ready, ready)
            ctx.set(arb.req[0], urgent)
            ctx.set(arb.data[0], 0xFE)
            ctx.set(arb.last[0], 1)
            ctx.set(arb.req[low], pos < length)
            ctx.set(arb.data[low], pos & 0x7F)
            ctx.set(arb.last[low], pos == length - 1)
            await ctx.delay(1e-9)
            grants = [ctx.get(ack) for ack in arb.ack]
            assert sum(grants) <= 1
            if not ready:
                assert not any(grants)
            if grants[0]:
                observed.append(0xFE)
                urgent = False
                sent_urgent = True
            if grants[low]:
                observed.append(ctx.get(arb.tx_data))
                pos += 1
            await ctx.tick()
            if pos == length and sent_urgent:
                break
        expected = [i & 0x7F for i in range(length)]
        assert observed in ([0xFE] + expected, expected + [0xFE])

    sim = Simulator(arb)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()


def test_owner_survives_producer_pause_without_false_ack():
    arb = UartPacketArbiter(7)

    async def bench(ctx):
        ctx.set(arb.ready, 1)
        ctx.set(arb.req[6], 1)
        ctx.set(arb.last[6], 0)
        await ctx.tick()
        assert ctx.get(arb.owner) == 7
        ctx.set(arb.req[6], 0)
        ctx.set(arb.req[0], 1)
        ctx.set(arb.last[0], 1)
        for _ in range(4):
            await ctx.tick()
            assert not ctx.get(arb.tx_start)
            assert not ctx.get(arb.ack[0])
        ctx.set(arb.req[6], 1)
        ctx.set(arb.last[6], 1)
        await ctx.tick()
        assert ctx.get(arb.owner) == 0
        assert ctx.get(arb.ack[0])

    sim = Simulator(arb)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()


def test_console_write_pulses_are_retained_until_trace_finishes():
    """The console producer must buffer CPU writes, not just suppress them."""
    m = Module()
    arb = m.submodules.arb = UartPacketArbiter(7)
    fifo = m.submodules.fifo = SyncFIFOBuffered(width=8, depth=4)
    m.d.comb += [
        arb.req[0].eq(fifo.r_rdy), arb.data[0].eq(fifo.r_data),
        arb.last[0].eq(1), fifo.r_en.eq(arb.ack[0]),
    ]
    observed = []

    async def bench(ctx):
        ctx.set(arb.ready, 1)
        position = 0
        for cycle in range(40):
            ctx.set(arb.req[6], position < 12)
            ctx.set(arb.data[6], position)
            ctx.set(arb.last[6], position == 11)
            writing = 1 <= cycle <= 3
            ctx.set(fifo.w_en, writing)
            ctx.set(fifo.w_data, 0x40 + cycle)
            if writing:
                assert ctx.get(fifo.w_rdy)
            await ctx.delay(1e-9)
            if ctx.get(arb.tx_start):
                observed.append(ctx.get(arb.tx_data))
            if ctx.get(arb.ack[6]):
                position += 1
            await ctx.tick()
        assert observed == list(range(12)) + [0x41, 0x42, 0x43]

    sim = Simulator(m)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()
