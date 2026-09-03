"""Full-top RTL regression for the Wukong UART execution controls.

This deliberately drives the production ``ChurchWukongXC7A100T`` instead of
testing a small command-parser harness.  A bridge serial-write ACK only proves
that the host wrote to its serial device, so these tests verify the next
boundary: the real UART receiver decodes execution-control bytes and the
top-level state changes.
"""

import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from amaranth.sim import Simulator
from amaranth.hdl._ast import Operator, SwitchValue
import amaranth.hdl._dsl as _amaranth_dsl
from amaranth.hdl._xfrm import DomainCollector, ValueTransformer
import amaranth.hdl._ir as _amaranth_ir

from hardware.wukong_top import ChurchWukongXC7A100T


def _memoize_amaranth_shapes():
    """Apply the production top's safe identity caches before elaboration."""
    if getattr(Operator.shape, "_wukong_cached", False):
        return
    original_operator_shape = Operator.shape
    original_switch_shape = SwitchValue.shape
    original_check_rhs = _amaranth_dsl._check_rhs
    original_domain_on_value = DomainCollector.on_value
    original_transform_on_value = ValueTransformer.on_value
    original_collect_signals = _amaranth_ir.Design._collect_used_signals_value

    def cached_operator_shape(self):
        try:
            return self._shape_cache
        except AttributeError:
            self._shape_cache = original_operator_shape(self)
            return self._shape_cache

    def cached_switch_shape(self):
        try:
            return self._shape_cache
        except AttributeError:
            self._shape_cache = original_switch_shape(self)
            return self._shape_cache

    checked_ids = set()

    def cached_check_rhs(value):
        value_id = id(value)
        if value_id in checked_ids:
            return
        checked_ids.add(value_id)
        return original_check_rhs(value)

    def cached_domain_on_value(self, value):
        seen = getattr(self, "_wukong_seen_values", None)
        if seen is None:
            seen = self._wukong_seen_values = set()
        if id(value) in seen:
            return
        seen.add(id(value))
        return original_domain_on_value(self, value)

    def cached_transform_on_value(self, value):
        cache = getattr(self, "_wukong_value_cache", None)
        if cache is None:
            cache = self._wukong_value_cache = {}
        key = id(value)
        if key not in cache:
            cache[key] = original_transform_on_value(self, value)
        return cache[key]

    def cached_collect_signals(self, fragment, value):
        seen = getattr(self, "_wukong_collect_seen", None)
        if seen is None:
            seen = self._wukong_collect_seen = set()
        key = (id(fragment), id(value))
        if key in seen:
            return
        seen.add(key)
        return original_collect_signals(self, fragment, value)

    cached_operator_shape._wukong_cached = True
    Operator.shape = cached_operator_shape
    SwitchValue.shape = cached_switch_shape
    _amaranth_dsl._check_rhs = cached_check_rhs
    DomainCollector.on_value = cached_domain_on_value
    ValueTransformer.on_value = cached_transform_on_value
    _amaranth_ir.Design._collect_used_signals_value = cached_collect_signals


def _uart_frame(byte):
    """Return one active-low-start, LSB-first 8N1 frame."""
    return [0] + [(byte >> bit) & 1 for bit in range(8)] + [1]


def test_full_top_uart_step_pauses_run_and_advances_once():
    """``s`` pauses Run and advances exactly one instruction when paused."""
    _memoize_amaranth_shapes()
    clk_freq = 100
    # Keep the production UART framing while making the simulated trace
    # transmitter drain quickly enough for this full-top test.  At baud=1 the
    # trace backpressure holds the core for many thousands of cycles per event,
    # obscuring the post-reboot sequence even though the reboot succeeded.
    baud = 10
    bit_cycles = clk_freq // baud
    top = ChurchWukongXC7A100T(
        clk_freq=clk_freq,
        baud=baud,
        sim_mode=True,
    )
    result = {}

    async def drive(ctx):
        ctx.set(top.uart_rx_pin, 1)

        # Let the production top settle and run freely before sending Step as
        # the universal Run → Pause control.
        for _ in range(30_000):
            await ctx.tick()
        result["before"] = (
            ctx.get(top.step_mode),
            ctx.get(top.step_halted),
        )

        for level in _uart_frame(ord("s")):
            ctx.set(top.uart_rx_pin, level)
            for _ in range(bit_cycles):
                await ctx.tick()

        # UartRx presents valid for one cycle after the stop bit; allow the
        # command parser and state registers to consume that event.
        for _ in range(3_000):
            await ctx.tick()
        result["after"] = (
            ctx.get(top.step_mode),
            ctx.get(top.step_halted),
        )
        result["paused_nia"] = ctx.get(top.dbg_nia)

        # From the paused state, the same 's' command must release exactly one
        # retirement and return to the paused state.
        for level in _uart_frame(ord("s")):
            ctx.set(top.uart_rx_pin, level)
            for _ in range(bit_cycles):
                await ctx.tick()
        for _ in range(3_000):
            await ctx.tick()
        result["after_step"] = (
            ctx.get(top.step_mode),
            ctx.get(top.step_halted),
            ctx.get(top.dbg_nia),
        )

        # Run resumes freely; a later 's' must pause it again at a boundary.
        for level in _uart_frame(ord("r")):
            ctx.set(top.uart_rx_pin, level)
            for _ in range(bit_cycles):
                await ctx.tick()
        for _ in range(3_000):
            await ctx.tick()
        result["running"] = (
            ctx.get(top.step_mode),
            ctx.get(top.step_halted),
        )

        for level in _uart_frame(ord("s")):
            ctx.set(top.uart_rx_pin, level)
            for _ in range(bit_cycles):
                await ctx.tick()
        for _ in range(3_000):
            await ctx.tick()
        result["paused_again"] = (
            ctx.get(top.step_mode),
            ctx.get(top.step_halted),
        )

    sim = Simulator(top)
    sim.add_clock(1e-6)
    sim.add_testbench(drive)
    sim.run()

    assert result["before"] == (0, 0), (
        f"test setup did not reach free-run state: {result['before']}"
    )
    assert result["after"] == (1, 1), (
        f"UART Step did not pause the production top: {result['after']}"
    )
    assert result["after_step"][:2] == (1, 1), (
        f"UART Step did not return to the paused state: {result['after_step']}"
    )
    assert result["after_step"][2] != result["paused_nia"], (
        "UART Step from the paused state did not retire one instruction"
    )
    assert result["running"] == (0, 0), (
        f"UART Run did not resume free-run: {result['running']}"
    )
    assert result["paused_again"] == (1, 1), (
        f"UART Step did not pause Run again: {result['paused_again']}"
    )


def test_full_top_uart_halt_emits_board_evidence():
    """Nonce-bearing Halt emits the complete wire-format evidence frame."""
    _memoize_amaranth_shapes()
    clk_freq = 100
    baud = 10
    bit_cycles = clk_freq // baud
    top = ChurchWukongXC7A100T(clk_freq=clk_freq, baud=baud, sim_mode=True)
    tx_bytes = []
    result = {}

    async def capture_uart(ctx):
        """Decode real 8N1 frames from the production UART TX pin."""
        while True:
            if ctx.get(top.uart_tx_pin) == 0:
                # Start in the middle of data bit zero, then sample each bit.
                for _ in range(bit_cycles + bit_cycles // 2):
                    await ctx.tick()
                value = 0
                for bit in range(8):
                    value |= (ctx.get(top.uart_tx_pin) & 1) << bit
                    for _ in range(bit_cycles):
                        await ctx.tick()
                tx_bytes.append(value)
                for _ in range(bit_cycles // 2):
                    await ctx.tick()
            else:
                await ctx.tick()

    async def drive(ctx):
        ctx.set(top.uart_rx_pin, 1)
        for _ in range(30_000):
            await ctx.tick()
        for level in _uart_frame(ord("h")):
            ctx.set(top.uart_rx_pin, level)
            for _ in range(bit_cycles):
                await ctx.tick()
        for level in _uart_frame(0x09):
            ctx.set(top.uart_rx_pin, level)
            for _ in range(bit_cycles):
                await ctx.tick()
        for _ in range(3_000):
            await ctx.tick()
        result["state"] = (
            ctx.get(top.step_mode),
            ctx.get(top.step_halted),
            ctx.get(top.dbg_halt_state_emitted),
        )

    sim = Simulator(top)
    sim.add_clock(1e-6)
    sim.add_testbench(drive)
    sim.add_testbench(capture_uart, background=True)
    sim.run()

    assert result["state"] == (1, 1, 1), (
        "Halt must latch the stopped state and drain its board-evidence frame"
    )
    expected = [0xAD, 0x01, 0x01, 0x01, 0x09, 0xA5]
    assert any(tx_bytes[i:i + len(expected)] == expected
               for i in range(len(tx_bytes) - len(expected) + 1)), (
        "UART TX did not emit all six nonce-bound halt evidence bytes: "
        f"{[f'0x{byte:02X}' for byte in tx_bytes]}"
    )


def test_full_top_uart_missing_halt_nonce_times_out_and_recovers():
    """A lost nonce cannot halt the CM or consume the next execution command."""
    _memoize_amaranth_shapes()
    clk_freq = 100
    baud = 10
    bit_cycles = clk_freq // baud
    top = ChurchWukongXC7A100T(clk_freq=clk_freq, baud=baud, sim_mode=True)
    result = {}

    async def send_uart_byte(ctx, byte):
        for level in _uart_frame(byte):
            ctx.set(top.uart_rx_pin, level)
            for _ in range(bit_cycles):
                await ctx.tick()

    async def drive(ctx):
        ctx.set(top.uart_rx_pin, 1)
        for _ in range(30_000):
            await ctx.tick()
        result["before"] = (
            ctx.get(top.step_mode),
            ctx.get(top.step_halted),
        )

        # Drop the nonce byte.  The parser must return to IDLE without
        # changing execution state or creating halt evidence.
        await send_uart_byte(ctx, ord("h"))
        # The production timeout has a 256-cycle safety floor at low
        # simulation clock rates.
        for _ in range(max(256, top.clk_freq // 100) + 100):
            await ctx.tick()
        result["after_timeout"] = (
            ctx.get(top.step_mode),
            ctx.get(top.step_halted),
            ctx.get(top.dbg_halt_state_emitted),
        )

        # Both normal execution controls must work after the partial-frame
        # timeout; first prove Step is accepted, then Run restores free-run.
        await send_uart_byte(ctx, ord("s"))
        for _ in range(3_000):
            await ctx.tick()
        result["after_step"] = (
            ctx.get(top.step_mode),
            ctx.get(top.step_halted),
        )
        await send_uart_byte(ctx, ord("r"))
        for _ in range(3_000):
            await ctx.tick()
        result["after_run"] = (
            ctx.get(top.step_mode),
            ctx.get(top.step_halted),
        )

    sim = Simulator(top)
    sim.add_clock(1e-6)
    sim.add_testbench(drive)
    sim.run()

    assert result["before"] == (0, 0), result
    assert result["after_timeout"] == (0, 0, 0), (
        "a missing Halt nonce must leave execution unchanged: "
        f"{result}"
    )
    assert result["after_step"] == (1, 1), (
        "Step was not accepted after partial Halt recovery"
    )
    assert result["after_run"] == (0, 0), (
        "Run was not accepted after partial Halt recovery"
    )


def test_full_top_uart_reboot_restarts_at_lump_entry():
    """A real-format ``f`` byte must reboot through Boot.0/1/2 and re-enter WCH.

    This is intentionally a production-top test rather than a ChurchCore-only
    test.  It covers the UART command parser, the one-cycle ``cm_reboot`` pulse,
    the FAULT_RST boot ladder, the synchronous instruction-fetch settle bubble,
    and the CALL entry-point handoff.  ``dbg_nia`` is the top-level retired-NIA
    observation port, so the first post-reboot sequence must be:

        Boot.0/1/2: 0x00000000, 0x00000004, 0x00000008
        WukongCallHome.1: 0x00000704

    In particular, a previous loop address such as 0x000007FC must not survive
    the reboot and become the first abstraction NIA.
    """
    _memoize_amaranth_shapes()
    clk_freq = 100
    # The top-level trace UART shares the simulated clock with the command
    # receiver.  Use a faster simulated baud so trace backpressure does not
    # hide the post-reboot retires while preserving the same 8N1 framing.
    baud = 10
    bit_cycles = clk_freq // baud
    top = ChurchWukongXC7A100T(
        clk_freq=clk_freq,
        baud=baud,
        sim_mode=True,
    )
    result = {"post_reboot_nias": []}

    async def observe_tick(ctx, previous_boot, previous_nia):
        """Advance one cycle and record the reboot edge/retired NIA."""
        await ctx.tick()
        boot_complete = bool(ctx.get(top.dbg_boot_complete))

        # Reboot is intentionally a short transition through the boot ladder;
        # clear the NIA capture as soon as the production top drops out of the
        # post-boot state.
        if previous_boot and not boot_complete:
            result["saw_boot_restart"] = True
            result["post_reboot_nias"].clear()
            previous_nia = None

        if result.get("saw_boot_restart") and boot_complete:
            nia = ctx.get(top.dbg_nia)
            if previous_nia is None or nia != previous_nia:
                result["post_reboot_nias"].append(nia)
                previous_nia = nia

        return boot_complete, previous_nia

    async def send_uart_byte(ctx, byte, previous_boot, previous_nia):
        for level in _uart_frame(byte):
            ctx.set(top.uart_rx_pin, level)
            for _ in range(bit_cycles):
                previous_boot, previous_nia = await observe_tick(
                    ctx, previous_boot, previous_nia
                )
        return previous_boot, previous_nia

    async def drive(ctx):
        ctx.set(top.uart_rx_pin, 1)

        # Let the first boot finish and run well into the WukongCallHome loop.
        for _ in range(30_000):
            await ctx.tick()

        # Send the same byte produced by the bridge's Reboot command.
        previous_boot = bool(ctx.get(top.dbg_boot_complete))
        previous_nia = None
        previous_boot, previous_nia = await send_uart_byte(
            ctx, ord("f"), previous_boot, previous_nia
        )

        # The command is consumed during the frame, but allow the boot ladder
        # and CALL FSM to finish if the UART completion arrived near the frame
        # boundary.
        for _ in range(20_000):
            previous_boot, previous_nia = await observe_tick(
                ctx, previous_boot, previous_nia
            )
            if len(result["post_reboot_nias"]) >= 4:
                return

    sim = Simulator(top)
    sim.add_clock(1e-6)
    sim.add_testbench(drive)
    sim.run()

    assert result.get("saw_boot_restart"), (
        "UART Reboot did not drive the production top back through FAULT_RST"
    )
    assert result["post_reboot_nias"][:4] == [
        0x00000000,
        0x00000004,
        0x00000008,
        0x00000704,
    ], (
        "post-reboot NIA sequence did not restart at the LUMP entry: "
        f"{[f'0x{nia:08X}' for nia in result['post_reboot_nias']]}"
    )