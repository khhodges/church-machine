"""Actual ChurchCore events feeding the same LED wiring as the candidate top."""
import pytest
from amaranth import Signal
from amaranth.sim import Simulator

from hardware.thread_status_leds import ThreadStatusLEDs
from hardware.test_boot_rom_no_false_halt import BootRomHarness
from hardware.test_wukong_thread_scheduler_contract import _thread_switch_core_image


class StatusHarness(BootRomHarness):
    def __init__(self, dmem):
        super().__init__(dmem)
        self.status = ThreadStatusLEDs(clock_hz=16)
        self.clear = Signal()

    def elaborate(self, platform):
        m = super().elaborate(platform)
        m.submodules.status = self.status
        self.status.connect_core(m, self.core)
        m.d.comb += self.status.monitor_clear.eq(self.clear)
        return m


@pytest.mark.parametrize("decoded", [True, False])
def test_real_change_counts_once_external_switch_does_not(decoded):
    dmem, source, _, target, instruction, _, _ = _thread_switch_core_image(decoded)
    dut = StatusHarness(dmem)

    async def bench(ctx):
        for _ in range(1000):
            if ctx.get(dut.core.nia) == source:
                break
            await ctx.tick()
        else:
            pytest.fail("source not reached")
        # The real boot CHANGE is counted, not suppressed by boot UI.
        baseline = ctx.get(dut.status.count)
        assert baseline == 1
        if not decoded:
            ctx.set(dut.core.thread_switch_index, 11)
            ctx.set(dut.core.thread_switch_req, 1)
            for _ in range(20):
                await ctx.delay(1e-9)
                if ctx.get(dut.core.thread_switch_busy):
                    await ctx.tick()
                    break
                await ctx.tick()
            else:
                pytest.fail("scheduler request not accepted")
            ctx.set(dut.core.thread_switch_req, 0)
        pulses = 0
        for _ in range(3000):
            pulses += ctx.get(dut.core.change_instruction_complete)
            assert not ctx.get(dut.core.fault_valid)
            if (ctx.get(dut.core.retire_valid)
                    and ctx.get(dut.core.retire_nia) == target
                    and ctx.get(dut.core.retire_instr) == instruction):
                await ctx.tick()
                break
            await ctx.tick()
        else:
            pytest.fail("target did not execute")
        assert pulses == int(decoded)
        assert ctx.get(dut.status.count) == baseline + int(decoded)
        for _ in range(20):
            await ctx.tick()
            assert ctx.get(dut.status.count) == baseline + int(decoded)
            assert not ctx.get(dut.status.fault_pending)
    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()


def test_real_failed_change_latches_blinks_and_does_not_increment():
    dmem, source, *_ = _thread_switch_core_image(True, corruption="null_egt")
    dut = StatusHarness(dmem)

    async def bench(ctx):
        ctx.set(dut.core.defer_fault_reset, 1)
        for _ in range(1000):
            if ctx.get(dut.core.nia) == source:
                break
            await ctx.tick()
        else:
            pytest.fail("source not reached")
        baseline = ctx.get(dut.status.count)
        for _ in range(3000):
            assert not ctx.get(dut.core.change_instruction_complete)
            if ctx.get(dut.core.fault_valid):
                await ctx.tick()
                break
            await ctx.tick()
        else:
            pytest.fail("invalid CHANGE did not fault")
        assert ctx.get(dut.status.fault_pending)
        samples = set()
        for _ in range(16):
            samples.add(ctx.get(dut.status.led_on))
            assert ctx.get(dut.status.count) == baseline
            await ctx.tick()
        assert samples == {0, 3}
        # The core fault event is a pulse, not the retained LED state.
        # Clear only after it deasserts; preserve retained diagnostic fields.
        assert not ctx.get(dut.core.fault_valid)
        evidence = tuple(ctx.get(s) for s in (
            dut.core.fault_gt, dut.core.fault_instr,
            dut.core.fault_cr14, dut.core.fault_stage))
        ctx.set(dut.clear, 1)
        await ctx.tick()
        assert not ctx.get(dut.status.fault_pending)
        assert ctx.get(dut.status.led_on) == baseline
        assert tuple(ctx.get(s) for s in (
            dut.core.fault_gt, dut.core.fault_instr,
            dut.core.fault_cr14, dut.core.fault_stage)) == evidence
    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()


@pytest.mark.parametrize("faulting", [False, True])
def test_candidate_wukong_pins_use_real_core_events(faulting):
    from hardware.wukong_top import ChurchWukongXC7A100T

    dmem, *_ = _thread_switch_core_image(
        True, corruption="null_egt" if faulting else None)
    dut = ChurchWukongXC7A100T(
        clk_freq=160, baud=40, sim_mode=True, phase2_status_leds=True,
        sim_boot_image_words=dmem)

    async def bench(ctx):
        # Full trace packets serialize over UART and deliberately stall fetch.
        # Allow their real backpressure to drain; do not bypass halt controls.
        for _ in range(60000):
            if ((faulting and ctx.get(dut.sim_status_leds.fault_pending))
                    or (not faulting and ctx.get(dut.sim_status_leds.count) == 2)):
                break
            await ctx.tick()
        else:
            pytest.fail(
                f"candidate wrapper event missing: nia={ctx.get(dut.sim_core.nia):#x}, "
                f"boot={ctx.get(dut.sim_core.boot_complete)}, "
                f"fault={ctx.get(dut.sim_core.fault)}, "
                f"count={ctx.get(dut.sim_status_leds.count)}, "
                f"pending={ctx.get(dut.sim_status_leds.fault_pending)}")
        assert ctx.get(dut.sim_status_leds.count) == (1 if faulting else 2)
        samples = set()
        for _ in range(90):
            pins = ctx.get(dut.led[0]) | (ctx.get(dut.led[1]) << 1)
            assert pins == ctx.get(dut.sim_status_leds.led_pins)
            samples.add(pins)
            await ctx.tick()
        assert samples == ({0, 3} if faulting else {1})
        if faulting:
            # A test-only authorized-clear stimulus, not a software ABI.
            ctx.set(dut.sim_status_monitor_clear, 1)
            await ctx.tick()
            assert not ctx.get(dut.sim_status_leds.fault_pending)
            assert ctx.get(dut.sim_status_leds.count) == 1
    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()
