"""Focused contract coverage for Wukong's physical Thread scheduler."""
from pathlib import Path

from amaranth.back import rtlil
from amaranth.sim import Simulator

from hardware.change import ChurchChange
from hardware.mload import ChurchMLoad
from hardware.hw_types import GT_TYPE_INFORM
from server.boot_image import create_gt, integrity32, pack_lump_header, pack_ns_word1
from hardware.thread_design import THREAD_CAP_WORDS


def test_scheduler_contract_has_no_serialized_entry_context():
    source = open("hardware/change.py").read()
    assert 'm.next = "PREFLIGHT"' in source
    assert 'SCHEDULER_RESTORE_MASK = (1 << THREAD_CAP_WORDS) - 1' in source
    assert THREAD_CAP_WORDS == 12
    assert 'm.next = "ENTRY_CR0_READ"' in source
    assert 'mload_direct_gt.eq(entry_gt_latched)' in source
    assert "entry_gt_view.gt_type != GT_TYPE_INFORM" in source
    assert "~entry_gt_view.dom" in source
    assert "~entry_gt_view.perm[2]" in source
    assert 'self.nia_restore_val.eq(entry_raw_base + 4)' in source
    for stale in (
        "cr7_base", "PACKED_PC_OFFSET", "M_FLAG_OFFSET", "SAVE_PACKED_PC",
        "SAVE_M_FLAG", "RESTORE_PC", "RESTORE_M_FLAG",
    ):
        assert stale not in source
    rtlil.convert(ChurchMLoad(), ports=[])
    rtlil.convert(ChurchChange(), ports=[])


def test_m6_contract_has_synchronizer_debounce_and_fetch_quiesce():
    source = open("hardware/wukong_top.py").read()
    assert 'm6_sync = Signal(2' in source
    assert 'm6_stable_pressed' in source
    assert 'm6_click.eq(1)' in source
    assert 'thread_switch_pending' in source
    assert '~core.thread_switch_busy' in source
    assert 'snap_thread_base.eq(core.active_thread_base)' in source


def test_change_derives_entry_from_cr0_without_frame_or_context_words():
    dut = ChurchChange()
    sim = Simulator(dut)
    sim.add_clock(1e-6)

    old_base, new_base, code_base = 0x2000, 0x3000, 0x5000
    thread_slot, code_slot = 11, 21
    mem = {}

    def descriptor(slot, location, limit, seq=0):
        authority = pack_ns_word1(limit, gt_seq=seq)
        mem[slot * 16] = location
        mem[slot * 16 + 4] = authority
        mem[slot * 16 + 8] = integrity32(location, authority)
        mem[slot * 16 + 12] = 0

    descriptor(thread_slot, new_base, 255)
    descriptor(code_slot, code_base, 63)
    mem[new_base] = pack_lump_header(2, 32, 12, 2)
    mem[code_base] = pack_lump_header(0, 7, 2, 0)
    entry_gt = create_gt(0, code_slot, {"E": 1}, GT_TYPE_INFORM)
    for i in range(12):
        mem[new_base + (244 + i) * 4] = entry_gt
    for i in range(16):
        mem[new_base + (1 + i) * 4] = 0xA0000000 | i
    mem[new_base + 17 * 4] = 243
    mem[new_base + 18 * 4] = 0x18181818
    mem[new_base + 258 * 4] = 0xDEADBEEF

    crs = [0] * 16
    crs[15] = pack_ns_word1(63) << 64
    drs = [0xB0000000 | i for i in range(16)]
    writes = []
    reads = []
    nia = None
    previous_read_en = False
    previous_read_addr = 0

    async def bench(ctx):
        nonlocal previous_read_en, previous_read_addr, nia
        ctx.set(dut.cr_src, 15)
        ctx.set(dut.cr_dst, 14)
        ctx.set(dut.scheduler_mode, 1)
        ctx.set(dut.m_elevated, 0)
        ctx.set(dut.index, thread_slot)
        ctx.set(dut.active_thread_base, old_base)
        ctx.set(dut.cr15_namespace.as_value(), crs[15])
        ctx.set(dut.mem_wr_done, 1)

        async def cycle():
            nonlocal previous_read_en, previous_read_addr, nia
            await ctx.delay(1e-9)
            ctx.set(dut.cr_rd_data.as_value(), crs[ctx.get(dut.cr_rd_addr)])
            ctx.set(dut.dr_rd_data, drs[ctx.get(dut.dr_rd_addr)])
            ctx.set(dut.mem_rd_valid, int(previous_read_en))
            ctx.set(dut.mem_rd_data, mem.get(previous_read_addr, 0))
            await ctx.delay(1e-9)
            cr_write = (ctx.get(dut.cr_wr_en), ctx.get(dut.cr_wr_addr),
                        ctx.get(dut.cr_wr_data.as_value()))
            dr_write = (ctx.get(dut.dr_wr_en), ctx.get(dut.dr_wr_addr),
                        ctx.get(dut.dr_wr_data))
            mem_write = (ctx.get(dut.mem_wr_en), ctx.get(dut.mem_wr_addr),
                         ctx.get(dut.mem_wr_data))
            next_read_en = bool(ctx.get(dut.mem_rd_en))
            next_read_addr = ctx.get(dut.mem_rd_addr)
            if next_read_en:
                reads.append(next_read_addr)
            nia_write = (ctx.get(dut.nia_restore_en), ctx.get(dut.nia_restore_val))
            await ctx.tick()
            if cr_write[0]:
                crs[cr_write[1]] = cr_write[2]
            if dr_write[0]:
                drs[dr_write[1]] = dr_write[2]
            if mem_write[0]:
                mem[mem_write[1]] = mem_write[2]
                writes.append(mem_write[1])
            if nia_write[0]:
                nia = nia_write[1]
            previous_read_en = next_read_en
            previous_read_addr = next_read_addr

        ctx.set(dut.change_start, 1)
        await cycle()
        ctx.set(dut.change_start, 0)
        for _ in range(2500):
            await cycle()
            assert not ctx.get(dut.change_fault), (
                f"CHANGE faulted with type {ctx.get(dut.fault_type)}; "
                f"last reads={reads[-16:]}")
            if ctx.get(dut.change_complete):
                break
        else:
            raise AssertionError("scheduler CHANGE timed out")

        assert nia == code_base + 4
        assert drs[1] == 0xA0000001
        cr14 = crs[14]
        assert (cr14 & 0xFFFF) == code_slot
        assert ((cr14 >> 32) & 0xFFFFFFFF) == code_base + 4
        assert ((cr14 >> 64) & 0x1FFFFF) == 6
        assert mem[new_base + 17 * 4] == 243
        assert mem[new_base + 18 * 4] == 0x18181818
        assert mem[new_base + 258 * 4] == 0xDEADBEEF
        assert old_base + 17 * 4 in writes
        forbidden = {
            old_base + 18 * 4, old_base + 258 * 4,
            new_base + 17 * 4, new_base + 18 * 4, new_base + 258 * 4,
        }
        assert forbidden.isdisjoint(writes)

    sim.add_testbench(bench)
    sim.run()


def test_all_frame_paths_follow_the_scheduler_active_thread_base():
    core_source = Path("hardware/core.py").read_text()
    assert "u_call.thread_base.eq(Mux(" in core_source
    assert "boot_microcode_active" in core_source
    assert "u_return.thread_base.eq(self.active_thread_base)" in core_source
    assert "u_eloadcall.thread_base.eq(self.active_thread_base)" in core_source
    return_source = Path("hardware/ret.py").read_text()
    assert "thread_base_latched.eq(self.thread_base)" in return_source