"""Characterize the current candidate; these are not new loader acceptance tests.

No board, serial, network, build, or runtime-memory access.
The timer test is RTL-unit evidence; routing checks are source-level evidence.
"""
from fractions import Fraction
from pathlib import Path

from amaranth.sim import Simulator
from fixed_watchdog import FixedWatchdog


ROOT = Path(__file__).resolve().parents[3]
CANDIDATE = ROOT / "generated-artifacts/starter-side-by-side-candidate/hardware"


def test_native_image_cannot_fit_inside_fixed_watchdog_interval():
    # UART 8N1: start + eight data + stop. No protocol overhead, stalls,
    # acknowledgements or host delay included: this is a strict lower bound.
    transfer_seconds = Fraction(65536 * 10, 57600)
    assert transfer_seconds > 11
    assert transfer_seconds > 1
    assert Fraction(57600, 10) < 65536


def test_execution_stop_without_transitions_does_not_suspend_timer():
    # Scale clock and one-second timer together; keep the actual RTL logic.
    hz = 1000
    dut = FixedWatchdog(clock_hz=hz)
    sim = Simulator(dut)
    sim.add_clock(1 / hz)

    async def bench(ctx):
        ctx.set(dut.execution_start, 1)
        await ctx.tick()
        ctx.set(dut.execution_start, 0)
        assert ctx.get(dut.active)
        assert ctx.get(dut.remaining) == hz
        # Stopped execution cannot complete CHANGE/SWITCH. The ungated
        # clock still runs, as required by the existing candidate.
        ctx.set(dut.transition_complete, 0)
        await ctx.tick().repeat(hz - 1)
        assert ctx.get(dut.expiry)
        assert ctx.get(dut.block_program_writes)
        await ctx.tick()
        assert ctx.get(dut.expired)
        # A later execution-start pulse is NOT a reset/recovery mechanism.
        ctx.set(dut.execution_start, 1)
        await ctx.tick().repeat(20)
        assert ctx.get(dut.expired)
        assert ctx.get(dut.block_program_writes)

    sim.add_testbench(bench)
    sim.run()


def test_isolated_candidate_exposes_current_integration_obstacles():
    # Fail if the isolated candidate is missing; do not silently substitute
    # production hardware or another candidate.
    top = (CANDIDATE / "wukong_top.py").read_text()
    core = (CANDIDATE / "core.py").read_text()
    watchdog = (CANDIDATE / "fixed_watchdog.py").read_text()
    assert watchdog == (Path(__file__).parent / "fixed_watchdog.py").read_text()
    assert "command_rx_valid = uart_rx.valid & Const(not self.diagnostic_uart_receive)" in top
    assert "watchdog.execution_start.eq(self.boot_complete & ~execution_started)" in core
    assert "watchdog.transition_complete.eq(" in core
    # This is characterization of the old topology, not a release condition:
    # replace it with behavioral acceptance checks after the architecture changes.
