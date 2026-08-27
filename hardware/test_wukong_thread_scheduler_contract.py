"""Static/RTLIL contract coverage for Wukong's M6 Thread scheduler.

The full production top conversion is intentionally expensive because it
contains the complete 16K-word machine.  These focused checks elaborate the
security-critical CHANGE path and protect the physical boundary wiring from
being removed while the upload FSM tests cover its DMEM projection.
"""
from amaranth.back import rtlil
from amaranth.sim import Simulator

from hardware.change import ChurchChange
from hardware.mload import ChurchMLoad
from hardware.hw_types import GT_TYPE_INFORM
from server.boot_image import create_gt, integrity32, pack_lump_header, pack_ns_word1


def test_scheduler_preflight_is_read_only_and_seal_checked():
    """M6's target check must occur before state saving and bypass no seal."""
    source = open("hardware/change.py").read()
    assert 'm.next = "PREFLIGHT"' in source
    assert 'u_mload.sub_validate_only.eq(1)' in source
    assert source.index('m.next = "SCHED_FETCH_AUTH"') < source.index('m.next = "SAVE_DR"')
    assert 'scheduler_gt_seq.eq(View(WORD2_LAYOUT, self.mem_rd_data).gt_seq)' in source
    assert 'boot_gt_view.gt_seq.eq(Mux(scheduler_mode_lat, scheduler_gt_seq, 0))' in source
    assert 'u_mload.sub_m_elevated.eq(self.m_elevated)' in source
    assert 'SCHEDULER_RESTORE_MASK = 0x4FFF' in source
    assert 'outgoing_thread_base + ((DR_OFFSET + save_index) << 2)' in source
    assert 'restore_base + ((DR_OFFSET + save_index) << 2)' in source
    assert 'self.nia_restore_en.eq(1)' in source
    assert 'self.flags_restore_en.eq(1)' in source
    rtlil.convert(ChurchMLoad(), ports=[])
    rtlil.convert(ChurchChange(), ports=[])


def test_m6_contract_has_synchronizer_debounce_and_fetch_quiesce():
    """A held/bouncing active-low M6 input cannot repeatedly retire code."""
    source = open("hardware/wukong_top.py").read()
    assert 'm6_sync = Signal(2' in source
    assert 'm6_stable_pressed' in source
    assert 'm6_click.eq(1)' in source
    assert 'thread_switch_pending' in source
    assert '~core.thread_switch_busy' in source
    assert 'snap_thread_base.eq(core.active_thread_base)' in source


def test_scheduler_cycle_sim_isolates_three_thread_contexts():
    """Exercise the real CHANGE RTL through 1 -> 11 -> 12 -> 1."""
    dut = ChurchChange()
    sim = Simulator(dut)
    sim.add_clock(1e-6)

    slots = (1, 11, 12)
    bases = {1: 0x2000, 11: 0x3000, 12: 0x4000}
    # Keep CR7's base zero so packed PC is directly observable; capability
    # identity is isolated by the distinct descriptor slots below.
    code_bases = {1: 0, 11: 0, 12: 0}
    cap_slots = {1: 20, 11: 21, 12: 22}
    mem = {}

    def put_descriptor(slot, location, limit=511):
        authority = pack_ns_word1(limit, gt_seq=0)
        mem[slot * 16] = location
        mem[slot * 16 + 4] = authority
        mem[slot * 16 + 8] = integrity32(location, authority)
        mem[slot * 16 + 12] = 0

    for slot in slots:
        put_descriptor(slot, bases[slot])
        put_descriptor(cap_slots[slot], code_bases[slot])
        base = bases[slot]
        mem[base] = pack_lump_header(3, 32, 12, 2)
        for dr in range(16):
            mem[base + (1 + dr) * 4] = (slot << 16) | dr
        mem[base + 17 * 4] = 0x100 + slot
        mem[base + 18 * 4] = slot & 1
        gt = create_gt(0, cap_slots[slot], {"L": 1}, GT_TYPE_INFORM)
        for cr in tuple(range(12)) + (14,):
            mem[base + (244 + cr) * 4] = gt

    # CR values are packed word0 | location<<32 | authority<<64.
    crs = [0] * 16
    crs[12] = create_gt(0, 1, {"S": 1}, GT_TYPE_INFORM) | (0xDEAD << 32)
    crs[15] = 0 | (0 << 32) | (pack_ns_word1(63) << 64)
    initial_gt = create_gt(0, cap_slots[1], {"L": 1}, GT_TYPE_INFORM)
    for cr in tuple(range(12)) + (14,):
        crs[cr] = initial_gt | (code_bases[1] << 32) | (511 << 64)
    drs = [(1 << 16) | dr for dr in range(16)]
    expected_dr1 = {slot: (slot << 16) | 1 for slot in slots}
    expected_nia = {slot: 0x100 + slot for slot in slots}
    active = {"slot": 1, "base": bases[1], "nia": code_bases[1] + 0x101,
              "flags": 1}

    async def bench(ctx):
        ctx.set(dut.cr_src, 15)
        ctx.set(dut.cr_dst, 14)
        ctx.set(dut.change_mask, 0x4FFF)
        ctx.set(dut.scheduler_mode, 1)
        ctx.set(dut.m_elevated, 0)
        ctx.set(dut.cr12_thread.as_value(), crs[12])
        ctx.set(dut.cr15_namespace.as_value(), crs[15])
        ctx.set(dut.mem_wr_done, 1)
        ctx.set(dut.cr15_m_flag_in, 0)

        prev_rd_en = False
        prev_rd_addr = 0

        async def cycle():
            nonlocal prev_rd_en, prev_rd_addr
            await ctx.delay(1e-9)
            ctx.set(dut.cr_rd_data.as_value(), crs[ctx.get(dut.cr_rd_addr)])
            ctx.set(dut.dr_rd_data, drs[ctx.get(dut.dr_rd_addr)])
            ctx.set(dut.mem_rd_valid, int(prev_rd_en))
            ctx.set(dut.mem_rd_data, mem.get(prev_rd_addr, 0))
            await ctx.delay(1e-9)
            cr_write = (
                ctx.get(dut.cr_wr_en), ctx.get(dut.cr_wr_addr),
                ctx.get(dut.cr_wr_data.as_value()))
            dr_write = (
                ctx.get(dut.dr_wr_en), ctx.get(dut.dr_wr_addr),
                ctx.get(dut.dr_wr_data))
            mem_write = (
                ctx.get(dut.mem_wr_en), ctx.get(dut.mem_wr_addr),
                ctx.get(dut.mem_wr_data))
            nia_write = (ctx.get(dut.nia_restore_en),
                         ctx.get(dut.nia_restore_val))
            flags_write = (ctx.get(dut.flags_restore_en),
                           ctx.get(dut.flags_restore_val))
            next_rd_en = bool(ctx.get(dut.mem_rd_en))
            next_rd_addr = ctx.get(dut.mem_rd_addr)
            await ctx.tick()
            if cr_write[0]:
                crs[cr_write[1]] = cr_write[2]
            if dr_write[0]:
                addr = dr_write[1]
                if addr:
                    drs[addr] = dr_write[2]
            if mem_write[0]:
                mem[mem_write[1]] = mem_write[2]
            if nia_write[0]:
                active["nia"] = nia_write[1]
            if flags_write[0]:
                active["flags"] = flags_write[1]
            prev_rd_en = next_rd_en
            prev_rd_addr = next_rd_addr

        for target in (11, 12, 1):
            old_slot = active["slot"]
            old_base = active["base"]
            # Distinct live state proves save does not alias Thread.1.
            live_gt = create_gt(0, cap_slots[old_slot], {"L": 1}, GT_TYPE_INFORM)
            crs[1] = live_gt | (code_bases[old_slot] << 32) | (511 << 64)
            drs[1] = 0xD0000000 | old_slot
            active["nia"] = code_bases[old_slot] + 0x200 + old_slot
            active["flags"] = old_slot & 0xF
            expected_dr1[old_slot] = drs[1]
            expected_nia[old_slot] = active["nia"]
            ctx.set(dut.active_thread_base, old_base)
            ctx.set(dut.index, target)
            ctx.set(dut.nia, active["nia"])
            ctx.set(dut.flags.as_value(), active["flags"])
            ctx.set(dut.change_start, 1)
            await cycle()
            ctx.set(dut.change_start, 0)

            committed = False
            for _ in range(2500):
                await cycle()
                assert not ctx.get(dut.change_fault)
                if ctx.get(dut.thread_base_restore_en):
                    committed = True
                    active["slot"] = target
                    active["base"] = ctx.get(dut.thread_base_restore_val)
                if ctx.get(dut.change_complete):
                    break
            else:
                raise AssertionError(f"scheduler CHANGE to slot {target} timed out")

            assert committed
            assert active["base"] == bases[target]
            assert mem[old_base + (1 + 1) * 4] == (0xD0000000 | old_slot)
            assert mem[old_base + (244 + 1) * 4] == live_gt
            packed = mem[old_base + 17 * 4]
            assert packed & 0x0FFFFFFF == (
                code_bases[old_slot] + 0x200 + old_slot - code_bases[old_slot])
            assert packed >> 28 == (old_slot & 0xF)
            assert drs[1] == expected_dr1[target]
            assert (crs[1] & 0xFFFFFFFF) == create_gt(
                0, cap_slots[target], {"L": 1}, GT_TYPE_INFORM)
            assert active["nia"] == expected_nia[target]
            # COMPLETE transitions back to IDLE on the following edge.
            await cycle()

        # A corrupt target fails preflight before saving or committing telemetry.
        bad_target = 11
        saved = mem[bases[1] + (1 + 1) * 4]
        mem[bad_target * 16 + 8] ^= 1
        ctx.set(dut.active_thread_base, bases[1])
        ctx.set(dut.index, bad_target)
        ctx.set(dut.change_start, 1)
        await cycle()
        ctx.set(dut.change_start, 0)
        saw_commit = False
        for _ in range(300):
            await cycle()
            saw_commit |= bool(ctx.get(dut.thread_base_restore_en))
            if ctx.get(dut.change_fault):
                break
        assert ctx.get(dut.change_fault)
        assert not saw_commit
        assert mem[bases[1] + (1 + 1) * 4] == saved

    sim.add_testbench(bench)
    sim.run()