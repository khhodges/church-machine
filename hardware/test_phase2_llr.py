"""Local RTL evidence only: real CALL/mLoad/CHANGE, no catalog or hardware I/O."""
import pytest
from amaranth.sim import Simulator
from hardware.core import ChurchCore
from hardware.change import ChurchChange
from hardware.integrity32 import integrity32
from hardware.sim_boot_helpers import boot_core
from hardware.test_phase1_independent_execution import execute_data


def fixture(version=0):
    mem = {0: 0xF8004100, 4: 0x12345678, 8: 0x23456789, 12: 0x3456789A,
           0x400: 0x02000001, 0x404: 0x02000004 | (version << 16)}
    for slot, base, limit in [(1, 0, 63), (2, 0x1000, 255),
                              (3, 0x2000, 63), (4, 0x3000, 255),
                              (5, 0x4000, 63), (6, 0x5000, 63)]:
        authority = limit | ((version << 21) if slot == 4 else 0)
        for i, value in enumerate((base, authority, integrity32(base, authority), 0)):
            mem[slot * 16 + i * 4] = value
    for base, code, slot, entry_flags in [(0x1000, 0x2000, 3, 13),
                                          (0x3000, 0x4000, 5, 0)]:
        mem[base] = 0xF900020C | (32 << 10)
        mem[base + 68] = 0x10F1
        mem[base + 242 * 4] = 0x4A000000 | slot
        mem[base + 243 * 4] = 0x10F3 | (entry_flags << 28)
        for reg in range(12):
            mem[base + (244 + reg) * 4] = 0
        mem[base + 244 * 4] = 0x4A000000 | slot
        mem[base + 245 * 4] = (0x02000004 | (version << 16)) if slot == 3 else 0x02000002
        mem[base + 246 * 4] = 0x4A000006
        for reg in range(1, 16):
            mem[base + (reg + 1) * 4] = 0x60000000 + reg
        mem[code] = 0xF8000002 | (48 << 10)
        mem[code + 62 * 4] = 0x4A000000 | slot
        mem[code + 63 * 4] = 0
    # Valid Inform target and header, but no executable body.
    mem[0x5000] = 0xF8000001
    return mem


@pytest.mark.parametrize("case", ["resume", "bad_system_frame", "bad_system_seal",
                                  "outgoing_stack", "system_absent"])
@pytest.mark.parametrize("version", [0, 7])
def test_real_core_llr(case, version):
    dut = ChurchCore()
    mem = fixture(version)
    user_gt = 0x02000004 | (version << 16)

    async def bench(ctx):
        ctx.set(dut.defer_fault_reset, 1)
        await boot_core(ctx, dut)
        for _ in range(3):
            await execute_data(ctx, dut, 0xAF784001)

        async def issue(word, *, llr=False, fault=None):
            pending = None
            before_writes = []
            ctx.set(dut.imem_data, word)
            ctx.set(dut.imem_valid, 1)
            for cycle in range(3000):
                ctx.set(dut.dmem_rd_valid, pending is not None)
                ctx.set(dut.dmem_rd_data, mem.get(pending, 0))
                await ctx.delay(1e-9)
                rd = ctx.get(dut.dmem_addr) if ctx.get(dut.dmem_rd_en) else None
                if ctx.get(dut.dmem_wr_en):
                    addr = ctx.get(dut.dmem_addr)
                    mem[addr] = ctx.get(dut.dmem_wr_data)
                    before_writes.append(addr)
                if ctx.get(dut.fault_valid):
                    assert fault is not None, (case, cycle, ctx.get(dut.fault))
                    assert ctx.get(dut.fault) == fault
                    assert not before_writes
                    return
                if llr:
                    assert not ctx.get(dut.retire_valid), "pending CALL retired"
                    done = fault is None and ctx.get(dut.imem_addr) == 0x2004
                else:
                    done = ctx.get(dut.retire_valid)
                await ctx.tick()
                pending = rd
                ctx.set(dut.imem_valid, 0)
                ctx.set(dut.imem_data, 0xFFFFFFFF)
                if done:
                    assert fault is None
                    for _ in range(3):
                        await ctx.tick()
                        assert not ctx.get(dut.fault_valid)
                        assert not ctx.get(dut.retire_valid)
                    return
            pytest.fail("transition did not terminate")

        await issue(0x077B0000)  # LOAD CR15 from boot C-list row 0
        await issue(0x070B0010)  # LOAD CR1 = USER Thread
        await issue(0x27008000)  # ordinary CHANGE CR1
        assert ctx.get(dut.debug_cr_words[12][0]) == user_gt
        for reg in range(1, 16):
            await execute_data(ctx, dut, 0xAF004000 | (reg << 19) | (reg + 100))
        before_drs = [ctx.get(dr) for dr in dut.debug_dr_words]
        before_crs = [tuple(ctx.get(w) for w in cr) for cr in dut.debug_cr_words]
        call_nia = ctx.get(dut.imem_addr)
        user_flags = ctx.get(dut.flags.as_value())
        expected_fault = None
        if case == "bad_system_frame":
            mem[0x1000 + 243 * 4] = 0x10F3 | (0x7FFF << 13)
            expected_fault = 0x1D
        elif case == "bad_system_seal":
            mem[2 * 16 + 8] ^= 1
            expected_fault = 0x1D
        elif case == "outgoing_stack":
            mem[0x3000 + 68] = 0x10D4
            expected_fault = 0x1D
        elif case == "system_absent":
            await issue(0x27008000)
            before_crs = [tuple(ctx.get(w) for w in cr) for cr in dut.debug_cr_words]
            before_drs = [ctx.get(dr) for dr in dut.debug_dr_words]
            expected_fault = 0x11
        before_mem = dict(mem)
        await issue(0x17100001, llr=True, fault=expected_fault)  # CALL CR2, method 1
        if expected_fault is not None:
            assert mem == before_mem
            assert [tuple(ctx.get(w) for w in cr) for cr in dut.debug_cr_words] == before_crs
            assert [ctx.get(dr) for dr in dut.debug_dr_words] == before_drs
            return
        assert ctx.get(dut.debug_cr_words[12][0]) == 0x02000002
        assert ctx.get(dut.debug_cr_words[13][0]) == before_crs[13][0]
        assert ctx.get(dut.flags.as_value()) == 15  # SYSTEM N/C/V retained, Z set
        assert [ctx.get(dut.debug_dr_words[i]) for i in range(7)] == [
            0, mem[0], mem[4], mem[8], mem[12], 6, user_gt]
        assert [mem[0x3000 + (reg + 1) * 4] for reg in range(16)] == before_drs
        saved_frame = mem[0x3000 + 243 * 4]
        assert (saved_frame >> 13 & 0x7FFF) == (call_nia - 0x4004) // 4
        assert saved_frame >> 28 == user_flags
        assert mem[0x3000 + 242 * 4] == 0x4A000005
        # Resume through ordinary CHANGE: no special restore or synthetic CALL.
        await issue(0x27008000)
        assert ctx.get(dut.imem_addr) == call_nia
        assert ctx.get(dut.flags.as_value()) == user_flags
        assert [ctx.get(dr) for dr in dut.debug_dr_words] == before_drs
        # Exact original CALL now succeeds after body availability changes.
        mem[0x5000] = 0xF8000001 | (4 << 10)
        mem[0x5004] = 2
        mem[0x50FC] = 0x4A000006
        await issue(0x17100001)
        assert ctx.get(dut.imem_addr) == 0x5008

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()


@pytest.mark.parametrize("resident", [False, True])
@pytest.mark.parametrize("case", ["ok", "stale_owner", "stale_system", "no_owner"])
def test_llr_latches_inputs_and_obeys_profile_identity(resident, case):
    """Exercise word-addressed guarded geometry and nonzero fixed identities.

    This is the real transition unit, not guarded startup or FPGA evidence.
    """
    user_gt, system_gt = 0x02070004, 0x03A30002
    dut = ChurchChange(resident_word_locations=resident, system_thread_gt=system_gt)
    mem = fixture(7)
    mem[2 * 16 + 4] |= 419 << 21
    mem[2 * 16 + 8] = integrity32(mem[2 * 16], mem[2 * 16 + 4])
    mem[0x3000 + 68] = 0x10F3
    for slot in range(1, 7):
        if resident:
            mem[slot * 16] >>= 2
            mem[slot * 16 + 8] = integrity32(mem[slot * 16], mem[slot * 16 + 4])
    if case in ("stale_owner", "stale_system"):
        slot = 4 if case == "stale_owner" else 2
        mem[slot * 16 + 4] += 1 << 21
        mem[slot * 16 + 8] = integrity32(mem[slot * 16], mem[slot * 16 + 4])
    def cap(gt, base, authority):
        return gt | (base << 32) | (authority << 64)
    crs = [0] * 16
    crs[0] = 0x4A000005
    crs[6] = cap(0x1A000005, 0x40F8, 1)
    crs[12] = cap(user_gt, 0x3000, 255 | (7 << 21))
    crs[13] = 0x12345678
    crs[14] = cap(0x52000005, 0x4004, 47)
    crs[15] = cap(0x02000001, 0, 63)
    drs = [0] + list(range(101, 116))
    original = dict(mem)
    writes, injections = [], []

    async def bench(ctx):
        pending = None
        ctx.set(dut.ordinary, 1)
        ctx.set(dut.llr_entry, 1)
        ctx.set(dut.llr_target, 6)
        ctx.set(dut.active_thread_owned, case != "no_owner")
        ctx.set(dut.nia_current, 0x4014)
        ctx.set(dut.code_base, 0x4004)
        ctx.set(dut.flags_in.as_value(), 9)
        for cycle in range(3000):
            ctx.set(dut.change_start, cycle == 0)
            ctx.set(dut.cr12_thread.as_value(), crs[12])
            ctx.set(dut.cr15_namespace.as_value(), crs[15])
            ctx.set(dut.cr_rd_data.as_value(), crs[ctx.get(dut.cr_rd_addr)])
            ctx.set(dut.dr_rd_data, drs[ctx.get(dut.dr_rd_addr)])
            ctx.set(dut.mem_rd_valid, pending is not None and cycle % 3 != 0)
            ctx.set(dut.mem_rd_data, mem.get(pending, 0))
            ctx.set(dut.mem_wr_done, cycle % 3 != 0)
            await ctx.delay(1e-9)
            ctx.set(dut.cr_rd_data.as_value(), crs[ctx.get(dut.cr_rd_addr)])
            ctx.set(dut.dr_rd_data, drs[ctx.get(dut.dr_rd_addr)])
            await ctx.delay(1e-9)
            rd = ctx.get(dut.mem_rd_addr) if ctx.get(dut.mem_rd_en) else None
            if ctx.get(dut.mem_wr_en) and ctx.get(dut.mem_wr_done):
                addr = ctx.get(dut.mem_wr_addr)
                mem[addr] = ctx.get(dut.mem_wr_data)
                writes.append(addr)
            if ctx.get(dut.cr_wr_en):
                assert writes, "publication preceded USER save"
                crs[ctx.get(dut.cr_wr_addr)] = ctx.get(dut.cr_wr_data.as_value())
            if ctx.get(dut.dr_wr_en):
                addr, value = ctx.get(dut.dr_wr_addr), ctx.get(dut.dr_wr_data)
                if addr:
                    drs[addr] = value
                injections.append((addr, value))
            if ctx.get(dut.nia_restore_en):
                assert injections[-6:] == list(enumerate(
                    [original[0], original[4], original[8], original[12], 6, user_gt], 1))
                assert ctx.get(dut.nia_restore_val) == 0x2004
                assert ctx.get(dut.flags_restore_data.as_value()) == 15
            if ctx.get(dut.change_fault):
                assert case != "ok"
                assert ctx.get(dut.fault_type) == 0x1D
                assert not writes and not injections and mem == original
                assert crs[12] == cap(user_gt, 0x3000, 255 | (7 << 21))
                return
            if ctx.get(dut.change_complete):
                assert case == "ok"
                assert crs[12] & 0xFFFFFFFF == system_gt
                assert crs[13] == 0x12345678 and drs[0] == 0
                assert mem[0x3000 + 243 * 4] >> 13 & 0x7FFF == 4
                assert mem[0x3000 + 243 * 4] >> 28 == 9
                assert [mem[0x3000 + (i + 1) * 4] for i in range(16)] == [
                    0, *range(101, 116)]
                return
            await ctx.tick()
            pending = rd
            if cycle == 0:
                ctx.set(dut.llr_entry, 0)
                ctx.set(dut.llr_target, 0xFFFF)
                ctx.set(dut.nia_current, 0xDEAD)
                ctx.set(dut.code_base, 0xBAD)
                ctx.set(dut.flags_in.as_value(), 6)
        pytest.fail("stalled LLR did not finish")
    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()
