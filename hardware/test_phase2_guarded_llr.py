"""Full guarded-core LLR execution from synthetic reset-admitted bytes.

No debug register writes, forced NIA, live artifacts, transport or board access.
"""
import pytest
from amaranth.sim import Simulator
from hardware.core import ChurchCore
from hardware.integrity32 import integrity32
from hardware.test_phase2_llr import fixture


GUARD = (46 << 9) | 419
USER_GT = 0x02070004
SYSTEM_GT = 0x03A30002
SYSTEM_EGT = 0x4A490003
CALL = 0x17100001
CHANGE_CR1 = 0x27008000


def guarded_fixture():
    mem = fixture(7)
    mem.update({0: 0xF8810100, 4: 0, 8: 5, 12: 0})
    for slot, version in [(1, 46), (2, 419), (3, 73), (4, 7), (5, 0), (6, 0)]:
        base = mem[slot * 16] >> 2
        limit = 255 if slot == 1 else mem[slot * 16 + 4] & 0x1FFFFF
        authority = limit | (version << 21)
        mem.update({slot * 16: base, slot * 16 + 4: authority,
                    slot * 16 + 8: integrity32(base, authority)})
    for offset in (242, 244):
        mem[0x1000 + offset * 4] = SYSTEM_EGT
    mem[0x1000 + 243 * 4] = 0x0FFFF0F3  # genuine initial root frame
    mem[0x2000 + 62 * 4] = SYSTEM_EGT
    mem[0x3000 + 245 * 4] = SYSTEM_GT
    mem[0x3000 + 243 * 4] = 0x10F3 | (1 << 13) | (9 << 28)
    # Literal executable words; fetch supplies exactly the addressed fixture.
    mem.update({0x2004: 2, 0x2008: 0xAF504007,  # IADD DR10,DR0,#7
                0x200C: CHANGE_CR1, 0x2010: CHANGE_CR1,
                0x4004: 2, 0x4008: CALL, 0x400C: 0xAF58400B})
    return mem


@pytest.mark.parametrize("case", ["resume", "stale_system", "bad_system_frame",
                                  "bad_owner", "bad_target", "system_absent"])
def test_guarded_startup_llr_and_original_call(case):
    mem = guarded_fixture()
    core = ChurchCore(expected_boot_guard=GUARD)

    async def bench(ctx):
        writes, retired = [], []
        async def tick():
            rd = ctx.get(core.dmem_addr) if ctx.get(core.dmem_rd_en) else None
            data = mem.get(rd, 0)
            if ctx.get(core.dmem_wr_en):
                addr, value = ctx.get(core.dmem_addr), ctx.get(core.dmem_wr_data)
                writes.append((addr, value))
                mem[addr] = value
            if ctx.get(core.retire_valid):
                retired.append((ctx.get(core.retire_nia), ctx.get(core.retire_instr)))
            assert not ctx.get(core.ns_wr_en)
            assert not ctx.get(core.clist_wr_en)
            await ctx.tick()
            ctx.set(core.dmem_rd_valid, rd is not None)
            ctx.set(core.dmem_rd_data, data)

        async def until(predicate, limit=3000):
            for i in range(limit):
                assert not ctx.get(core.fault_valid), (
                    case, i, hex(ctx.get(core.imem_addr)), ctx.get(core.fault))
                if predicate():
                    return
                await tick()
            pytest.fail("guarded transition timed out")

        async def issue(*, rom=None, finish=None, fault=None):
            address = ctx.get(core.imem_addr)
            word = mem[address] if rom is None else rom
            ctx.set(core.imem_data, word)
            ctx.set(core.imem_fetch_address, address)
            ctx.set(core.imem_from_reset_rom, rom is not None)
            ctx.set(core.imem_valid, 1)
            start = len(retired)
            for i in range(3000):
                if ctx.get(core.fault_valid):
                    assert fault is not None, (case, i, hex(address), hex(ctx.get(core.fault)))
                    assert ctx.get(core.fault) == fault
                    ctx.set(core.imem_valid, 0)
                    return
                done = finish() if finish else ctx.get(core.retire_valid)
                await tick()
                # Once accepted, later bus words must not redefine the instruction.
                ctx.set(core.imem_valid, 0)
                ctx.set(core.imem_data, 0xFFFFFFFF)
                if done:
                    assert fault is None
                    for _ in range(3):
                        await tick()
                        assert not ctx.get(core.fault_valid)
                    return retired[start:]
            pytest.fail("guarded instruction timed out")

        ctx.set(core.defer_fault_reset, 1)
        ctx.set(core.boot_start, 1)
        await tick()
        ctx.set(core.boot_start, 0)
        await until(lambda: ctx.get(core.boot_thread_validated))
        assert not writes and not ctx.get(core.boot_complete)
        assert ctx.get(core.boot_namespace_admitted)
        assert ctx.get(core.imem_addr) == 4
        await issue(rom=0x27000001, finish=lambda: ctx.get(core.boot_thread_activated))
        assert not writes
        assert ctx.get(core.imem_addr) == 8
        await issue(rom=0x17000001, finish=lambda: ctx.get(core.boot_complete))
        assert ctx.get(core.imem_addr) == 0x2008
        assert ctx.get(core.debug_cr_words[12][0]) == SYSTEM_GT
        assert not ctx.get(core.boot_marker_available)
        await issue()  # set SYSTEM flags with an actual instruction
        system_flags = ctx.get(core.flags.as_value())
        assert system_flags & 2 == 0
        if case == "system_absent":
            mem[0x200C] = CALL
        else:
            await issue()  # SYSTEM CHANGE to USER; continuation becomes 0x2010
            assert ctx.get(core.imem_addr) == 0x4008
            assert ctx.get(core.debug_cr_words[12][0]) == USER_GT
        before_crs = [tuple(ctx.get(w) for w in cr) for cr in core.debug_cr_words]
        before_drs = [ctx.get(w) for w in core.debug_dr_words]
        before_flags = ctx.get(core.flags.as_value())
        expected_fault = None
        if case in ("stale_system", "bad_owner"):
            slot = 2 if case == "stale_system" else 4
            mem[slot * 16 + 4] += 1 << 21
            mem[slot * 16 + 8] = integrity32(mem[slot * 16], mem[slot * 16 + 4])
            expected_fault = 0x1D
        elif case == "bad_system_frame":
            mem[0x1000 + 241 * 4] ^= 1  # actual frame pushed by SYSTEM CHANGE
            expected_fault = 0x1D
        elif case == "bad_target":
            mem[6 * 16 + 8] ^= 1
            expected_fault = 0x0A
        elif case == "system_absent":
            expected_fault = 0x11
        before_mem = dict(mem)
        start_writes = len(writes)
        events = await issue(finish=(lambda: False) if expected_fault else
                             lambda: ctx.get(core.imem_addr) == 0x2010,
                             fault=expected_fault)
        if expected_fault:
            assert len(writes) == start_writes and mem == before_mem
            assert [tuple(ctx.get(w) for w in cr) for cr in core.debug_cr_words] == before_crs
            assert [ctx.get(w) for w in core.debug_dr_words] == before_drs
            assert ctx.get(core.flags.as_value()) == before_flags
            return
        assert events == [], "unavailable CALL must not retire"
        assert ctx.get(core.flags.as_value()) == system_flags | 2
        assert ctx.get(core.debug_cr_words[12][0]) == SYSTEM_GT
        assert tuple(ctx.get(w) for w in core.debug_cr_words[13]) == before_crs[13]
        assert [ctx.get(core.debug_dr_words[i]) for i in range(7)] == [
            0, mem[0], mem[4], mem[8], mem[12], 6, USER_GT]
        assert [mem[0x3000 + (i + 1) * 4] for i in range(16)] == before_drs
        assert mem[0x3000 + 243 * 4] >> 13 & 0x7FFF == 1
        assert mem[0x3000 + 243 * 4] >> 28 == before_flags
        assert not ctx.get(core.boot_marker_available)
        await issue()  # saved SYSTEM continuation: ordinary CHANGE back to USER
        assert ctx.get(core.imem_addr) == 0x4008
        assert [ctx.get(w) for w in core.debug_dr_words] == before_drs
        assert ctx.get(core.flags.as_value()) == before_flags
        # Model body arrival only in isolated memory, not a DELIVER implementation.
        mem.update({0x5000: 0xF8001001, 0x5004: 2, 0x50FC: 0x4A000006,
                    0x5008: 0xAF60400D, 0x500C: 0x1F000000})  # IADD; RETURN
        events = await issue()
        # retire_instr currently mirrors the fetch bus, which this harness
        # deliberately poisons while invalid. Count the committed NIA and
        # verify the callee's executed effect, not that unrelated trace field.
        assert [nia for nia, _ in events] == [0x4008]
        assert ctx.get(core.imem_addr) == 0x5008
        await issue()
        assert ctx.get(core.debug_dr_words[12]) == 13
        await issue()
        assert ctx.get(core.imem_addr) == 0x400C
        assert sum(nia == 0x4008 for nia, _ in retired) == 1
        assert not ctx.get(core.boot_marker_available)

    sim = Simulator(core)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()
