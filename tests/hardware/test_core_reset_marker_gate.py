"""The real core must not decode the reset marker as an ordinary CHANGE."""
import pytest
from amaranth.sim import Simulator
from hardware.core import ChurchCore
from hardware.hw_types import FaultType
from hardware.sim_boot_helpers import boot_core


@pytest.mark.parametrize("rom_tag", [0, 1])
def test_unadmitted_marker_faults_without_change_or_memory_writes(rom_tag):
    core = ChurchCore()
    sim = Simulator(core)
    sim.add_clock(1e-6)

    async def bench(ctx):
        # Match Wukong's explicit snapshot-and-hold policy, rather than the
        # standalone core's default automatic fault reset.
        ctx.set(core.defer_fault_reset, 1)
        await boot_core(ctx, core)
        # Bootstrap's DWRITE can still have a completion tail on boot_complete.
        # Do not issue an instruction until that shared-unit tail is drained.
        for _ in range(3):
            await ctx.tick()
        # Attempt the exact designated marker position; ROM address and tag
        # must still not grant admission without a checked Namespace.
        ctx.set(core.free_run_nia, 4)
        ctx.set(core.free_run_start, 1)
        await ctx.tick()
        ctx.set(core.free_run_start, 0)
        initial_m = ctx.get(core.dbg_m_bit_state)
        initial_pc = ctx.get(core.imem_addr)
        ctx.set(core.imem_from_reset_rom, rom_tag)
        ctx.set(core.imem_fetch_address, 4)
        ctx.set(core.imem_data, 0x27000001)
        ctx.set(core.imem_valid, 1)
        # Boot completion, a ROM tag, and initialized M bits do not stand in
        # for guarded Namespace admission. Even repeated issue stays rejected.
        for cycle in range(4):
            assert ctx.get(core.fault_valid), (cycle, ctx.get(core.imem_addr))
            assert ctx.get(core.fault) == FaultType.INVALID_OP
            assert not ctx.get(core.dmem_wr_en)
            assert not ctx.get(core.ns_wr_en)
            assert not ctx.get(core.clist_wr_en)
            assert ctx.get(core.dbg_m_bit_state) == initial_m
            assert ctx.get(core.imem_addr) == initial_pc
            await ctx.tick()

    sim.add_testbench(bench)
    sim.run()
