"""Local CLA1 negative/positive tests with real staging RAM and SHA."""
import hashlib
import struct

import pytest
from amaranth import Module, unsigned
from amaranth.lib.memory import Memory
from amaranth.sim import Simulator
from hardware.amoeba_receiver import AmoebaReceiver
from hardware.amoeba_protocol import command, BEGIN, FINISH


def records():
    result = []
    for slot, size, base in ((10, 64, 0x8000), (22, 128, 0x8400), (40, 256, 0x8800)):
        words = [0] * size
        words[0] = 0xf8000001 | ((size.bit_length() - 7) << 23) | (3 << 10)
        words[1:4] = [2, 0xaf084009, 0x18000000]
        words[-1] = 0x4a000000 | slot
        result.append(dict(slot=slot, sizeWords=size, baseByte=base, words=words,
            localizedSha256LE=hashlib.sha256(struct.pack("<"+"I"*size, *words)).hexdigest()))
    return result


class Harness:
    def __init__(self):
        self.rx = rx = AmoebaReceiver(records(), clock_hz=100, staging_words=256)
        self.m = m = Module()
        m.submodules.rx = rx
        ram = m.submodules.ram = Memory(shape=unsigned(32), depth=256, init=[])
        rd, wr = ram.read_port(), ram.write_port()
        m.d.comb += [rd.addr.eq(rx.read_address), rx.read_data.eq(rd.data),
                     wr.addr.eq(rx.memory_address), wr.data.eq(rx.memory_data),
                     wr.en.eq(rx.memory_write & rx.memory_ready), rx.tx_ack.eq(rx.tx_req)]

    def run(self, bench):
        sim = Simulator(self.m)
        sim.add_clock(1e-6)
        async def start(ctx):
            ctx.set(self.rx.epoch, 7)
            ctx.set(self.rx.running, 1)
            ctx.set(self.rx.memory_ready, 1)
            await ctx.tick().repeat(3)
            await bench(ctx, self.rx)
        sim.add_testbench(start)
        sim.run()

    async def request(self, ctx, slot):
        ctx.set(self.rx.request_slot, slot)
        ctx.set(self.rx.request, 1)
        await ctx.tick()
        ctx.set(self.rx.request, 0)
        await ctx.tick().repeat(20)

    async def send(self, ctx, raw):
        for b in raw:
            ctx.set(self.rx.valid, 1)
            ctx.set(self.rx.byte, b)
            await ctx.tick()
            ctx.set(self.rx.valid, 0)
            await ctx.tick().repeat(2)

    async def deliver(self, ctx, r, *, corrupt=False):
        txn = ctx.get(self.rx.transaction)
        raw = bytearray(struct.pack("<"+"I"*r["sizeWords"], *r["words"]))
        if corrupt:
            raw[8] ^= 1
        await self.send(ctx, command(BEGIN, r["slot"], 7, txn, len(raw)))
        await self.send(ctx, raw)
        assert ctx.get(self.rx.state) == self.rx.SEALED
        await self.send(ctx, command(FINISH, r["slot"], 7, txn))
        await ctx.tick().repeat(3000)


def test_arbitrary_selected_slots_sizes_and_order():
    h = Harness()
    async def bench(ctx, rx):
        for r in reversed(records()):
            await h.request(ctx, r["slot"])
            assert ctx.get(rx.state) == rx.WAITING
            # Unavailability does not expire the request.
            await ctx.tick().repeat(400)
            assert ctx.get(rx.state) == rx.WAITING
            await h.deliver(ctx, r)
            assert ctx.get(rx.state) == rx.READY
            # UART cannot corrupt or revoke the validated snapshot mid-copy.
            ctx.set(rx.error, 1)
            await ctx.tick()
            ctx.set(rx.error, 0)
            for expected in r["words"]:
                await ctx.tick().repeat(2)
                assert ctx.get(rx.word) == expected
                ctx.set(rx.pop, 1)
                await ctx.tick()
                ctx.set(rx.pop, 0)
            ctx.set(rx.commit_transaction, ctx.get(rx.transaction))
            ctx.set(rx.commit, 1)
            await ctx.tick()
            ctx.set(rx.commit, 0)
            assert ctx.get(rx.state) == rx.CONSUMED
    h.run(bench)


@pytest.mark.parametrize("failure", ["corruption", "wrong-slot", "stale-epoch",
    "stale-transaction", "oversize", "unsolicited", "unknown-request", "truncation",
    "uart-error", "early-commit", "wrong-commit", "reset", "backpressure"])
def test_invalid_delivery_does_not_publish(failure):
    h = Harness()
    async def bench(ctx, rx):
        r = records()[0]
        if failure == "unsolicited":
            await h.send(ctx, command(BEGIN, r["slot"], 7, 0, 256))
        else:
            await h.request(ctx, 63 if failure == "unknown-request" else r["slot"])
            if failure == "corruption":
                await h.deliver(ctx, r, corrupt=True)
            elif failure in ("wrong-slot", "stale-epoch", "stale-transaction", "oversize"):
                await h.send(ctx, command(BEGIN, 22 if failure == "wrong-slot" else 10,
                    6 if failure == "stale-epoch" else 7,
                    0 if failure == "stale-transaction" else 1,
                    1024 if failure == "oversize" else 256))
            elif failure in ("early-commit", "wrong-commit"):
                await h.deliver(ctx, r)
                if failure == "wrong-commit":
                    ctx.set(rx.pop, 1)
                    await ctx.tick().repeat(r["sizeWords"])
                    ctx.set(rx.pop, 0)
                ctx.set(rx.commit_transaction, 0 if failure == "wrong-commit" else 1)
                ctx.set(rx.commit, 1)
                await ctx.tick()
                ctx.set(rx.commit, 0)
            elif failure == "reset":
                await h.deliver(ctx, r)
                ctx.set(rx.epoch, 8)
                await ctx.tick().repeat(2)
                assert ctx.get(rx.state) == rx.EMPTY
                assert ctx.get(rx.word) == 0
                return
            elif failure != "unknown-request":
                await h.send(ctx, command(BEGIN, 10, 7, 1, 256))
                if failure == "uart-error":
                    ctx.set(rx.error, 1)
                    await ctx.tick()
                elif failure == "backpressure":
                    ctx.set(rx.memory_ready, 0)
                    await h.send(ctx, bytes(12))
                else:
                    await h.send(ctx, bytes(7))
                    await ctx.tick().repeat(205)
        assert ctx.get(rx.state) == rx.FAILED
        assert ctx.get(rx.word) == 0
        assert not ctx.get(rx.memory_write)
    h.run(bench)
