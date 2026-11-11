"""Run from the frozen package's source directory; no vendor or physical access."""
import hashlib
import json
from pathlib import Path

from amaranth.sim import Simulator
from hardware.combined_board import CombinedStarterBoard
from hardware.starter_transport import command


ROOT = Path.cwd()


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
