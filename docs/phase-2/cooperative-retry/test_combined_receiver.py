"""RTL staging tests with actual SHA reads; no host PASS or core-write grants."""
import copy
import importlib.util
import json
from pathlib import Path
import random
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


@pytest.mark.parametrize("seed,reset_at", [
    (0x401400, "sha"), (0x401401, "ready"), (0x401402, "copy"),
    (0x401403, "last-pop"), (0x401404, "commit"),
    (0x401405, "consumed"), (0x401406, None),
])
def test_seeded_uart_copy_interleavings(seed, reset_at):
    """One small real delivery per seed; randomize edges, not whole images.

    Each pytest ID includes the seed and reset boundary for exact replay.
    The shadow RAM observes accepted staging writes, never injects PASS/data.
    """
    h = Harness()
    rng = random.Random(seed)

    async def bench(ctx, rx):
        shadow = [None] * 256
        writes = 0
        cycle = 0
        live_epoch = 7
        reset_done = False
        words = h.records[0]["words"]
        size = len(words)

        def check(condition, message):
            assert condition, (
                f"seed={seed:#x} reset={reset_at} cycle={cycle}: {message}")

        async def edge(*, byte=None, error=0, ready=1, pop=0, commit=0,
                       reset=False):
            nonlocal cycle, writes, live_epoch, reset_done
            ctx.set(rx.valid, byte is not None)
            ctx.set(rx.byte, byte if byte is not None else 0)
            ctx.set(rx.error, error)
            ctx.set(rx.memory_ready, ready)
            ctx.set(rx.pop, pop)
            ctx.set(rx.commit, commit)
            if reset:
                live_epoch += 1
                reset_done = True
                ctx.set(rx.epoch, live_epoch)
            before = ctx.get(rx.state)
            consumed = ctx.get(rx.consumed)
            locked = before in (rx.READY, rx.COPYING)
            write = ctx.get(rx.memory_write)
            if locked or reset or error:
                check(not write, "transport wrote while locked/reset/error")
            if write:
                # This port is relative to the fixed staging allocation, not
                # the record's executable base or its Namespace slot.
                address = ctx.get(rx.memory_address)
                check(before == rx.RECEIVING, "write outside receipt")
                check(0 <= address < size, "write escaped staging body")
                if ready:
                    shadow[address] = ctx.get(rx.memory_data)
                    writes += 1
            await ctx.tick()
            cycle += 1
            if reset:
                check(ctx.get(rx.state) == rx.EMPTY, "reset lost priority")
                check(ctx.get(rx.consumed) == 0, "reset retained copy cursor")
                check(ctx.get(rx.phase) == 0, "reset retained admission phase")
            elif locked:
                check(shadow[:size] == words, "validated snapshot changed")
                check(ctx.get(rx.consumed) == min(size, consumed + bool(pop)),
                      "UART changed SYSTEM copy cursor")
            if reset_done:
                check(not ctx.get(rx.accepted), "stale epoch admitted")
                check(ctx.get(rx.state) not in (rx.READY, rx.COPYING, rx.CONSUMED),
                      "stale delivery became consumable")

        async def send(data):
            for byte in data:
                await edge(byte=byte)
                for _ in range(rng.randint(1, 3)):
                    await edge()

        # Force pending-word contention, then coincide a UART error with a
        # SYSTEM request. A short rejected prefix avoids another SHA transfer.
        await send(protocol.command(protocol.BEGIN, 0, 7, 1, size * 4))
        for byte in b"\x01\x02\x03\x04":
            await edge(byte=byte, ready=0)
        await edge(byte=rng.randrange(256), ready=0, pop=1, commit=1)
        check(ctx.get(rx.state) == rx.FAILED, "contention did not reject")
        await edge(error=1, pop=1, commit=1)
        check(ctx.get(rx.consumed) == 0, "partial input was consumed")

        await send(protocol.command(protocol.BEGIN, 0, 7, 2, size * 4))
        raw = struct.pack("<" + "I" * size, *words)
        for i, byte in enumerate(raw):
            await edge(byte=byte)
            # Hold a completed word under contention, then release before the
            # next UART byte. These are real synchronous RAM writes.
            if i % 4 == 3:
                for _ in range(rng.randint(0, 3)):
                    await edge(ready=0)
            await edge()
        check(ctx.get(rx.state) == rx.SEALED, "complete body not sealed")
        check(shadow[:size] == words, "staging bytes differ before SHA")
        check(writes == size, "unexpected accepted staging writes")
        await send(protocol.command(protocol.FINISH, 0, 7, 2))
        if reset_at == "sha":
            for _ in range(rng.randint(0, 80)):
                await edge(ready=rng.randrange(2), pop=1, commit=1)
            await edge(reset=True, byte=rng.randrange(256), error=1,
                       ready=0, pop=1, commit=1)
        else:
            for _ in range(2200):
                if ctx.get(rx.state) == rx.READY:
                    break
                await edge(ready=rng.randrange(2), pop=1, commit=1)
            check(ctx.get(rx.state) == rx.READY, "SHA failed to validate")
            check(shadow[:size] == words, "SHA validated a changed snapshot")
            if reset_at == "ready":
                await edge(reset=True, byte=0xff, error=1, pop=1, commit=1)
            else:
                reset_word = rng.randrange(1, size - 1)
                # Mix malformed headers, exact ABORT/BEGIN, errors, port
                # contention and premature commits throughout SYSTEM's copy.
                noise = (protocol.command(protocol.ABORT, 0, 7, 2) +
                         protocol.command(protocol.BEGIN, 1, 7, 3, 1024) +
                         bytes(rng.randrange(256) for _ in range(256)))
                for i, expected in enumerate(words):
                    for _ in range(rng.randint(2, 5)):
                        await edge(byte=noise[cycle % len(noise)],
                                   error=rng.randrange(2),
                                   ready=rng.randrange(2), commit=1)
                    check(ctx.get(rx.word) == expected,
                          f"changed validated word {i}")
                    reset = ((reset_at == "copy" and i == reset_word) or
                             (reset_at == "last-pop" and i == size - 1))
                    await edge(byte=rng.randrange(256), error=1,
                               ready=0, pop=1, commit=1, reset=reset)
                    if reset:
                        break
                if not reset_done:
                    check(ctx.get(rx.consumed) == size, "incomplete copy")
                    await edge(byte=0xff, error=1, ready=0, commit=1,
                               reset=reset_at == "commit")
                    if not reset_done:
                        check(ctx.get(rx.state) == rx.CONSUMED,
                              "SYSTEM commit did not complete")
                        check(ctx.get(rx.phase) == 1, "wrong admission phase")
                        if reset_at == "consumed":
                            await edge(reset=True, pop=1, commit=1, error=1)

        if reset_done:
            # Old SHA completion and matching stale control frames must not
            # revive an interrupted copy, even with SYSTEM requests asserted.
            await send(protocol.command(protocol.BEGIN, 0, 7, 1, size * 4))
            await send(protocol.command(protocol.FINISH, 0, 7, 2))
            for _ in range(2200):
                await edge(pop=rng.randrange(2), commit=rng.randrange(2),
                           ready=rng.randrange(2))
            check(ctx.get(rx.consumed) == 0, "stale epoch consumed words")
        check(writes == size, "UART acquired write authority after validation")

    h.run(bench)
