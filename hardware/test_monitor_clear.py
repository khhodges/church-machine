"""Local protected-port evidence; no saved grants or board operations."""
import pytest
from amaranth import Elaboratable, Module
from amaranth.sim import Simulator

from hardware.core import ChurchCore
from hardware.dwrite import ChurchDWrite
from hardware.hw_types import (
    MONITOR_CLEAR_PORT, GT_TYPE_INFORM, GT_TYPE_ABSTRACT,
    PERM_MASK_W, FaultType, make_gt,
)
from hardware.thread_status_leds import ThreadStatusLEDs
from hardware.sim_boot_helpers import boot_core
from hardware.test_phase1_independent_execution import execute_data
from tests.hardware.test_data_access_full_width import run_access


def cap(base=MONITOR_CLEAR_PORT, limit=0, perms=PERM_MASK_W, typ=GT_TYPE_INFORM):
    return make_gt(typ, perms, 3) | (base << 32) | (limit << 64)


@pytest.mark.parametrize("capability,value,imm,enabled,error", [
    (cap(), 1, 0, True, None),
    (cap(), 0, 0, True, FaultType.INVALID_OP),
    (cap(), 2, 0, True, FaultType.INVALID_OP),
    (cap(), 0x80000001, 0, True, FaultType.INVALID_OP),
    (cap(), 1, 0, False, FaultType.INVALID_OP),
    (0, 1, 0, True, FaultType.NULL_CAP),
    (cap(perms=0), 1, 0, True, FaultType.PERM_W),
    (cap(typ=GT_TYPE_ABSTRACT), 1, 0, True, FaultType.INVALID_OP),
    (cap(limit=1), 1, 0, True, FaultType.INVALID_OP),
    (cap(), 1, 16, True, FaultType.BOUNDS),
    (cap(base=MONITOR_CLEAR_PORT - 4, limit=1), 1, 16, True, FaultType.INVALID_OP),
])
def test_admission_and_accepted_input_capture(capability, value, imm, enabled, error):
    dut = ChurchDWrite(monitor_clear_enabled=enabled)

    async def bench(ctx):
        ctx.set(dut.cr_rd_data.as_value(), capability)
        ctx.set(dut.dr_rd_data, value)
        ctx.set(dut.imm, imm)
        ctx.set(dut.start, 1)
        await ctx.tick()
        ctx.set(dut.start, 0)
        # Neither revoked live inputs nor repaired live inputs change admission.
        ctx.set(dut.cr_rd_data.as_value(), cap() if error else 0)
        ctx.set(dut.dr_rd_data, 1 if error else 99)
        ctx.set(dut.imm, 0)
        pulses, done, faults = 0, 0, []
        for _ in range(8):
            pulses += ctx.get(dut.monitor_clear)
            done += ctx.get(dut.done)
            assert not ctx.get(dut.dmem_wr_en)
            assert not ctx.get(dut.m_bit_wr_en)
            if ctx.get(dut.fault):
                faults.append(ctx.get(dut.fault_type))
            await ctx.tick()
        assert pulses == done == int(error is None)
        assert faults == ([] if error is None else [error])
    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()


def test_read_rejected_without_register_write():
    observed = run_access("read", base=MONITOR_CLEAR_PORT, limit=0)
    assert observed["fault"] == FaultType.INVALID_OP
    assert observed["done"] == 0
    assert observed["reads"] == observed["register_writes"] == []


@pytest.mark.parametrize("address", [
    MONITOR_CLEAR_PORT - 1, MONITOR_CLEAR_PORT + 1,
    MONITOR_CLEAR_PORT - 64, 0x40000019,
])
def test_neighboring_and_legacy_addresses_do_not_clear(address):
    dut = ChurchDWrite(monitor_clear_enabled=True)

    async def bench(ctx):
        ctx.set(dut.cr_rd_data.as_value(), cap(base=address))
        ctx.set(dut.dr_rd_data, 1)
        ctx.set(dut.start, 1)
        await ctx.tick()
        ctx.set(dut.start, 0)
        for _ in range(8):
            assert not ctx.get(dut.monitor_clear)
            await ctx.tick()
    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()


class CoreStatus(Elaboratable):
    def __init__(self):
        self.core = ChurchCore(monitor_clear_enabled=True)
        self.status = ThreadStatusLEDs(clock_hz=16)

    def elaborate(self, platform):
        m = Module()
        m.submodules.core = self.core
        m.submodules.status = self.status
        self.status.connect_core(m, self.core)
        m.d.comb += self.status.monitor_clear.eq(self.core.monitor_clear)
        return m


def test_real_instruction_clears_preserves_evidence_and_continues():
    dut = CoreStatus()
    core, status = dut.core, dut.status

    async def bench(ctx):
        ctx.set(core.defer_fault_reset, 1)
        await boot_core(ctx, core)
        # Establish a real fault record, not a forced LED latch.
        ctx.set(core.imem_data, (17 << 27) | (14 << 23) | (4 << 19) | (3 << 15))
        ctx.set(core.imem_valid, 1)
        await ctx.tick()
        ctx.set(core.imem_valid, 0)
        for _ in range(12):
            await ctx.tick()
        assert ctx.get(status.fault_pending)
        evidence = tuple(ctx.get(s) for s in
                         (core.fault_gt, core.fault_instr, core.fault_cr14, core.fault_stage))
        baseline = ctx.get(status.count)
        await execute_data(ctx, core, 0xAF004000 | (4 << 19) | 1)
        ctx.set(core.dbg_cr_wr_en, 1)
        ctx.set(core.dbg_cr_wr_addr, 3)
        ctx.set(core.dbg_cr_wr_data.as_value(), cap())
        await ctx.tick()
        ctx.set(core.dbg_cr_wr_en, 0)
        ctx.set(core.imem_data, (17 << 27) | (14 << 23) | (4 << 19) | (3 << 15))
        ctx.set(core.imem_valid, 1)
        await ctx.tick()
        ctx.set(core.imem_valid, 0)
        pulses = 0
        for _ in range(12):
            assert not ctx.get(core.fault_valid)
            assert not ctx.get(core.dmem_wr_en)
            pulses += ctx.get(core.monitor_clear)
            await ctx.tick()
        assert pulses == 1
        assert not ctx.get(status.fault_pending)
        assert ctx.get(status.count) == baseline
        assert ctx.get(status.led_on) == baseline
        assert tuple(ctx.get(s) for s in
                     (core.fault_gt, core.fault_instr, core.fault_cr14, core.fault_stage)) == evidence
        # Healthy execution continues without reset or a special resume.
        await execute_data(ctx, core, 0xAF004000 | (4 << 19) | 7)
        assert ctx.get(core.debug_dr_words[4]) == 7
    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()


def test_wrapper_decoded_dwrite_uses_hardware_path():
    from hardware.wukong_top import ChurchWukongXC7A100T
    from hardware.test_wukong_thread_scheduler_contract import _thread_switch_core_image

    image, entry, *_ = _thread_switch_core_image(False)
    image[entry // 4] = 0xAF004000 | (4 << 19) | 1
    image[entry // 4 + 1] = (17 << 27) | (14 << 23) | (4 << 19) | (3 << 15)
    image[entry // 4 + 2] = 0xCF000000  # terminal branch
    dut = ChurchWukongXC7A100T(
        clk_freq=160, baud=40, sim_mode=True, phase2_status_leds=True,
        sim_boot_image_words=image)

    async def bench(ctx):
        for _ in range(60000):
            if ctx.get(dut.sim_core.nia) == entry:
                break
            await ctx.tick()
        else:
            pytest.fail("source not reached")
        # Test-fixture provisioning only; never grant an ordinary live caller.
        ctx.set(dut.sim_core.dbg_cr_wr_en, 1)
        ctx.set(dut.sim_core.dbg_cr_wr_addr, 3)
        ctx.set(dut.sim_core.dbg_cr_wr_data.as_value(), cap())
        await ctx.tick()
        ctx.set(dut.sim_core.dbg_cr_wr_en, 0)
        for _ in range(60000):
            assert not ctx.get(dut.sim_status_monitor_clear)
            assert not ctx.get(dut.sim_core.fault_valid)
            if ctx.get(dut.sim_core.monitor_clear):
                assert ctx.get(dut.sim_status_leds.monitor_clear)
                assert not ctx.get(dut.sim_core.dmem_wr_en)
                count = ctx.get(dut.sim_status_leds.count)
                await ctx.tick()
                assert not ctx.get(dut.sim_status_leds.fault_pending)
                assert ctx.get(dut.sim_status_leds.count) == count
                return
            await ctx.tick()
        pytest.fail("decoded monitor clear did not reach wrapper")
    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()
