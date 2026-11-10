"""Complete top, UART pins, received RAM SHA and real ChurchCore.

Run from a fresh prepare_starter output with that directory on PYTHONPATH.
No host PASS or direct lifecycle/validation input is used.
"""
import hashlib
from pathlib import Path
import struct

import pytest
from amaranth import Module, Signal
from amaranth.sim import Simulator
from hardware.starter_top import StarterTop, IMAGE_SHA256
from hardware.starter_transport import command
from hardware.uart_rx import UartRx
from hardware.request_protocol import REQUEST, RESPONSE
from hardware.hw_types import FaultType, TuringOpcode
from hardware.boot_rom import encode_turing

ROOT = Path(__import__("hardware").__file__).resolve().parent.parent
HZ, BAUD = 20000, 5000
DIVISOR = HZ // BAUD


class Harness:
    def __init__(self, *, hz=HZ, baud=BAUD, top=None):
        self.top = top = top if top is not None else StarterTop(clock_hz=hz, baud=baud, sim_mode=True)
        self.divisor = hz // baud
        self.hz = hz
        self.module = m = Module()
        m.submodules.top = top
        self.monitor = m.submodules.monitor = UartRx(clk_freq=hz, baud=baud)
        m.d.comb += self.monitor.rx.eq(top.uart_tx_pin)
        self.violation = Signal()
        self.progress = Signal(32)
        self.renewals = Signal(32)
        self.retired = Signal(32)
        self.loader_writes = Signal(32)
        self.fault = Signal()
        self.return_result = Signal(32)
        self.returns = Signal(32)
        core, ctl = top.core, top.control
        # retire_valid includes fault telemetry in the retained core. At the
        # BEGIN acceptance edge synchronous reset wins over all register writes;
        # raw pre-edge telemetry is not an instruction commit.
        with m.If(ctl.execution_reset & (
                top.program_commit |
                (core.retire_valid & ~core.retire_fault_valid & ~ctl.begin_accepted))):
            m.d.sync += self.violation.eq(1)
        with m.If(ctl.memory_write):
            m.d.sync += self.loader_writes.eq(self.loader_writes + 1)
        with m.If(~ctl.execution_reset):
            with m.If(core.retire_valid):
                m.d.sync += self.retired.eq(self.retired + 1)
                with m.If(core.retire_nia == 0x7008):
                    m.d.sync += self.progress.eq(self.progress + 1)
                with m.If(core.retire_nia == 0x500C):
                    m.d.sync += [self.return_result.eq(core.debug_dr_words[12]),
                                 self.returns.eq(self.returns + 1)]
            with m.If(core.sim_watchdog.transition_complete):
                m.d.sync += self.renewals.eq(self.renewals + 1)
            with m.If(core.fault_valid):
                m.d.sync += self.fault.eq(1)
        self.output = bytearray()

    def run(self, bench):
        sim = Simulator(self.module)
        sim.add_clock(1 / self.hz)

        finished = False
        async def monitor(ctx):
            while not finished:
                await ctx.tick()
                if ctx.get(self.monitor.valid):
                    self.output.append(ctx.get(self.monitor.data))
        async def run(ctx):
            nonlocal finished
            ctx.set(self.top.uart_rx_pin, 1)
            try:
                await bench(ctx, self)
            finally:
                finished = True
                await ctx.tick()
        sim.add_testbench(monitor, background=True)
        sim.add_testbench(run)
        sim.run()

    async def send(self, ctx, data):
        for byte in data:
            for bit in (0, *((byte >> n) & 1 for n in range(8)), 1):
                ctx.set(self.top.uart_rx_pin, bit)
                await ctx.tick().repeat(self.divisor)
        ctx.set(self.top.uart_rx_pin, 1)
        await ctx.tick().repeat(self.divisor * 2)

    async def enable(self, ctx, value=True):
        ctx.set(self.top.maintenance_enable, value)
        await ctx.tick().repeat(4)

    async def load(self, ctx, image, data=None, extra=False):
        ctl = self.top.control
        epoch = ctx.get(ctl.epoch)
        await self.enable(ctx)
        await self.send(ctx, command(1, image, epoch, 65536))
        assert ctx.get(ctl.state) == ctl.LOADING
        assert ctx.get(ctl.epoch) == epoch + 1
        if data is None:
            data = (ROOT / "applications" / ("user-b.bin" if image else "all-waiting.bin")).read_bytes()
        before = ctx.get(self.loader_writes)
        await self.send(ctx, data)
        assert ctx.get(ctl.words_received) == 16384
        assert ctx.get(self.loader_writes) - before == 16384
        assert ctx.get(ctl.state) == ctl.LOADING
        assert not ctx.get(self.top.core.sim_watchdog.active)
        assert not ctx.get(self.violation)
        # Complete UART transfer exceeds both one second and the physical
        # 57600-baud lower bound. No timer kick or test PASS was supplied.
        assert len(data) * 10 / (self.hz // self.divisor) > 11.377
        await self.send(ctx, command(2, image, epoch))  # stale FINISH
        assert ctx.get(ctl.state) == ctl.LOADING
        if extra:
            await self.send(ctx, bytes(16))
            assert ctx.get(ctl.state) == ctl.FAILED
            return epoch + 1
        await self.send(ctx, command(2, image, epoch + 1))
        assert ctx.get(ctl.state) == ctl.VERIFYING
        await ctx.tick().repeat(100000)
        return epoch + 1


def test_same_top_loads_both_images_and_routes_diagnostic(record_property):
    h = Harness()

    async def bench(ctx, h):
        top, ctl = h.top, h.top.control
        for image in (1, 0):
            before_progress = ctx.get(h.progress)
            before_renew = ctx.get(h.renewals)
            before_return = ctx.get(h.returns)
            epoch = await h.load(ctx, image)
            assert ctx.get(ctl.state) == ctl.READY
            assert ctx.get(top.admitted_epoch) == epoch
            assert ctx.get(top.admitted_digest) == int(IMAGE_SHA256[image], 16)
            assert not ctx.get(top.core.boot_complete)
            # Stale controls cannot start or replace READY bytes.
            await h.send(ctx, command(3, image, epoch - 1))
            assert ctx.get(ctl.state) == ctl.READY
            await h.send(ctx, command(3, image, epoch))
            assert ctx.get(ctl.state) == ctl.RUNNING
            await h.enable(ctx, False)
            await ctx.tick().repeat(5000)
            assert ctx.get(top.core.boot_namespace_admitted)
            assert ctx.get(top.core.boot_thread_validated)
            assert ctx.get(top.core.boot_thread_activated)
            assert not ctx.get(h.fault), (ctx.get(top.core.fault), hex(ctx.get(top.core.nia)))
            assert REQUEST in h.output
            await ctx.tick().repeat(HZ * 2)
            assert ctx.get(h.renewals) > before_renew + 2
            assert (ctx.get(h.progress) > before_progress) == bool(image)
            await h.send(ctx, RESPONSE)
            await ctx.tick().repeat(15000)
            assert ctx.get(top.diagnostic.accepted)
            assert ctx.get(top.diagnostic.retries) == 1
            assert ctx.get(top.diagnostic.publish_count) == 1
            assert ctx.get(h.returns) == before_return + 1
            assert ctx.get(h.return_result) == 13
            assert not ctx.get(h.fault), (ctx.get(top.core.fault), hex(ctx.get(top.core.nia)))
            assert not ctx.get(h.violation)
            # Maintenance-off control bytes cannot reset the running core.
            boots = ctx.get(top.boots)
            await h.send(ctx, command(1, image, epoch, 65536))
            assert ctx.get(ctl.state) == ctl.RUNNING
            assert ctx.get(top.boots) == boots
            # Authorized but stale BEGIN also cannot reset an executing epoch.
            await h.enable(ctx)
            await h.send(ctx, command(1, image, epoch - 1, 65536))
            assert ctx.get(ctl.state) == ctl.RUNNING
            assert ctx.get(top.boots) == boots
        assert ctx.get(top.boots) == 2
        record_property("evidence", "same elaboration; both exact 64KiB UART images; SHA readback; real guarded boot; CALL result 13")
    h.run(bench)


def test_non_yielding_execution_expires_and_explicit_reload_restarts(monkeypatch, record_property):
    # Negative-control build ONLY. Production's two pinned hashes are not edited.
    # A real branch-to-self program is admitted by its own build-time test hash;
    # no test drives validation_ok, runtime authority, or core registers.
    import hardware.starter_top as starter
    data = bytearray((ROOT / "applications/all-waiting.bin").read_bytes())
    struct.pack_into("<I", data, 0x2010, encode_turing(TuringOpcode.BRANCH, imm=0))
    monkeypatch.setattr(starter, "IMAGE_SHA256", (
        hashlib.sha256(data).hexdigest(), IMAGE_SHA256[1]))
    h = Harness()

    async def bench(ctx, h):
        top, ctl, wd = h.top, h.top.control, h.top.core.sim_watchdog
        for attempt in range(2):
            epoch = await h.load(ctx, 0, data)
            assert ctx.get(ctl.state) == ctl.READY
            assert not ctx.get(wd.expired) and not ctx.get(wd.active)
            assert ctx.get(top.admitted_digest) == int(hashlib.sha256(data).hexdigest(), 16)
            await h.send(ctx, command(3, 0, epoch))
            await h.enable(ctx, False)
            await ctx.tick().repeat(3000)
            assert ctx.get(top.core.boot_complete)
            assert ctx.get(wd.active) and not ctx.get(wd.expired)
            assert ctx.get(top.core.nia) == 0x2010
            # An unauthorized replacement command cannot pause or kick it.
            await h.send(ctx, command(1, 0, epoch, 65536))
            await ctx.tick().repeat(HZ + 100)
            assert ctx.get(wd.expired)
            assert ctx.get(top.core.fault_valid)
            assert ctx.get(top.core.fault) == FaultType.WATCHDOG
            assert not ctx.get(top.program_commit)
            before = ctx.get(top.boots)
            await h.enable(ctx)
            await h.send(ctx, command(3, 0, epoch))
            await ctx.tick().repeat(100)
            assert ctx.get(wd.expired) and ctx.get(top.boots) == before
            assert not ctx.get(h.violation)
        assert ctx.get(top.boots) == 2
        record_property("scope", "test-only pinned non-yielding image; received bytes and SHA admitted twice; no production allowlist change")
    h.run(bench)


def test_full_top_partial_unauthorized_and_malformed_controls():
    h = Harness()

    async def bench(ctx, h):
        ctl = h.top.control
        await h.send(ctx, command(1, 0, 0, 65536))
        assert ctx.get(ctl.state) == ctl.HELD and ctx.get(ctl.epoch) == 0
        await h.enable(ctx)
        for bad in (command(1, 2, 0, 65536), command(1, 0, 0, 65532),
                    command(1, 0, 5, 65536), b"BAD!" + command(1, 0, 0, 65536)[4:]):
            await h.send(ctx, bad)
            assert ctx.get(ctl.state) == ctl.HELD
        await h.send(ctx, command(1, 0, 0, 65536))
        await h.send(ctx, b"\x00\x01\x02")  # partial word
        assert ctx.get(h.loader_writes) == 0
        await ctx.tick().repeat(HZ * 2 + 2)
        assert ctx.get(ctl.state) == ctl.FAILED
        await h.send(ctx, command(3, 0, 1))
        assert ctx.get(ctl.state) == ctl.FAILED
        await h.send(ctx, command(1, 1, 1, 65536))
        await h.send(ctx, b"\x11\x22\x33\x44\x55")
        assert ctx.get(h.loader_writes) == 1
        await h.enable(ctx, False)
        assert ctx.get(ctl.state) == ctl.FAILED
        await h.enable(ctx)
        await h.send(ctx, command(1, 0, 2, 65536))
        # Real UART break (invalid stop bit) while authorized/loading.
        ctx.set(h.top.uart_rx_pin, 0)
        await ctx.tick().repeat(DIVISOR * 20)
        ctx.set(h.top.uart_rx_pin, 1)
        await ctx.tick().repeat(DIVISOR * 20)
        assert ctx.get(ctl.state) == ctl.FAILED
        assert ctx.get(h.top.boots) == 0
        assert not ctx.get(h.violation)
        assert not ctx.get(h.top.core.sim_watchdog.active)
    h.run(bench)


@pytest.mark.parametrize("corruption", ["wrong-image", "malformed-entry", "excess"])
def test_received_image_rejection(corruption):
    h = Harness()

    async def bench(ctx, h):
        data = bytearray((ROOT / "applications/user-b.bin").read_bytes())
        image = 0 if corruption == "wrong-image" else 1
        if corruption == "malformed-entry":
            data[16] ^= 1
        epoch = await h.load(ctx, image, data, extra=corruption == "excess")
        assert ctx.get(h.top.control.state) == h.top.control.FAILED
        assert ctx.get(h.top.admitted_epoch) == 0
        if corruption != "excess":
            assert ctx.get(h.top.verifier.digest) == int(hashlib.sha256(data).hexdigest(), 16)
        await h.send(ctx, command(3, image, epoch))
        assert ctx.get(h.top.boots) == 0
        assert not ctx.get(h.violation)
    h.run(bench)
