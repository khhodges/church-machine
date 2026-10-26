"""Reduced-clock input/primitive contracts, not vendor timing or physical proof."""
import pytest
from amaranth.back import rtlil
from hardware.guarded_build_profile import build_inputs, NAME, NAME_25
from hardware.wukong_top import ChurchWukongXC7A100T, WukongClock25
from amaranth import Module
from amaranth.sim import Simulator
from hardware.uart_tx import UartTx
from hardware.uart_rx import UartRx


def test_explicit_profile_preserves_image_and_changes_real_clock_mode():
    old, _ = build_inputs(NAME)
    args, record = build_inputs(NAME_25)
    assert args["runtime_image_words"] == old["runtime_image_words"]
    assert args["expected_boot_guard"] == old["expected_boot_guard"]
    assert args["clk_freq"] == record["clockHz"] == 25_000_000
    assert args["baud"] == old["baud"] == 57600
    assert args["clock_mode"] == "mmcm-25mhz"
    top = ChurchWukongXC7A100T(**args)
    top._MustUse__used = True
    assert top.button_debounce_cycles == 25000
    assert top.clk_freq // top.baud == 434


def test_constraint_only_slowdown_rejected():
    with pytest.raises(ValueError, match="physically 50"):
        ChurchWukongXC7A100T(clk_freq=25_000_000)
    with pytest.raises(ValueError, match="requires 25"):
        ChurchWukongXC7A100T(clock_mode="mmcm-25mhz")


def test_clock_uses_dedicated_resources_and_lock_gating():
    clock = WukongClock25()
    text = rtlil.convert(clock, ports=[clock.clk_in, clock.clk_out, clock.locked])
    assert 'cell \\MMCME2_BASE' in text
    assert 'cell \\IBUF' in text
    assert 'cell \\BUFGCE' in text
    assert 'cell \\BUFG ' in text
    assert 'parameter real \\CLKIN1_PERIOD "20.0"' in text
    assert 'parameter real \\CLKFBOUT_MULT_F "20.0"' in text
    assert 'parameter real \\CLKOUT0_DIVIDE_F "40.0"' in text
    assert 'connect \\CE \\locked' in text


def test_uart_25mhz_preserves_wire_rate_and_receive_bytes():
    tx = UartTx(clk_freq=25_000_000, baud=57600)
    rx = UartRx(clk_freq=25_000_000, baud=57600)
    m = Module()
    m.submodules.tx = tx
    m.submodules.rx = rx
    m.d.comb += rx.rx.eq(tx.tx)
    sim = Simulator(m)
    sim.add_clock(1 / 25_000_000)

    async def bench(ctx):
        for byte in (0x55, 0x00, 0xFF, 0xA5):
            ctx.set(tx.data, byte)
            ctx.set(tx.start, 1)
            await ctx.tick()
            ctx.set(tx.start, 0)
            expected = [0] + [(byte >> bit) & 1 for bit in range(8)] + [1]
            received = []
            for cycle in range(4340):
                assert ctx.get(tx.tx) == expected[cycle // 434]
                if ctx.get(rx.valid):
                    received.append(ctx.get(rx.data))
                await ctx.tick()
            for _ in range(10):
                if ctx.get(rx.valid):
                    received.append(ctx.get(rx.data))
                await ctx.tick()
            assert received == [byte]
    sim.add_testbench(bench)
    sim.run()
