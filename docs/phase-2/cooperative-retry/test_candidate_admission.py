"""CSI3 decoded-byte tests with real 144 KiB banked RAM and SHA-256."""
import hashlib

from amaranth.sim import Simulator
import pytest
from candidate_test_support import module

CandidateAdmission = module("candidate_admission").CandidateAdmission
CandidateMemory = module("candidate_memory").CandidateMemory
transport = module("starter_transport")
Lifecycle = module("starter_lifecycle").StarterLifecycle


def header(op, epoch, length=0):
    return transport.command(op, 0, epoch, length, general_image=True, combined_image=True)


async def send(ctx, tr, data):
    ctx.set(tr.valid, 1)
    for byte in data:
        ctx.set(tr.byte, byte)
        await ctx.tick()
    ctx.set(tr.valid, 0)


async def inspect(ctx, dut, address, expected):
    p = dut.probe
    ctx.set(p.address, address)
    ctx.set(p.read, 1)
    assert ctx.get(p.ready)
    await ctx.tick()
    ctx.set(p.read, 0)
    assert ctx.get(p.rvalid) and not ctx.get(p.rerror)
    assert ctx.get(p.rdata) == expected


async def load(ctx, dut, data, digest=None):
    tr, ctl = dut.transport, dut.control
    epoch = ctx.get(ctl.epoch)
    await send(ctx, tr, header(1, epoch, len(data)))
    assert ctx.get(ctl.state) == ctl.LOADING
    assert ctx.get(dut.admitted_digest) == 0
    assert not ctx.get(dut.staging_ready)
    await send(ctx, tr, hashlib.sha256(data).digest() if digest is None else digest)
    await send(ctx, tr, data)
    assert ctx.get(ctl.words_received) == 32768
    assert ctx.get(ctl.execution_reset)
    await send(ctx, tr, header(3, epoch + 1))  # START cannot replace FINISH
    assert ctx.get(ctl.state) == ctl.LOADING
    await send(ctx, tr, header(2, epoch + 1))
    for _ in range(210000):
        if ctx.get(ctl.state) != ctl.VERIFYING:
            break
        await ctx.tick()
    else:
        pytest.fail("128 KiB RAM hash did not complete in the bounded observation")
    assert ctx.get(dut.sha.digest) == int.from_bytes(hashlib.sha256(data).digest(), "big")
    return epoch + 1


def run(dut, bench):
    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()


def test_full_image_real_hash_staging_scrub_and_successive_epoch():
    d = CandidateAdmission(clock_hz=100)
    # Nonzero preexisting staging proves that clearing isn't merely a default
    # zero-filled simulation-memory assumption.
    d.memory = CandidateMemory(init=[0] * 32768 + [0xa55aa55a] * 4096)
    async def bench(ctx):
        tr, ctl = d.transport, d.control
        ctx.set(tr.maintenance, 1)
        await inspect(ctx, d, 0x20000, 0xa55aa55a)
        await inspect(ctx, d, 0x23ffc, 0xa55aa55a)
        first = bytes(range(256)) * 256 + bytes(reversed(range(256))) * 256
        for data in (first, bytes(131068) + b"\x78\x56\x34\x12"):
            epoch = await load(ctx, d, data)
            assert ctx.get(ctl.state) == ctl.READY
            assert ctx.get(ctl.execution_reset)
            assert ctx.get(d.staging_ready)
            assert ctx.get(d.admitted_epoch) == epoch
            for a in (0, 0xfffc, 0x10000, 0x1fffc):
                await inspect(ctx, d, a, int.from_bytes(data[a:a+4], "little"))
            for a in (0x20000, 0x20004, 0x23ffc):
                await inspect(ctx, d, a, 0)
            await send(ctx, tr, header(3, epoch-1))
            assert ctx.get(ctl.state) == ctl.READY
            await send(ctx, tr, header(3, epoch))
            assert ctx.get(ctl.state) == ctl.RUNNING
            assert not ctx.get(ctl.execution_reset)
            # All upload and scrub writes are absent while running.
            assert not ctx.get(d.memory.image.ready)
            assert not ctx.get(d.memory.clear.ready)
        # Losing maintenance while running must not reset the application.
        ctx.set(tr.maintenance, 0)
        await ctx.tick()
        assert ctx.get(ctl.state) == ctl.RUNNING
    run(d, bench)


def test_changed_last_high_word_cannot_pass_received_ram_hash():
    d = CandidateAdmission(clock_hz=100)
    async def bench(ctx):
        ctx.set(d.transport.maintenance, 1)
        data = bytes(131068) + b"\x01\x00\x00\x00"
        epoch = await load(ctx, d, data, hashlib.sha256(bytes(131072)).digest())
        assert ctx.get(d.control.state) == d.control.FAILED
        assert not ctx.get(d.admitted_epoch)
        assert not ctx.get(d.admitted_digest)
        await send(ctx, d.transport, header(3, epoch))
        assert ctx.get(d.control.execution_reset)
    run(d, bench)


@pytest.mark.parametrize("failure", ["short-digest", "short-word", "maintenance",
                                    "uart-error", "wrong-magic", "wrong-length",
                                    "oversized", "reserved-byte"])
def test_rejected_or_interrupted_installation_never_releases(failure):
    d = CandidateAdmission(clock_hz=100)
    async def bench(ctx):
        tr, ctl = d.transport, d.control
        ctx.set(tr.maintenance, 1)
        bad = header(1, 0, 131072)
        if failure == "wrong-magic":
            bad = transport.command(1, 0, 0, 131072, general_image=True)
        if failure == "wrong-length":
            bad = header(1, 0, 65536)
        if failure == "oversized":
            bad = header(1, 0, 131076)
        if failure == "reserved-byte":
            bad = bad[:6] + b"\x01" + bad[7:]
        await send(ctx, tr, bad)
        if failure in ("wrong-magic", "wrong-length", "oversized", "reserved-byte"):
            assert ctx.get(ctl.state) == ctl.HELD
            assert not ctx.get(ctl.epoch)
        else:
            assert ctx.get(ctl.state) == ctl.LOADING
            await send(ctx, tr, bytes(31) if failure == "short-digest" else bytes(32)+bytes(3))
            if failure == "maintenance":
                ctx.set(tr.maintenance, 0)
            if failure == "uart-error":
                ctx.set(tr.error, 1)
            await ctx.tick().repeat(205)
            assert ctx.get(ctl.state) == ctl.FAILED
            assert not ctx.get(ctl.words_received)
        ctx.set(tr.maintenance, 1)
        ctx.set(tr.error, 0)
        await send(ctx, tr, header(3, ctx.get(ctl.epoch)))
        assert ctx.get(ctl.execution_reset)
        assert not ctx.get(d.admitted_digest)
    run(d, bench)


def test_extra_bytes_after_full_image_fail_closed():
    d = CandidateAdmission(clock_hz=100)
    async def bench(ctx):
        tr, ctl = d.transport, d.control
        ctx.set(tr.maintenance, 1)
        await send(ctx, tr, header(1, 0, 131072))
        await send(ctx, tr, bytes(32))
        await send(ctx, tr, bytes(131072))
        await send(ctx, tr, b"extra" + bytes(11))
        assert ctx.get(ctl.state) == ctl.FAILED
        assert ctx.get(ctl.words_received) == 32768
        await send(ctx, tr, header(3, 1))
        assert ctx.get(ctl.execution_reset)
    run(d, bench)


@pytest.mark.parametrize("general,combined", [(False, False), (True, False), (True, True)])
def test_wire_profiles_are_mutually_exclusive_and_keep_their_lengths(general, combined):
    tr = transport.StarterTransport(clock_hz=100, general_image=general,
                                    combined_image=combined)
    async def bench(ctx):
        ctx.set(tr.maintenance, 1)
        for g, c in [(False, False), (True, False), (True, True)]:
            if (g, c) == (general, combined):
                continue
            await send(ctx, tr, transport.command(1, 0, 0, 131072 if c else 65536,
                                                  general_image=g, combined_image=c))
            assert ctx.get(tr.control.state) == tr.control.HELD
        await send(ctx, tr, transport.command(1, 0, 0, 131072 if combined else 65536,
                                              general_image=general, combined_image=combined))
        assert ctx.get(tr.control.state) == tr.control.LOADING
        assert tr.control.image_words == (32768 if combined else 16384)
    run(tr, bench)


def test_start_requires_initialization_and_epoch_never_wraps():
    d = Lifecycle(image_words=1, combined_image=True)
    async def bench(ctx):
        ctx.set(d.begin_authorized, 1)
        ctx.set(d.begin, 1)
        await ctx.tick()
        ctx.set(d.begin, 0)
        ctx.set(d.word_valid, 1)
        await ctx.tick()
        ctx.set(d.word_valid, 0)
        ctx.set(d.finish, 1)
        await ctx.tick()
        ctx.set(d.finish, 0)
        ctx.set(d.validation_valid, 1)
        ctx.set(d.validation_epoch, 1)
        ctx.set(d.validation_ok, 1)
        await ctx.tick()
        ctx.set(d.validation_valid, 0)
        ctx.set(d.start, 1)
        ctx.set(d.start_authorized, 1)
        ctx.set(d.start_epoch, 1)
        ctx.set(d.start_ready, 0)
        await ctx.tick()
        assert ctx.get(d.state) == d.READY
        ctx.set(d.start_ready, 1)
        await ctx.tick()
        assert ctx.get(d.state) == d.RUNNING
        ctx.set(d.start, 0)
        # Controlled counter seeding, not an application capability or shortcut.
        ctx.set(d.epoch, 0xffffffff)
        ctx.set(d.begin, 1)
        assert not ctx.get(d.begin_accepted)
        await ctx.tick()
        assert ctx.get(d.epoch) == 0xffffffff
        assert ctx.get(d.state) == d.RUNNING
    run(d, bench)
