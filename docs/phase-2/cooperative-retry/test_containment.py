"""Expire the real timer during an actual CHANGE save, without forcing signals."""
from amaranth.sim import Simulator
from hardware.core import ChurchCore
from hardware.hw_types import FaultType
from hardware.test_phase2_guarded_llr import guarded_fixture, GUARD


def run_change(period, expire=False):
    core = ChurchCore(expected_boot_guard=GUARD, watchdog_clock_hz=period)
    sim = Simulator(core)
    sim.add_clock(1e-6)
    mem = guarded_fixture()
    write_ages = []

    async def bench(ctx):
        async def tick():
            rd = ctx.get(core.dmem_addr) if ctx.get(core.dmem_rd_en) else None
            data = mem.get(rd, 0)
            if ctx.get(core.dmem_wr_en):
                if ctx.get(core.sim_watchdog.active):
                    write_ages.append(period - ctx.get(core.sim_watchdog.remaining) + 1)
                mem[ctx.get(core.dmem_addr)] = ctx.get(core.dmem_wr_data)
            await ctx.tick()
            ctx.set(core.dmem_rd_valid, rd is not None)
            ctx.set(core.dmem_rd_data, data)

        async def issue(word, finish):
            address = ctx.get(core.imem_addr)
            ctx.set(core.imem_data, word)
            ctx.set(core.imem_fetch_address, address)
            ctx.set(core.imem_from_reset_rom, address in (4, 8))
            ctx.set(core.imem_valid, 1)
            for _ in range(3000):
                if ctx.get(core.fault_valid):
                    assert expire and ctx.get(core.fault) == FaultType.WATCHDOG
                    assert ctx.get(core.sim_change_busy), "Must expire mid-CHANGE"
                    frozen = dict(mem)
                    for _ in range(100):
                        assert not ctx.get(core.dmem_wr_en)
                        assert not ctx.get(core.ns_wr_en)
                        assert not ctx.get(core.clist_wr_en)
                        assert not ctx.get(core.sim_pet_write)
                        await tick()
                    assert mem == frozen
                    assert ctx.get(core.sim_watchdog.expired)
                    return False
                done = finish()
                await tick()
                ctx.set(core.imem_valid, 0)
                if done:
                    for _ in range(3):
                        await tick()
                    return True
            raise AssertionError("Instruction did not complete")

        ctx.set(core.defer_fault_reset, 1)
        ctx.set(core.boot_start, 1)
        await tick()
        ctx.set(core.boot_start, 0)
        for _ in range(3000):
            if ctx.get(core.boot_thread_validated):
                break
            await tick()
        else:
            raise AssertionError("Boot did not validate")
        assert await issue(0x27000001, lambda: ctx.get(core.boot_thread_activated))
        assert await issue(0x17000001, lambda: ctx.get(core.boot_complete))
        assert await issue(mem[0x2008], lambda: ctx.get(core.retire_valid))
        completed = await issue(mem[0x200C], lambda: ctx.get(core.retire_valid))
        assert completed != expire
    sim.add_testbench(bench)
    sim.run()
    return write_ages


def test_change_save_expiry_boundaries(record_property):
    ages = run_change(10000)
    assert len(ages) > 4
    selected = [ages[0], ages[len(ages) // 2], ages[-1]]
    for deadline in selected:
        writes = run_change(deadline, expire=True)
        assert all(age < deadline for age in writes)
    record_property("change_save_expiry_deadlines", selected)
