"""Focused contract coverage for Wukong's physical Thread scheduler."""
import ast
from pathlib import Path

import pytest
from amaranth.back import rtlil
from amaranth.sim import Simulator

from hardware.change import ChurchChange
from hardware.boot_rom import encode_church, encode_turing
from hardware.test_boot_rom_no_false_halt import BootRomHarness, _build_dmem_init
from hardware.mload import ChurchMLoad
from hardware.hw_types import (
    ChurchOpcode,
    CondCode,
    FaultType,
    GT_TYPE_INFORM,
    PERM_MASK_E,
    TuringOpcode,
    make_gt,
)
from server.boot_image import create_gt, integrity32, pack_lump_header, pack_ns_word1
from hardware.thread_design import (
    THREAD_CAP_WORDS,
    THREAD_HEAP_OFFSET,
    THREAD_STO_OFFSET,
    thread_body_words,
    thread_layout,
)


def _eq_dependencies(source):
    """Return normalized signal dependencies expressed through Amaranth eq()."""
    dependencies = {}
    for node in ast.walk(ast.parse(source)):
        if not (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "eq"
            and len(node.args) == 1
        ):
            continue
        target = ast.unparse(node.func.value)
        dependencies.setdefault(target, set()).update(
            ast.unparse(value)
            for value in ast.walk(node.args[0])
            if isinstance(value, (ast.Name, ast.Attribute))
        )
    return dependencies


def _depends_on(dependencies, target, source):
    pending = [target]
    seen = set()
    while pending:
        signal = pending.pop()
        if signal == source:
            return True
        if signal in seen:
            continue
        seen.add(signal)
        pending.extend(dependencies.get(signal, ()))
    return False


def test_change_contract_uses_canonical_church_suspension_frame():
    source = open("hardware/change.py").read()
    assert 'm.next = "PREFLIGHT"' in source
    assert 'SCHEDULER_RESTORE_MASK = (1 << THREAD_CAP_WORDS) - 1' in source
    assert THREAD_CAP_WORDS == 12
    assert THREAD_HEAP_OFFSET == 18
    assert 'mload_direct_gt.eq(entry_gt_latched)' in source
    assert "THREAD_CODE_IDENTITY_OFFSET" not in source
    assert 'with m.State("SAVE_EGT_WRITE")' in source
    assert 'with m.State("SAVE_FRAME")' in source
    assert 'stack_slot_addr(' in source
    assert 'self.nia_restore_val.eq(incoming_frame[13:28] << 2)' in source
    assert 'nia_current_latched.eq(self.nia_current)' in source
    assert '(nia_current_latched[2:17] + 1)[:15]' in source
    assert 'with m.State("PREFLIGHT_CAP_READ")' in source
    assert 'with m.State("PREFLIGHT_EGT_VALIDATE")' in source
    # Scheduler preflight's only successful edge into write-capable SAVE_*
    # states is after frame/GT/header and outgoing-stack checks.
    preflight = source[source.index('with m.State("PREFLIGHT_HDR")'):
                       source.index('with m.State("SAVE_CR_READ")')]
    assert 'm.next = "SAVE_CR_READ"' in preflight
    assert preflight.index('m.next = "SAVE_CR_READ"') > preflight.index(
        'with m.State("PREFLIGHT_OUT_INDICATOR")')
    for stale in (
        "cr7_base", "PACKED_PC_OFFSET", "M_FLAG_OFFSET", "SAVE_PACKED_PC",
        "SAVE_M_FLAG", "RESTORE_PC", "RESTORE_M_FLAG",
    ):
        assert stale not in source
    rtlil.convert(ChurchMLoad(), ports=[])
    rtlil.convert(ChurchChange(), ports=[])


def test_m6_contract_has_synchronizer_debounce_and_fetch_quiesce():
    source = open("hardware/wukong_top.py").read()
    core_source = open("hardware/core.py").read()
    assert 'm6_sync = Signal(2' in source
    assert 'm6_stable_pressed' in source
    assert 'm6_click.eq(1)' in source
    assert 'thread_switch_pending' in source
    assert '~core.thread_switch_busy' in source
    assert 'snap_thread_base.eq(core.active_thread_base)' in source
    assert 'Mux(thread_switch_start_sig, nia_reg - 4, nia_reg)' in core_source


@pytest.mark.parametrize(
    "thread_n_minus_6",
    [2, 3],
)
@pytest.mark.parametrize(
    "corruption",
    [None, "stale_cap", "null_egt", "stale_egt", "malformed_frame",
     "nia_oob", "underflow", "outgoing_overflow"],
)
def test_change_enforces_defined_thread_body_before_restoring_context(
        thread_n_minus_6, corruption):
    dut = ChurchChange()
    sim = Simulator(dut)
    sim.add_clock(1e-6)

    old_base, new_base, code_base, cr0_code_base = 0x2000, 0x3000, 0x5000, 0x6000
    thread_slot, code_slot, cr0_code_slot = 11, 21, 22
    mem = {}

    def descriptor(slot, location, limit, seq=0):
        authority = pack_ns_word1(limit, gt_seq=seq)
        mem[slot * 16] = location
        mem[slot * 16 + 4] = authority
        mem[slot * 16 + 8] = integrity32(location, authority)
        mem[slot * 16 + 12] = 0

    body_words = thread_body_words(thread_n_minus_6)
    layout = thread_layout(body_words, 32)
    assert layout["valid"]

    descriptor(thread_slot, new_base, body_words - 1)
    descriptor(code_slot, code_base, 63)
    descriptor(cr0_code_slot, cr0_code_base, 63)
    mem[new_base] = pack_lump_header(thread_n_minus_6, 32, 12, 2)
    mem[old_base] = pack_lump_header(thread_n_minus_6, 32, 12, 2)
    mem[code_base] = pack_lump_header(0, 48, 2, 0)
    mem[cr0_code_base] = pack_lump_header(0, 5, 1, 0)
    entry_gt = create_gt(0, code_slot, {"E": 1}, GT_TYPE_INFORM)
    cr0_gt = create_gt(0, cr0_code_slot, {"E": 1}, GT_TYPE_INFORM)
    for i in range(12):
        mem[new_base + (layout["caps_start"] + i) * 4] = entry_gt
    # CR0 is an ordinary mutable home. It deliberately diverges from the
    # suspended E-GT, which alone reconstructs CR6/CR14 on resume.
    mem[new_base + layout["caps_start"] * 4] = cr0_gt
    for i in range(16):
        mem[new_base + (1 + i) * 4] = 0xA0000000 | i
    suspended_sto = layout["stack_end"] - 2
    return_pc = 40
    return_flags = 0xA
    mem[new_base + THREAD_STO_OFFSET * 4] = suspended_sto | (1 << 12)
    mem[new_base + (suspended_sto + 1) * 4] = entry_gt
    mem[new_base + (suspended_sto + 2) * 4] = (
        layout["stack_end"] | (return_pc << 13) | (return_flags << 28)
    )
    mem[old_base + THREAD_STO_OFFSET * 4] = layout["stack_end"]
    if corruption == "stale_cap":
        mem[new_base + layout["caps_start"] * 4] = cr0_gt ^ (1 << 16)
    elif corruption == "null_egt":
        mem[new_base + (suspended_sto + 1) * 4] = 0
    elif corruption == "stale_egt":
        mem[new_base + (suspended_sto + 1) * 4] = entry_gt ^ (1 << 16)
    elif corruption == "malformed_frame":
        mem[new_base + (suspended_sto + 2) * 4] = layout["stack_start"] - 1
    elif corruption == "nia_oob":
        mem[new_base + (suspended_sto + 2) * 4] = (
            layout["stack_end"] | (48 << 13) | (return_flags << 28)
        )
    elif corruption == "underflow":
        mem[new_base + THREAD_STO_OFFSET * 4] = layout["stack_end"]
    elif corruption == "outgoing_overflow":
        mem[old_base + THREAD_STO_OFFSET * 4] = layout["stack_start"] + 1
    mem[new_base + 258 * 4] = 0xDEADBEEF

    crs = [0] * 16
    crs[6] = entry_gt
    crs[15] = (
        create_gt(0, 0, {"L": 1}, GT_TYPE_INFORM) |
        (pack_ns_word1(63) << 64)
    )
    outgoing_cr_gts = [crs[i] & 0xFFFFFFFF for i in range(12)]
    drs = [0xB0000000 | i for i in range(16)]
    outgoing_drs = list(drs)
    writes = []
    reads = []
    nia = None
    flags_written = False
    previous_read_en = False
    previous_read_addr = 0

    async def bench(ctx):
        nonlocal previous_read_en, previous_read_addr, nia, flags_written
        ctx.set(dut.cr_src, 15)
        ctx.set(dut.cr_dst, 14)
        ctx.set(dut.m_elevated, 0)
        ctx.set(dut.index, thread_slot)
        ctx.set(dut.active_thread_base, old_base)
        ctx.set(dut.cr15_namespace.as_value(), crs[15])
        ctx.set(dut.mem_wr_done, 1)

        async def cycle():
            nonlocal previous_read_en, previous_read_addr, nia, flags_written
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
            if ctx.get(dut.flags_restore_en):
                flags_written = True
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
        terminal = None
        for _ in range(2500):
            await cycle()
            if ctx.get(dut.change_fault):
                terminal = "fault"
                break
            if ctx.get(dut.change_complete):
                terminal = "complete"
                break
        else:
            raise AssertionError("scheduler CHANGE timed out")

        if corruption is not None:
            assert terminal == "fault"
            assert writes == []
            assert crs[14] == 0
            assert drs == [0xB0000000 | i for i in range(16)]
            assert nia is None
            assert not flags_written
            return
        assert terminal == "complete"
        assert nia == return_pc * 4
        assert drs == [0xA0000000 | i for i in range(16)]
        cr14 = crs[14]
        assert (crs[0] & 0xFFFF) == cr0_code_slot
        assert (cr14 & 0xFFFF) == code_slot
        assert ((cr14 >> 32) & 0xFFFFFFFF) == code_base + 4
        assert ((cr14 >> 64) & 0x1FFFFF) == 47
        assert mem[new_base + THREAD_STO_OFFSET * 4] == (
            layout["stack_end"] | (return_flags << 28)
        )
        assert mem[new_base + 258 * 4] == 0xDEADBEEF
        assert old_base + THREAD_STO_OFFSET * 4 in writes
        assert mem[old_base + (layout["stack_end"] - 1) * 4] == entry_gt
        assert mem[old_base + layout["stack_end"] * 4] == (
            layout["stack_end"] | (1 << 13)
        )
        assert mem[old_base + THREAD_STO_OFFSET * 4] == (
            (layout["stack_end"] - 2) | (1 << 12)
        )
        for i, gt in enumerate(outgoing_cr_gts):
            assert mem[old_base + (layout["caps_start"] + i) * 4] == gt
        for i, value in enumerate(outgoing_drs):
            assert mem[old_base + (1 + i) * 4] == value
        forbidden = {
            old_base + 258 * 4,
            new_base + 258 * 4,
        }
        assert forbidden.isdisjoint(writes)

    sim.add_testbench(bench)
    sim.run()


def test_all_frame_paths_follow_the_scheduler_active_thread_base():
    core_source = Path("hardware/core.py").read_text()
    dependencies = _eq_dependencies(core_source)
    for frame_path in (
        "u_call.thread_base",
        "u_return.thread_base",
        "u_eloadcall.thread_base",
    ):
        assert _depends_on(
            dependencies, frame_path, "self.active_thread_base"
        ), f"{frame_path} must use the scheduler-selected active Thread base"
    return_source = Path("hardware/ret.py").read_text()
    assert "thread_base_latched.eq(self.thread_base)" in return_source


def _thread_switch_core_image(decoded_change, corruption=None):
    """Return a bootable image with two canonical scheduler Thread frames."""
    dmem = _build_dmem_init()
    source_code_base = 0x600
    target_code_base = 0x2000
    target_thread_base = 0x7000
    target_thread_slot = 11
    target_code_slot = 9
    body_words = thread_body_words(2)
    layout = thread_layout(body_words, 32)
    assert layout["valid"]

    def descriptor(slot, location, limit):
        word = slot * 4
        authority = pack_ns_word1(limit)
        dmem[word] = location
        dmem[word + 1] = authority
        dmem[word + 2] = integrity32(location, authority)
        dmem[word + 3] = 0

    descriptor(target_thread_slot, target_thread_base, body_words - 1)
    descriptor(target_code_slot, target_code_base, 4095)
    target_gt = make_gt(
        GT_TYPE_INFORM, PERM_MASK_E, slot_id=target_code_slot)

    source_word = source_code_base // 4
    # CHANGE frames carry absolute word NIAs, and admission checks those
    # against cw. Keep each tiny test program at its real image address while
    # retaining a code zone large enough to include that address.
    dmem[source_word] = pack_lump_header(3, 400, 2, 0)
    if decoded_change:
        dmem[source_word + 1] = encode_church(
            ChurchOpcode.CHANGE,
            CondCode.AL,
            cr_dst=14,
            cr_src=15,
            imm=target_thread_slot,
        )
        dmem[source_word + 2] = encode_turing(
            TuringOpcode.IADD, CondCode.AL, dr_dst=1, dr_src=1, imm=1)
        dmem[source_word + 3] = encode_turing(
            TuringOpcode.BRANCH, CondCode.AL, imm=0)
    else:
        dmem[source_word + 1] = encode_turing(
            TuringOpcode.IADD, CondCode.AL, dr_dst=1, dr_src=1, imm=1)
        dmem[source_word + 2] = encode_turing(
            TuringOpcode.BRANCH, CondCode.AL, imm=0)

    target_word = target_code_base // 4
    dmem[target_word] = pack_lump_header(6, target_word + 2, 1, 0)
    dmem[target_word + 1] = encode_turing(
        TuringOpcode.IADD, CondCode.AL, dr_dst=2, dr_src=2, imm=1)
    dmem[target_word + 2] = encode_turing(
        TuringOpcode.BRANCH, CondCode.AL, imm=0)

    thread_word = target_thread_base // 4
    dmem[thread_word] = pack_lump_header(2, 32, THREAD_CAP_WORDS, 2)
    dmem[thread_word + THREAD_STO_OFFSET] = (
        (layout["stack_end"] - 2) | (1 << 12))
    dmem[thread_word + layout["stack_end"] - 1] = target_gt
    dmem[thread_word + layout["stack_end"]] = (
        layout["stack_end"] | ((target_word + 1) << 13))
    dmem[thread_word + layout["caps_start"]] = target_gt
    if corruption == "null_egt":
        dmem[thread_word + layout["stack_end"] - 1] = 0
    elif corruption is not None:
        raise ValueError(f"unknown Thread-switch corruption: {corruption}")
    return (
        dmem,
        source_code_base + 4,
        source_code_base + 8,
        target_code_base + 4,
        dmem[target_word + 1],
        dmem[source_word + (2 if decoded_change else 1)],
        dmem[source_word + 1] if decoded_change else None,
    )


@pytest.mark.parametrize("decoded_change", [False, True])
def test_full_core_thread_switch_resume_nia_contract(decoded_change):
    """A scheduler request preserves its boundary; CHANGE advances past itself."""
    (dmem, source_first, source_next, target_first, target_instr,
     source_resume_instr, decoded_change_instr) = \
        _thread_switch_core_image(decoded_change)
    dut = BootRomHarness(dmem)
    observed = []

    async def bench(ctx):
        ctx.set(dut.core.thread_switch_req, 0)
        ctx.set(dut.core.thread_switch_index, 11)

        async def request_switch():
            # Match the Wukong contract: the synchronized button request stays
            # asserted until the core accepts it at a clean unit boundary.
            ctx.set(dut.core.thread_switch_req, 1)
            for _ in range(20):
                await ctx.delay(1e-9)
                if ctx.get(dut.core.thread_switch_busy):
                    await ctx.tick()
                    break
                await ctx.tick()
            else:
                raise AssertionError("scheduler request was not accepted")
            ctx.set(dut.core.thread_switch_req, 0)

        # Wait until the boot CALL has selected the source program. For the
        # external case, assert the request before that pending word can retire.
        for _ in range(800):
            if ctx.get(dut.core.nia) == source_first:
                break
            await ctx.tick()
        else:
            raise AssertionError("source program was not entered")

        if not decoded_change:
            await request_switch()

        # The decoded case starts its own CHANGE. In either case, reaching and
        # retiring the target instruction proves the canonical frame restored.
        for _ in range(2500):
            if ctx.get(dut.core.retire_valid):
                retire = (
                    ctx.get(dut.core.retire_nia),
                    ctx.get(dut.core.retire_instr),
                    bool(ctx.get(dut.core.retire_fault_valid)),
                )
                observed.append(retire)
                if retire[2]:
                    raise AssertionError(
                        "instruction faulted before target retirement: "
                        f"nia={retire[0]:#x} "
                        f"fault={ctx.get(dut.core.retire_fault_code)}")
                if retire[1] == target_instr:
                    assert retire[0] == target_first
                    await ctx.tick()
                    break
            if ctx.get(dut.core.thread_switch_fault):
                raise AssertionError(
                    "switch to Thread 11 faulted: "
                    f"fault={ctx.get(dut.core.fault)} nia={ctx.get(dut.core.nia):#x}")
            await ctx.tick()
        else:
            raise AssertionError(
                "target instruction did not retire: "
                f"nia={ctx.get(dut.core.nia):#x} "
                f"fault={ctx.get(dut.core.fault)} "
                f"fault_valid={ctx.get(dut.core.fault_valid)} "
                f"switch_fault={ctx.get(dut.core.thread_switch_fault)} "
                f"observed={observed[-8:]}")

        ctx.set(dut.core.thread_switch_index, 1)
        await request_switch()
        for _ in range(2500):
            if ctx.get(dut.core.retire_valid):
                observed.append((
                    ctx.get(dut.core.retire_nia),
                    ctx.get(dut.core.retire_instr),
                    bool(ctx.get(dut.core.retire_fault_valid)),
                ))
            if ctx.get(dut.core.thread_switch_complete):
                break
            await ctx.tick()
        else:
            raise AssertionError("switch back to Thread 1 timed out")

        expected_resume = source_next if decoded_change else source_first
        for _ in range(400):
            if ctx.get(dut.core.retire_valid):
                retire = (
                    ctx.get(dut.core.retire_nia),
                    ctx.get(dut.core.retire_instr),
                    bool(ctx.get(dut.core.retire_fault_valid)),
                )
                observed.append(retire)
                if retire[:2] == (expected_resume, source_resume_instr):
                    break
            await ctx.tick()
        else:
            raise AssertionError(
                "resumed source instruction did not retire: "
                f"nia={ctx.get(dut.core.nia):#x} "
                f"dr1={ctx.get(dut.core.debug_dr_words[1])} "
                f"observed={observed[-12:]}")

        # Keep running long enough to expose an accidental replay.
        for _ in range(20):
            await ctx.tick()
            if ctx.get(dut.core.retire_valid):
                observed.append((
                    ctx.get(dut.core.retire_nia),
                    ctx.get(dut.core.retire_instr),
                    bool(ctx.get(dut.core.retire_fault_valid)),
                ))

        assert ctx.get(dut.core.debug_dr_words[1]) == 1

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()

    expected_resume = source_next if decoded_change else source_first
    assert not [retire for retire in observed if retire[2]], observed
    assert [
        event for event in observed
        if event[:2] == (target_first, target_instr)
    ] == [(target_first, target_instr, False)]
    assert [
        event for event in observed
        if event[:2] == (expected_resume, source_resume_instr)
    ] == [(expected_resume, source_resume_instr, False)]
    if decoded_change:
        assert sum(
            instruction == decoded_change_instr
            for _, instruction, _ in observed
        ) == 1

@pytest.mark.parametrize(
    ("condition_name", "saved_flags", "condition"),
    [
        ("Z", 0b0010, CondCode.EQ),
        ("N", 0b0001, CondCode.MI),
        ("C", 0b0100, CondCode.CS),
        ("V", 0b1000, CondCode.VS),
        ("HI", 0b0100, CondCode.HI),
        ("LS", 0b0110, CondCode.LS),
        ("GE", 0b1001, CondCode.GE),
        ("LT", 0b0001, CondCode.LT),
        ("GT", 0b1101, CondCode.GT),
        ("LE", 0b0010, CondCode.LE),
    ],
)
def test_full_core_thread_switch_preserves_flags_for_next_branch(
        condition_name, saved_flags, condition):
    """A resumed conditional branch consumes canonical NZCV from its frame."""
    (dmem, source_first, _, target_first, _, source_instr, _) = \
        _thread_switch_core_image(False)
    target_word = (target_first - 4) // 4
    change_back = encode_church(
        ChurchOpcode.CHANGE,
        CondCode.AL,
        cr_dst=14,
        cr_src=15,
        imm=1,
    )
    branch_on_restored_flag = encode_turing(
        TuringOpcode.BRANCH, condition, imm=3)
    fallthrough = encode_turing(
        TuringOpcode.IADD, CondCode.AL, dr_dst=3, dr_src=3, imm=1)
    taken = encode_turing(
        TuringOpcode.IADD, CondCode.AL, dr_dst=4, dr_src=4, imm=1)
    loop = encode_turing(TuringOpcode.BRANCH, CondCode.AL, imm=0)
    dmem[target_word] = pack_lump_header(5, target_word + 5, 1, 0)
    dmem[target_word + 1:target_word + 6] = [
        change_back, branch_on_restored_flag, fallthrough, loop, taken,
    ]
    target_thread_word = 0x7000 // 4
    target_layout = thread_layout(thread_body_words(2), 32)
    target_frame_word = target_thread_word + target_layout["stack_end"]
    dmem[target_frame_word] |= saved_flags << 28
    dut = BootRomHarness(dmem)
    observed = []
    flag_snapshots = {}

    async def bench(ctx):
        ctx.set(dut.core.thread_switch_req, 0)
        ctx.set(dut.core.thread_switch_index, 11)

        async def request_target_thread():
            ctx.set(dut.core.thread_switch_req, 1)
            for _ in range(20):
                await ctx.delay(1e-9)
                if ctx.get(dut.core.thread_switch_busy):
                    await ctx.tick()
                    break
                await ctx.tick()
            else:
                raise AssertionError("scheduler request was not accepted")
            ctx.set(dut.core.thread_switch_req, 0)

        for _ in range(800):
            if ctx.get(dut.core.nia) == source_first:
                await request_target_thread()
                break
            await ctx.tick()
        else:
            raise AssertionError("source program was not entered")

        switched_out = False
        resume_requested = False
        for _ in range(5000):
            if (
                "before_switch" not in flag_snapshots
                and ctx.get(dut.core.nia) == target_first
            ):
                flag_snapshots["before_switch"] = ctx.get(
                    dut.core.flags.as_value())
            if ctx.get(dut.core.retire_valid):
                event = (
                    ctx.get(dut.core.retire_nia),
                    ctx.get(dut.core.retire_instr),
                    bool(ctx.get(dut.core.retire_fault_valid)),
                )
                observed.append(event)
                retired_flags = ctx.get(dut.core.retire_flags.as_value())
                if event[:2] == (target_first, change_back):
                    switched_out = True
                if (
                    switched_out
                    and not resume_requested
                    and event[:2] == (source_first, source_instr)
                ):
                    await ctx.tick()
                    flag_snapshots["intervening_thread"] = ctx.get(
                        dut.core.flags.as_value())
                    assert (
                        flag_snapshots["intervening_thread"] !=
                        flag_snapshots["before_switch"]
                    ), "intervening Thread must establish different NZCV"
                    await request_target_thread()
                    resume_requested = True
                    continue
                if event[:2] == (
                        target_first + 4, branch_on_restored_flag):
                    flag_snapshots["branch_retire"] = retired_flags
                    flag_snapshots["after_resume_branch"] = ctx.get(
                        dut.core.flags.as_value())
                if event[:2] == (target_first + 16, taken):
                    await ctx.tick()
                    break
                if event[2]:
                    raise AssertionError(
                        "instruction faulted before resumed branch completed: "
                        f"{event}")
            await ctx.tick()
        else:
            raise AssertionError(
                f"{condition_name} branch did not reach taken path after round trip: "
                f"{observed[-12:]}")
        assert switched_out
        assert resume_requested

        for _ in range(20):
            await ctx.tick()
            if ctx.get(dut.core.retire_valid):
                observed.append((
                    ctx.get(dut.core.retire_nia),
                    ctx.get(dut.core.retire_instr),
                    bool(ctx.get(dut.core.retire_fault_valid)),
                ))

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()

    change_back_event = (target_first, change_back, False)
    branch_nia = target_first + 4
    assert not [event for event in observed if event[2]], observed
    assert [
        event for event in observed if event[:2] == change_back_event[:2]
    ] == [change_back_event]
    assert [
        event for event in observed
        if event[:2] == (branch_nia, branch_on_restored_flag)
    ] == [(branch_nia, branch_on_restored_flag, False)]
    assert [
        event for event in observed
        if event[:2] == (target_first + 8, fallthrough)
    ] == []
    assert [
        event for event in observed
        if event[:2] == (target_first + 16, taken)
    ] == [(target_first + 16, taken, False)]
    change_back_pos = observed.index(change_back_event)
    branch_pos = observed.index(
        (branch_nia, branch_on_restored_flag, False))
    assert change_back_pos < branch_pos
    assert flag_snapshots["before_switch"] == saved_flags
    assert flag_snapshots["intervening_thread"] != saved_flags
    assert flag_snapshots["branch_retire"] == saved_flags
    assert (
        flag_snapshots["after_resume_branch"] ==
        flag_snapshots["before_switch"]
    )

@pytest.mark.parametrize("arithmetic_opcode", [
    TuringOpcode.IADD,
    TuringOpcode.ISUB,
])
def test_full_core_signed_overflow_branches_follow_live_arithmetic(
        arithmetic_opcode):
    """VS and VC consume V set and cleared by the preceding live arithmetic."""
    dmem = _build_dmem_init()
    program_word = 384
    setup = [
        encode_turing(
            TuringOpcode.IADD, CondCode.AL, dr_dst=1, dr_src=0, imm=1),
        encode_turing(
            TuringOpcode.SHL, CondCode.AL, dr_dst=1, dr_src=1, imm=31),
    ]
    if arithmetic_opcode == TuringOpcode.IADD:
        # 0x80000000 - 1 = 0x7fffffff, then +1 overflows signed addition.
        setup.append(encode_turing(
            TuringOpcode.ISUB, CondCode.AL, dr_dst=1, dr_src=1, imm=1))
        overflow = encode_turing(
            arithmetic_opcode, CondCode.AL, dr_dst=2, dr_src=1, imm=1)
    else:
        # 0x80000000 - 1 overflows signed subtraction.
        overflow = encode_turing(
            arithmetic_opcode, CondCode.AL, dr_dst=2, dr_src=1, imm=1)

    clear_overflow = encode_turing(
        arithmetic_opcode, CondCode.AL, dr_dst=2, dr_src=0, imm=0)
    branch_vs = encode_turing(TuringOpcode.BRANCH, CondCode.VS, imm=3)
    branch_vc = encode_turing(TuringOpcode.BRANCH, CondCode.VC, imm=3)
    mark_wrong_vs = encode_turing(
        TuringOpcode.IADD, CondCode.AL, dr_dst=3, dr_src=3, imm=1)
    mark_taken_vs = encode_turing(
        TuringOpcode.IADD, CondCode.AL, dr_dst=4, dr_src=4, imm=1)
    mark_wrong_vc = encode_turing(
        TuringOpcode.IADD, CondCode.AL, dr_dst=5, dr_src=5, imm=1)
    mark_taken_vc = encode_turing(
        TuringOpcode.IADD, CondCode.AL, dr_dst=6, dr_src=6, imm=1)
    loop = encode_turing(TuringOpcode.BRANCH, CondCode.AL, imm=0)
    program = setup + [
        overflow,
        branch_vs,
        mark_wrong_vs,
        loop,
        mark_taken_vs,
        clear_overflow,
        branch_vc,
        mark_wrong_vc,
        loop,
        mark_taken_vc,
        loop,
    ]
    dmem[program_word] = pack_lump_header(
        3, program_word + len(program), 2, 0)
    dmem[program_word + 1:program_word + 1 + len(program)] = program
    dut = BootRomHarness(dmem)
    branch_flags = {}

    async def bench(ctx):
        for _ in range(3000):
            if ctx.get(dut.core.retire_valid):
                assert not ctx.get(dut.core.retire_fault_valid)
                instruction = ctx.get(dut.core.retire_instr)
                if instruction == branch_vs:
                    branch_flags["VS"] = ctx.get(
                        dut.core.retire_flags.as_value())
                elif instruction == branch_vc:
                    branch_flags["VC"] = ctx.get(
                        dut.core.retire_flags.as_value())
                if ctx.get(dut.core.debug_dr_words[6]) == 1:
                    break
            await ctx.tick()
        else:
            raise AssertionError(
                "live arithmetic did not reach both taken branch markers")

        assert ctx.get(dut.core.debug_dr_words[3]) == 0
        assert ctx.get(dut.core.debug_dr_words[4]) == 1
        assert ctx.get(dut.core.debug_dr_words[5]) == 0
        assert ctx.get(dut.core.debug_dr_words[6]) == 1

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()

    assert branch_flags["VS"] & 0b1000
    assert not (branch_flags["VC"] & 0b1000)
def test_full_core_failed_thread_switch_preserves_source_context():
    """A rejected target frame cannot partially serialize the running Thread."""
    (dmem, source_first, _source_next, _target_first, _target_instr,
     source_instr, _decoded_change_instr) = _thread_switch_core_image(
         False, corruption="null_egt")
    dut = BootRomHarness(dmem)

    async def bench(ctx):
        ctx.set(dut.core.defer_fault_reset, 1)
        ctx.set(dut.core.thread_switch_req, 0)
        ctx.set(dut.core.thread_switch_index, 11)

        for _ in range(800):
            if ctx.get(dut.core.nia) == source_first:
                break
            await ctx.tick()
        else:
            raise AssertionError("source program was not entered")

        source_crs = tuple(
            tuple(ctx.get(word) for word in cr)
            for cr in dut.core.debug_cr_words
        )
        source_drs = tuple(ctx.get(word) for word in dut.core.debug_dr_words)
        source_slot = ctx.get(dut.core.active_thread_slot)
        source_base = ctx.get(dut.core.active_thread_base)

        ctx.set(dut.core.thread_switch_req, 1)
        for _ in range(20):
            await ctx.delay(1e-9)
            if ctx.get(dut.core.thread_switch_busy):
                await ctx.tick()
                break
            await ctx.tick()
        else:
            raise AssertionError("scheduler request was not accepted")
        ctx.set(dut.core.thread_switch_req, 0)

        for _ in range(2500):
            await ctx.delay(1e-9)
            if ctx.get(dut.core.thread_switch_fault):
                assert ctx.get(dut.core.fault) == FaultType.NULL_CAP
                assert ctx.get(dut.core.nia) == source_first
                assert ctx.get(dut.core.active_thread_slot) == source_slot
                assert ctx.get(dut.core.active_thread_base) == source_base
                assert tuple(
                    tuple(ctx.get(word) for word in cr)
                    for cr in dut.core.debug_cr_words
                ) == source_crs
                assert tuple(
                    ctx.get(word) for word in dut.core.debug_dr_words
                ) == source_drs
                await ctx.tick()
                break
            await ctx.tick()
        else:
            raise AssertionError("invalid target Thread did not fault")

        for _ in range(400):
            if ctx.get(dut.core.retire_valid):
                retire = (
                    ctx.get(dut.core.retire_nia),
                    ctx.get(dut.core.retire_instr),
                    bool(ctx.get(dut.core.retire_fault_valid)),
                )
                if retire == (source_first, source_instr, False):
                    break
            await ctx.tick()
        else:
            raise AssertionError("pending source instruction did not recover")

        assert ctx.get(dut.core.debug_dr_words[1]) == source_drs[1] + 1
        assert ctx.get(dut.core.active_thread_slot) == source_slot
        assert ctx.get(dut.core.active_thread_base) == source_base

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()
