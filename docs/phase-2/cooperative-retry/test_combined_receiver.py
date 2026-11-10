"""RTL staging tests with actual SHA reads; no host PASS or core-write grants."""
import copy
import importlib.util
import json
from pathlib import Path
import struct
import subprocess
import sys

import pytest
from amaranth import Module, unsigned
from amaranth.lib.memory import Memory
from amaranth.sim import Simulator

HERE = Path(__file__).resolve().parent

# Load the source under the prepared isolated hardware package. The receiver is
# not yet a default production/starter import or a change to image admission.
def source_module(name):
    fullname = "hardware." + name
    if fullname not in sys.modules:
        spec = importlib.util.spec_from_file_location(fullname, HERE / (name + ".py"))
        module = importlib.util.module_from_spec(spec)
        sys.modules[fullname] = module
        spec.loader.exec_module(module)
    return sys.modules[fullname]


protocol = source_module("combined_protocol")
CombinedReceiver = source_module("combined_receiver").CombinedReceiver


def records():
    result = json.loads(subprocess.check_output(
        ["node", str(HERE / "combined_inputs.js")], text=True))
    return [r for r in result["records"] if r["name"] in ("old", "new")]


class Harness:
    def __init__(self):
        self.records = records()
        self.rx = rx = CombinedReceiver(self.records, clock_hz=20000)
        self.module = m = Module()
        m.submodules.rx = rx
        ram = m.submodules.ram = Memory(shape=unsigned(32), depth=256, init=[])
        rd = ram.read_port()
        wr = ram.write_port()
        m.d.comb += [rd.addr.eq(rx.read_address), rx.read_data.eq(rd.data),
                     wr.addr.eq(rx.memory_address), wr.data.eq(rx.memory_data),
                     wr.en.eq(rx.memory_write & rx.memory_ready)]

    def run(self, bench):
        sim = Simulator(self.module)
        sim.add_clock(1e-6)
        async def run(ctx):
            ctx.set(self.rx.epoch, 7)
            ctx.set(self.rx.running, 1)
            ctx.set(self.rx.memory_ready, 1)
            await ctx.tick().repeat(3)
            await bench(ctx, self.rx)
        sim.add_testbench(run)
        sim.run()

    async def send(self, ctx, data):
        for byte in data:
            ctx.set(self.rx.valid, 1)
            ctx.set(self.rx.byte, byte)
            await ctx.tick()
            ctx.set(self.rx.valid, 0)
            await ctx.tick().repeat(2)

    async def receive(self, ctx, selector, transaction=1, mutation=None):
        r = self.records[selector]
        raw = bytearray(struct.pack("<" + "I" * r["sizeWords"], *r["words"]))
        if mutation:
            mutation(raw)
        await self.send(ctx, protocol.command(protocol.BEGIN, selector, 7, transaction, len(raw)))
        assert ctx.get(self.rx.state) == self.rx.RECEIVING
        await self.send(ctx, raw)
        assert ctx.get(self.rx.state) == self.rx.SEALED
        await self.send(ctx, protocol.command(protocol.FINISH, selector, 7, transaction))
        await ctx.tick().repeat(2200)


def test_two_sizes_hash_actual_received_memory_and_require_complete_consumption():
    h = Harness()
    async def bench(ctx, rx):
        for selector in (0, 1):
            await h.receive(ctx, selector, selector + 1)
            assert ctx.get(rx.state) == rx.READY
            # A UART abort/error during consumption must not replace already
            # validated bytes with zeros while SYSTEM continues its copy loop.
            await h.send(ctx, protocol.command(protocol.ABORT, selector, 7, selector + 1))
            ctx.set(rx.error, 1)
            await ctx.tick()
            ctx.set(rx.error, 0)
            assert ctx.get(rx.state) == rx.READY
            # Duplicate and unauthorized traffic cannot change the sealed bytes.
            await h.send(ctx, protocol.command(protocol.BEGIN, selector, 7, selector + 1, 256))
            assert ctx.get(rx.state) == rx.READY
            ctx.set(rx.commit, 1)
            await ctx.tick()
            ctx.set(rx.commit, 0)
            assert ctx.get(rx.state) == rx.READY
            for word in h.records[selector]["words"]:
                await ctx.tick().repeat(2)
                assert ctx.get(rx.word) == word
                ctx.set(rx.pop, 1)
                await ctx.tick()
                ctx.set(rx.pop, 0)
                ctx.set(rx.error, 1)
                await ctx.tick()
                ctx.set(rx.error, 0)
                assert ctx.get(rx.state) == rx.COPYING
            assert ctx.get(rx.consumed) == h.records[selector]["sizeWords"]
            ctx.set(rx.commit, 1)
            await ctx.tick()
            ctx.set(rx.commit, 0)
            assert ctx.get(rx.state) == rx.CONSUMED
    h.run(bench)


@pytest.mark.parametrize("case", ["tamper", "partial", "error", "epoch", "bounds", "contention"])
def test_rejected_input_cannot_be_consumed(case):
    h = Harness()
    async def bench(ctx, rx):
        if case == "tamper":
            await h.receive(ctx, 0, mutation=lambda raw: raw.__setitem__(8, raw[8] ^ 1))
            assert ctx.get(rx.state) == rx.FAILED
        elif case == "bounds":
            await h.send(ctx, protocol.command(protocol.BEGIN, 0, 7, 1, 1024))
            assert ctx.get(rx.state) == rx.EMPTY
        else:
            await h.send(ctx, protocol.command(protocol.BEGIN, 0, 7, 1, 256))
            if case == "contention":
                ctx.set(rx.memory_ready, 0)
                await h.send(ctx, b"\x01\x02\x03\x04\x05")
            elif case == "error":
                ctx.set(rx.error, 1)
                await ctx.tick()
                ctx.set(rx.error, 0)
            elif case == "epoch":
                await h.send(ctx, b"\x01\x02")
                ctx.set(rx.epoch, 8)
                await ctx.tick().repeat(2)
                assert ctx.get(rx.state) == rx.EMPTY
                await h.send(ctx, protocol.command(protocol.BEGIN, 0, 7, 1, 256))
                assert ctx.get(rx.state) == rx.EMPTY
            else:
                await h.send(ctx, b"\x01\x02")
                await ctx.tick().repeat(40002)
            if case != "epoch":
                assert ctx.get(rx.state) == rx.FAILED
        ctx.set(rx.pop, 1)
        ctx.set(rx.commit, 1)
        await ctx.tick()
        assert ctx.get(rx.consumed) == 0
        assert ctx.get(rx.state) not in (rx.READY, rx.COPYING, rx.CONSUMED)
        assert not ctx.get(rx.memory_write)
    h.run(bench)


def test_invalid_protected_manifest_rejected_before_elaboration():
    rows = records()
    for change in ("hash", "overlap", "type"):
        bad = copy.deepcopy(rows)
        if change == "hash":
            bad[0]["localizedSha256LE"] = "0" * 64
        elif change == "overlap":
            bad[1]["baseByte"] = bad[0]["baseByte"]
        else:
            bad[0]["words"][0] |= 1 << 8
        with pytest.raises(ValueError):
            protocol.validate_records(bad)


def test_image_epoch_change_cancels_inflight_sha_before_new_delivery():
    h = Harness()
    async def bench(ctx, rx):
        r = h.records[1]
        raw = struct.pack("<" + "I" * r["sizeWords"], *r["words"])
        await h.send(ctx, protocol.command(protocol.BEGIN, 1, 7, 1, len(raw)))
        await h.send(ctx, raw)
        await h.send(ctx, protocol.command(protocol.FINISH, 1, 7, 1))
        assert ctx.get(rx.state) == rx.VERIFYING
        ctx.set(rx.epoch, 8)
        await ctx.tick().repeat(4)
        assert ctx.get(rx.state) == rx.EMPTY
        await h.send(ctx, protocol.command(protocol.FINISH, 1, 7, 1))
        assert ctx.get(rx.state) == rx.EMPTY
        # A new-epoch payload must be hashed anew, not admitted by the old
        # digest completing late. Keep selector and length identical.
        changed = bytearray(raw)
        changed[8] ^= 1
        await h.send(ctx, protocol.command(protocol.BEGIN, 1, 8, 1, len(raw)))
        await h.send(ctx, changed)
        await h.send(ctx, protocol.command(protocol.FINISH, 1, 8, 1))
        await ctx.tick().repeat(2200)
        assert ctx.get(rx.state) == rx.FAILED
        assert ctx.get(rx.consumed) == 0
    h.run(bench)


def test_out_of_phase_exact_body_is_rejected_without_advancing_phase():
    h = Harness()
    async def bench(ctx, rx):
        await h.receive(ctx, 1, 1)
        assert ctx.get(rx.state) == rx.FAILED
        assert ctx.get(rx.phase) == 0 and ctx.get(rx.consumed) == 0
        await h.receive(ctx, 0, 2)
        assert ctx.get(rx.state) == rx.READY
        for _ in h.records[0]["words"]:
            ctx.set(rx.pop, 1)
            await ctx.tick()
        ctx.set(rx.pop, 0)
        ctx.set(rx.commit, 1)
        await ctx.tick()
        ctx.set(rx.commit, 0)
        assert ctx.get(rx.phase) == 1
        await h.receive(ctx, 0, 3)
        assert ctx.get(rx.state) == rx.FAILED
        assert ctx.get(rx.phase) == 1
        await h.receive(ctx, 1, 4)
        assert ctx.get(rx.state) == rx.READY
    h.run(bench)
