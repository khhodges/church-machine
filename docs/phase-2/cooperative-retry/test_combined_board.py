"""Run from the frozen package's source directory; no vendor or physical access.

These are clock-sampled digital button models, not contact debounce, metastability,
electrical timing, or physical switch qualification. Admission uses the unchanged
approved images, UART pins, received RAM and real SHA verifier.
"""
import hashlib
import json
from pathlib import Path
import struct

import pytest
from amaranth.sim import Simulator
from hardware.combined_board import CombinedStarterBoard
from hardware.starter_transport import command
from hardware.combined_protocol import command as lump_command, BEGIN, FINISH


ROOT = Path.cwd()


class ButtonHarness:
    def __init__(self):
        self.records = json.loads((ROOT / "combined-inputs.json").read_text())["records"]
        self.board = CombinedStarterBoard(self.records, sim_mode=True)
        self.top = self.board.runtime
        self.ctl = self.top.control

    def run(self, bench):
        sim = Simulator(self.board)
        sim.add_clock(1 / 20_000)
        sim.add_testbench(bench)
        sim.run()

    async def send(self, ctx, data):
        for byte in data:
            for bit in (0, *((byte >> n) & 1 for n in range(8)), 1):
                ctx.set(self.board.uart_rx_pin, bit)
                await ctx.tick().repeat(4)
        ctx.set(self.board.uart_rx_pin, 1)
        await ctx.tick().repeat(8)

    async def button(self, ctx, released):
        # The pin is active low, but authorization crosses TWO synchronizer
        # flops. Neither edge may affect maintenance combinationally or after
        # just the first sampling clock.
        before = ctx.get(self.top.transport.maintenance)
        ctx.set(self.board.maintenance_n, released)
        assert ctx.get(self.top.maintenance_enable) == int(not released)
        assert ctx.get(self.top.transport.maintenance) == before
        await ctx.tick()
        assert ctx.get(self.top.transport.maintenance) == before
        await ctx.tick()
        assert ctx.get(self.top.transport.maintenance) == int(not released)
        await ctx.tick().repeat(2)

    async def interrupt(self, ctx, bounce):
        await self.button(ctx, True)
        if bounce:
            # A sampled release is not masked by a latch/debounce exemption.
            for released in (False, True, False, True):
                await self.button(ctx, released)

    async def begin(self, ctx):
        epoch = ctx.get(self.ctl.epoch)
        await self.send(ctx, command(1, 1, epoch, 65536))
        assert ctx.get(self.ctl.state) == self.ctl.LOADING
        assert ctx.get(self.ctl.epoch) == epoch + 1

    async def upload(self, ctx):
        raw = (ROOT / "applications/user-b.bin").read_bytes()
        assert len(raw) == 65536
        await self.send(ctx, raw)
        assert ctx.get(self.ctl.words_received) == 16384
        assert ctx.get(self.ctl.state) == self.ctl.LOADING
        await self.send(ctx, command(2, 1, ctx.get(self.ctl.epoch)))
        assert ctx.get(self.ctl.state) == self.ctl.VERIFYING

    async def ready(self, ctx):
        await ctx.tick().repeat(100000)
        assert ctx.get(self.ctl.state) == self.ctl.READY
        raw = (ROOT / "applications/user-b.bin").read_bytes()
        assert ctx.get(self.top.admitted_digest) == int(hashlib.sha256(raw).hexdigest(), 16)
        assert ctx.get(self.top.admitted_epoch) == ctx.get(self.ctl.epoch)
        assert ctx.get(self.ctl.execution_reset)
        assert ctx.get(self.top.boots) == 0


@pytest.mark.parametrize("bounce", [False, True], ids=["release", "bounce"])
@pytest.mark.parametrize("boundary", ["header", "payload", "VERIFYING", "READY", "START"])
def test_button_interruption_at_upload_boundary(boundary, bounce):
    h = ButtonHarness()

    async def bench(ctx):
        ctl = h.ctl
        await ctx.tick().repeat(4)
        await h.button(ctx, False)
        header = command(1, 1, 0, 65536)
        start = command(3, 1, 1)
        if boundary == "header":
            await h.send(ctx, header[:8])
        else:
            await h.begin(ctx)
            if boundary == "payload":
                await h.send(ctx, b"\x12\x34\x56\x78\x9a\xbc")
                assert ctx.get(ctl.words_received) == 1
            else:
                await h.upload(ctx)
                if boundary in ("READY", "START"):
                    await h.ready(ctx)
                if boundary == "START":
                    # Release immediately before the final START header byte:
                    # already-admitted bytes must not confer start authority.
                    await h.send(ctx, start[:-1])
        epoch = ctx.get(ctl.epoch)
        words = ctx.get(ctl.words_received)
        expected = ctl.HELD if boundary == "header" else ctl.FAILED
        await h.interrupt(ctx, bounce)
        assert ctx.get(ctl.state) == expected
        assert ctx.get(ctl.epoch) == epoch
        assert ctx.get(ctl.words_received) == words
        assert ctx.get(ctl.execution_reset)
        assert not ctx.get(h.top.program_commit)
        assert ctx.get(h.top.boots) == 0

        # Re-pressing is not retry. Even a verifier finishing in the background
        # must not promote an interrupted transaction to READY or RUNNING.
        await h.button(ctx, False)
        await ctx.tick().repeat(100000)
        assert ctx.get(ctl.state) == expected
        assert ctx.get(ctl.epoch) == epoch
        assert ctx.get(ctl.words_received) == words
        assert not ctx.get(h.top.core.sim_watchdog.active)
        assert ctx.get(h.top.boots) == 0

        if boundary in ("header", "START"):
            await h.send(ctx, header[8:] if boundary == "header" else start[-1:])
            assert ctx.get(ctl.state) == expected  # no retained partial header
            # Discard this deliberately incomplete new frame via release.
            await h.button(ctx, True)
            await h.button(ctx, False)
        if epoch:
            for stale in (command(1, 1, epoch - 1, 65536),
                          command(2, 1, epoch - 1), command(3, 1, epoch - 1),
                          command(3, 1, epoch)):
                await h.send(ctx, stale)
                assert ctx.get(ctl.state) == expected
                assert ctx.get(ctl.epoch) == epoch
                assert ctx.get(h.top.boots) == 0
        # Only a fresh explicit BEGIN restarts, with the next retained epoch.
        await h.begin(ctx)
        assert ctx.get(ctl.words_received) == 0
        await h.send(ctx, b"\x11\x22\x33\x44")
        await ctx.tick().repeat(200)
        assert ctx.get(ctl.state) == ctl.LOADING
        assert ctx.get(ctl.epoch) == epoch + 1
        assert ctx.get(ctl.words_received) == 1  # held button is NOT reset
        assert ctx.get(ctl.execution_reset)

    h.run(bench)


def test_running_button_release_routes_real_lump_without_reset_or_replay():
    h = ButtonHarness()

    async def bench(ctx):
        ctl, rx = h.ctl, h.top.lump_receiver
        await ctx.tick().repeat(4)
        await h.button(ctx, False)
        await h.begin(ctx)
        await h.upload(ctx)
        await h.ready(ctx)
        epoch = ctx.get(ctl.epoch)
        await h.send(ctx, command(3, 1, epoch - 1))
        assert ctx.get(ctl.state) == ctl.READY
        await h.send(ctx, command(3, 1, epoch))
        assert ctx.get(ctl.state) == ctl.RUNNING
        await ctx.tick().repeat(5000)
        assert ctx.get(h.top.boots) == 1
        assert ctx.get(h.top.core.boot_complete)
        old = h.records[0]
        raw = struct.pack("<" + "I" * len(old["words"]), *old["words"])
        # A held button selects image controls, never LUMP admission or reset.
        await h.send(ctx, lump_command(BEGIN, 0, epoch, 1, len(raw)))
        assert ctx.get(rx.state) == rx.EMPTY
        assert ctx.get(ctl.state) == ctl.RUNNING
        assert ctx.get(ctl.epoch) == epoch
        assert ctx.get(h.top.boots) == 1
        await h.interrupt(ctx, True)
        assert ctx.get(ctl.state) == ctl.RUNNING
        assert not ctx.get(ctl.execution_reset)
        assert ctx.get(ctl.epoch) == epoch
        # Image commands without the physical hold cannot reset the runtime;
        # old-epoch LUMP traffic cannot cross the epoch boundary either.
        # LUMP framing is fixed at 20 bytes; complete the invalid image
        # header rather than accidentally splicing it into the next command.
        await h.send(ctx, command(1, 1, epoch, 65536) + bytes(4))
        await h.send(ctx, lump_command(BEGIN, 0, epoch - 1, 1, len(raw)))
        assert ctx.get(rx.state) == rx.EMPTY
        assert ctx.get(rx.transaction) == 0  # rejected traffic consumes no ID
        await h.send(ctx, lump_command(BEGIN, 0, epoch, 1, len(raw)))
        assert ctx.get(rx.state) == rx.RECEIVING
        await h.send(ctx, raw)
        assert ctx.get(rx.state) == rx.SEALED
        await h.send(ctx, lump_command(FINISH, 0, epoch, 1))
        await ctx.tick().repeat(40000)
        assert ctx.get(rx.state) == rx.CONSUMED  # real SHA + SYSTEM publication
        assert ctx.get(ctl.state) == ctl.RUNNING
        assert ctx.get(ctl.epoch) == epoch
        assert ctx.get(h.top.boots) == 1
        assert not ctx.get(h.top.core.sim_watchdog.expired)
        assert not ctx.get(h.top.core.fault_valid)

    h.run(bench)


def test_button_controls_maintenance_without_resetting_transport():
    records = json.loads((ROOT / "combined-inputs.json").read_text())["records"]
    board = CombinedStarterBoard(records, sim_mode=True)
    sim = Simulator(board)
    sim.add_clock(1 / 20_000)

    async def bench(ctx):
        control = board.runtime.control

        async def send(data):
            for byte in data:
                for bit in [0, *[(byte >> i) & 1 for i in range(8)], 1]:
                    ctx.set(board.uart_rx_pin, bit)
                    await ctx.tick().repeat(4)
                await ctx.tick().repeat(4)
            await ctx.tick().repeat(20)

        assert ctx.get(board.maintenance_n) == 1
        await ctx.tick().repeat(20)
        assert ctx.get(control.state) == control.HELD
        assert ctx.get(control.execution_reset)
        # Released button cannot authorize BEGIN.
        await send(command(1, 1, 0, 65536))
        assert ctx.get(control.state) == control.HELD
        assert ctx.get(control.epoch) == 0

        ctx.set(board.maintenance_n, 0)
        await ctx.tick().repeat(20)
        await send(command(1, 1, 0, 65536))
        assert ctx.get(control.state) == control.LOADING
        assert ctx.get(control.epoch) == 1
        await send(bytes([0x12, 0x34, 0x56, 0x78]))
        assert ctx.get(control.words_received) == 1
        # Continued physical hold must not reset parser, epoch or received count.
        await ctx.tick().repeat(200)
        assert ctx.get(control.epoch) == 1
        assert ctx.get(control.words_received) == 1
        assert ctx.get(control.execution_reset)
        assert not ctx.get(board.runtime.program_commit)

        # Early release fails closed without reinitializing the transport epoch.
        ctx.set(board.maintenance_n, 1)
        await ctx.tick().repeat(20)
        assert ctx.get(control.state) == control.FAILED
        assert ctx.get(control.epoch) == 1
        assert ctx.get(control.execution_reset)
        ctx.set(board.maintenance_n, 0)
        await ctx.tick().repeat(20)
        assert ctx.get(control.state) == control.FAILED  # No automatic retry.
        await send(command(1, 1, 1, 65536))
        assert ctx.get(control.state) == control.LOADING
        assert ctx.get(control.epoch) == 2
        assert ctx.get(control.words_received) == 0

    sim.add_testbench(bench)
    sim.run()


def test_board_manifest_keeps_qualified_runtime_and_exact_pin_clock_profile():
    parent = ROOT.parent
    board = json.loads((parent / "board-source-manifest.json").read_text())
    runtime = json.loads((ROOT / "combined-source-manifest.json").read_text())
    assert board["runtimeSourceSha256"] == runtime["sourceConfigurationSha256"]
    for name, expected in runtime["files"].items():
        assert hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == expected
    for name, expected in board["files"].items():
        assert hashlib.sha256((parent / name).read_bytes()).hexdigest() == expected
    assert board["inputClockHz"] == 50_000_000
    assert board["executionClockHz"] == 25_000_000
    assert board["uartBaud"] == 57_600
    assert board["maintenance"] == dict(
        pin="M6", activeLow=True, holdRequired=True, resetsTransport=False)
    assert not board["vendorBuild"]
    assert not board["physicalTest"]
    text = (parent / "board.xdc").read_text()
    for pin, port in [("M21", "clk"), ("M6", "maintenance_n"),
                      ("F3", "uart_rx_pin"), ("E3", "uart_tx_pin")]:
        assert any(f"PACKAGE_PIN {pin} " in line and
                   f"[get_ports {port}]" in line for line in text.splitlines())
    assert "create_clock -name sys_clk_pin -period 20.000" in text
    assert "PULLUP TRUE" in text
