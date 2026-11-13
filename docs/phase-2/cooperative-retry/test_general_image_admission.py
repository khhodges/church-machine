"""CSI2 offline tests: real transport, RAM readback SHA, unchanged lifecycle."""
import hashlib
import json
import os
from pathlib import Path

from amaranth import Module, ResetInserter, Signal, unsigned
from amaranth.lib.memory import Memory
from amaranth.sim import Simulator
import pytest

from hardware.starter_transport import StarterTransport, command
from hardware.starter_sha256 import ReceivedImageSHA256
from hardware.starter_top import StarterTop
from hardware.boot_pair_guard import BootPairGuard
from hardware.hw_types import FaultType

# Explicit local boot configuration, never inferred from received descriptors.
BOOT2_BOOT_GUARD = 0


def header(op, epoch, **kw):
    return command(op, 0, epoch, general_image=True, **kw)


class Admission:
    def __init__(self, general=True):
        m = self.module = Module()
        tr = self.transport = StarterTransport(clock_hz=100, general_image=general)
        ctl = self.control = tr.control
        sha = self.sha = ReceivedImageSHA256()
        m.submodules.transport = tr
        m.submodules.sha = ResetInserter(ctl.begin_accepted)(sha)
        mem = m.submodules.mem = Memory(shape=unsigned(32), depth=16384, init=[])
        wr, rd = mem.write_port(), mem.read_port()
        busy, valid = Signal(), Signal()
        epoch, digest = Signal(32), Signal(256)
        m.d.comb += [
            wr.en.eq(ctl.memory_write), wr.addr.eq(ctl.memory_address),
            wr.data.eq(ctl.memory_data), rd.addr.eq(sha.address), sha.data.eq(rd.data),
            sha.start.eq(ctl.validate_request & ~busy),
            ctl.validation_valid.eq(sha.done), ctl.validation_epoch.eq(epoch),
            ctl.validation_ok.eq(valid & (sha.digest == digest)),
        ]
        with m.If(sha.start):
            m.d.sync += [busy.eq(1), epoch.eq(ctl.epoch),
                         digest.eq(tr.expected_digest), valid.eq(tr.digest_valid)]
        with m.If(sha.done | ctl.begin_accepted):
            m.d.sync += busy.eq(0)

    async def send(self, ctx, data):
        ctx.set(self.transport.valid, 1)
        for byte in data:
            ctx.set(self.transport.byte, byte)
            await ctx.tick()
        ctx.set(self.transport.valid, 0)

    async def load(self, ctx, raw, expected=None):
        ctl = self.control
        epoch = ctx.get(ctl.epoch)
        await self.send(ctx, header(1, epoch, length=65536))
        assert ctx.get(ctl.state) == ctl.LOADING
        await self.send(ctx, expected or hashlib.sha256(raw).digest())
        assert ctx.get(ctl.words_received) == 0
        await self.send(ctx, raw)
        assert ctx.get(ctl.words_received) == 16384
        await self.send(ctx, header(3, epoch + 1))  # cannot start before FINISH
        assert ctx.get(ctl.state) == ctl.LOADING
        await self.send(ctx, header(2, epoch + 1))
        for _ in range(100000):
            if ctx.get(ctl.state) != ctl.VERIFYING:
                break
            await ctx.tick()
        assert ctx.get(self.sha.digest) == int.from_bytes(hashlib.sha256(raw).digest(), "big")
        return epoch + 1

    def run(self, bench):
        sim = Simulator(self.module)
        sim.add_clock(1e-6)
        sim.add_testbench(bench)
        sim.run()


def test_two_distinct_images_same_elaboration_and_bad_digest():
    h = Admission()
    async def bench(ctx):
        ctl = h.control
        ctx.set(h.transport.maintenance, 1)
        for raw in (bytes(65536), bytes(range(256)) * 256):
            epoch = await h.load(ctx, raw)
            assert ctx.get(ctl.state) == ctl.READY
            assert ctx.get(ctl.execution_reset)
            await h.send(ctx, header(3, epoch - 1))
            assert ctx.get(ctl.state) == ctl.READY
            await h.send(ctx, header(3, epoch))
            assert ctx.get(ctl.state) == ctl.RUNNING
        raw = bytes(65536)
        epoch = await h.load(ctx, raw, expected=bytes(32))
        assert ctx.get(ctl.state) == ctl.FAILED
        await h.send(ctx, header(3, epoch))
        assert ctx.get(ctl.state) == ctl.FAILED
        assert ctx.get(ctl.execution_reset)
    h.run(bench)


@pytest.mark.parametrize("failure", ["digest-timeout", "partial-data", "maintenance",
                                     "uart-error", "bad-header", "extra-data"])
def test_incomplete_or_interrupted_transfer_never_starts(failure):
    h = Admission()
    async def bench(ctx):
        tr, ctl = h.transport, h.control
        await h.send(ctx, header(1, 0, length=65536))
        assert ctx.get(ctl.state) == ctl.HELD
        ctx.set(tr.maintenance, 1)
        await h.send(ctx, command(1, 0, 0, 65536))  # CSI1 cannot enter CSI2
        assert ctx.get(ctl.state) == ctl.HELD
        await h.send(ctx, header(1, 0, length=65536))
        if failure == "digest-timeout":
            await h.send(ctx, bytes(31))
        else:
            await h.send(ctx, hashlib.sha256(bytes(65536)).digest())
            if failure in ("bad-header", "extra-data"):
                await h.send(ctx, bytes(65536))
                await h.send(ctx, b"BAD!" + bytes(12) if failure == "bad-header" else bytes(16))
            else:
                await h.send(ctx, bytes(3))
                assert ctx.get(ctl.words_received) == 0
                if failure == "maintenance":
                    ctx.set(tr.maintenance, 0)
                if failure == "uart-error":
                    ctx.set(tr.error, 1)
        await ctx.tick().repeat(205)
        assert ctx.get(ctl.state) == ctl.FAILED
        ctx.set(tr.maintenance, 1)
        ctx.set(tr.error, 0)
        await h.send(ctx, header(3, 1))
        assert ctx.get(ctl.execution_reset)
    h.run(bench)


def test_demo_mode_rejects_general_protocol():
    h = Admission(general=False)
    async def bench(ctx):
        ctx.set(h.transport.maintenance, 1)
        await h.send(ctx, header(1, 0, length=65536))
        assert ctx.get(h.control.state) == h.control.HELD
    h.run(bench)


def test_general_mode_cannot_enable_fixed_clp_receiver():
    with pytest.raises(ValueError, match="CLP1"):
        StarterTop(general_image=True, lump_records=[])


@pytest.mark.parametrize("guard", [None, -1, True, 511, 511 << 9, 1 << 18])
def test_general_mode_requires_valid_explicit_boot_guard(guard):
    with pytest.raises(ValueError):
        StarterTop(general_image=True, boot_guard=guard)


def test_historical_mode_cannot_override_its_boot_guard():
    with pytest.raises(ValueError, match="Historical CSI1"):
        StarterTop(boot_guard=0)


@pytest.mark.parametrize("guard,stage,observed,accepted", [
    (BOOT2_BOOT_GUARD, 0, 0, True), (BOOT2_BOOT_GUARD, 1, 0, True),
    (BOOT2_BOOT_GUARD, 0, 1, False), (BOOT2_BOOT_GUARD, 1, 1, False),
    ((46 << 9) | 419, 0, 46, True), ((46 << 9) | 419, 1, 419, True),
    ((46 << 9) | 419, 0, 0, False), ((46 << 9) | 419, 1, 0, False),
])
def test_boot_pair_comparisons_remain_independent(guard, stage, observed, accepted):
    dut = BootPairGuard(expected_guard=guard)
    sim = Simulator(dut)
    sim.add_clock(1e-6)
    async def bench(ctx):
        ctx.set(dut.start, 1)
        ctx.set(dut.thread_stage, stage)
        ctx.set(dut.observed_version, observed)
        await ctx.tick()
        ctx.set(dut.start, 0)
        ctx.set(dut.observed_version, 77)  # input was latched, not followed
        assert bool(ctx.get(dut.accepted)) is accepted
        assert ctx.get(dut.fault_type) == (FaultType.NONE if accepted else FaultType.VERSION)
        assert ctx.get(dut.fault_slot) == (0 if accepted else stage + 1)
    sim.add_testbench(bench)
    sim.run()


def test_boot2_exact_bytes_through_uart_and_guarded_core():
    """Optional retained-image replay; no fixture substitution or core mutation."""
    candidate = os.environ.get("BOOT2_REPLAY_IMAGE")
    if not candidate:
        pytest.skip("Set BOOT2_REPLAY_IMAGE to the retained exact image")
    from test_starter_top import Harness, HZ, BAUD
    raw = Path(candidate).read_bytes()
    assert len(raw) == 65536
    digest = hashlib.sha256(raw).hexdigest()
    assert digest == "1edceb0e6f1008098ac7a1aebc1c6e1db968d39270dfe509a0974df390f99014"
    top = StarterTop(clock_hz=HZ, baud=BAUD, sim_mode=True, general_image=True,
                     boot_guard=BOOT2_BOOT_GUARD)
    h = Harness(top=top)
    result = dict(image_sha256=digest, scope="CSI2 UART pins, RAM SHA and retained guarded core",
                  hardware_operations=False, vendor_build=False,
                  clp1_enabled=False, boot_guard=BOOT2_BOOT_GUARD,
                  expected_namespace_version=0, expected_thread_version=0, trace=[])
    async def observe(ctx):
        core = top.core
        cycle = 0
        while True:
            if not ctx.get(top.control.execution_reset):
                if ctx.get(core.retire_valid) and len(result["trace"]) < 64:
                    result["trace"].append(dict(cycle=cycle, nia=ctx.get(core.retire_nia),
                                                fault=ctx.get(core.retire_fault_valid)))
                if ctx.get(core.fault_valid):
                    result.update(outcome="first-runtime-fault", cycle=cycle,
                                  fault=ctx.get(core.fault), nia=ctx.get(core.nia),
                                  boot_fault_slot=ctx.get(core.boot_fault_slot),
                                  boot_complete=ctx.get(core.boot_complete),
                                  namespace_admitted=ctx.get(core.boot_namespace_admitted),
                                  thread_validated=ctx.get(core.boot_thread_validated),
                                  thread_activated=ctx.get(core.boot_thread_activated))
                    return
                cycle += 1
            await ctx.tick()
    async def bench(ctx, h):
        ctl, core = top.control, top.core
        await h.enable(ctx)
        await h.send(ctx, header(1, 0, length=65536))
        print("Boot2: receiving unchanged image through UART pins", flush=True)
        await h.send(ctx, bytes.fromhex(digest) + raw)
        assert ctx.get(ctl.words_received) == 16384
        await h.send(ctx, header(2, 1))
        await ctx.tick().repeat(100000)
        assert ctx.get(ctl.state) == ctl.READY
        assert ctx.get(top.admitted_digest) == int(digest, 16)
        assert ctx.get(ctl.execution_reset) and not ctx.get(top.boots)
        result["admission"] = "READY"
        print("Boot2: received RAM SHA matched; starting guarded core", flush=True)
        await h.send(ctx, header(3, 1))
        for _ in range(20000):
            if "outcome" in result:
                break
            await ctx.tick()
        result.setdefault("outcome", "bounded-observation-no-fault")
        assert not ctx.get(h.violation)
        assert ctx.get(core.boot_namespace_admitted), result
    sim = Simulator(h.module)
    sim.add_clock(1 / HZ)
    sim.add_testbench(observe, background=True)
    async def run(ctx):
        await bench(ctx, h)
    sim.add_testbench(run)
    sim.run()
    target = os.environ.get("BOOT2_REPLAY_REPORT")
    if target:
        Path(target).write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))
