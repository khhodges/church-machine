"""Synthetic transition evidence, independent of catalog/images/manifest."""
import pytest
from amaranth import Module
from amaranth.sim import Simulator
from hardware.change import ChurchChange
from hardware.switch import ChurchSwitch
from hardware.integrity32 import integrity32


def test_core_handoff_control_has_no_combinational_cycle():
    # Behavioral simulation can settle a start/busy loop that netlist
    # conversion correctly rejects. This is structural, not vendor synthesis.
    from amaranth.back import rtlil
    from hardware.core import ChurchCore
    core = ChurchCore()
    text = rtlil.convert(core, ports=[core.boot_start, core.imem_data,
                                    core.imem_valid, core.retire_valid])
    assert "module" in text


def cap(gt, base, limit):
    return gt | base << 32 | limit << 64


def fixture(root=False):
    mem = {}
    def descriptor(ns, slot, base, limit):
        for i, word in enumerate((base, limit, integrity32(base, limit), 0)):
            mem[ns + slot * 16 + i * 4] = word
    # Conflicting identities: destination slot 2/3 have no matching old body.
    descriptor(0, 4, 0x4000, 63)
    descriptor(0, 2, 0x1000, 255)
    descriptor(0, 3, 0x2000, 63)
    descriptor(0x4000, 2, 0x5000, 255)
    descriptor(0x4000, 3, 0x6000, 63)
    mem[0x4000] = 0xF8000100 | (16 << 10)
    mem[0x4004] = 0x4000
    mem[0x4008] = 3
    mem[0x3000] = 0x02000004
    for base, code in ((0x1000, 0x2000), (0x5000, 0x6000)):
        mem[base] = 0xF900020C | (32 << 10)
        mem[base + 68] = 0x10F1
        mem[base + 242 * 4] = 0x4A000003
        mem[base + 243 * 4] = 0x10F3  # code-relative NIA zero
        mem[base + 244 * 4] = 0x4A000003
        mem[code] = 0xF8000002 | (48 << 10)
        mem[code + 62 * 4] = 0x4A000003
        # Unused invalid row must NOT be eagerly admitted.
        mem[code + 63 * 4] = 0x020001FF
    if root:
        mem[0x5000 + 243 * 4] = 0x10F3 | (0x7FFF << 13)
    return mem


def run(switch=True, mutate=None, root=False, self_target=False, poison=True,
        indexed=False, lookup_row=0, source_m=False):
    change, sw = ChurchChange(), ChurchSwitch()
    m = Module()
    m.submodules.change, m.submodules.switch = change, sw
    if switch:
        m.d.comb += [
            change.change_start.eq(sw.handoff_start), change.ordinary.eq(1),
            change.namespace_handoff.eq(sw.handoff_start),
            change.incoming_namespace.eq(sw.incoming_namespace),
            change.nia_current.eq(sw.accepted_nia),
            change.flags_in.eq(sw.accepted_flags),
            sw.handoff_done.eq(change.change_complete),
            sw.handoff_fault.eq(change.change_fault),
            sw.handoff_fault_type.eq(change.fault_type),
        ]
    mem = fixture(root)
    mem[0x1000 + 68] = 0x10F3  # outgoing running Thread, not dormant
    crs = [0] * 16
    crs[0] = 0x4A000003
    crs[1] = 0x02000002
    crs[6] = cap(0x1A000003, 0x20F8, 1)
    crs[7] = cap(0x1A000003, 0x3000, 0)
    crs[12] = cap(0x02000002, 0x1000, 255)
    crs[13] = 0x12345678  # canary: reserved means no writes, not clearing
    crs[15] = cap(0x02000001, 0, 63)
    if indexed:
        crs[6] = cap(0x4A000003 if source_m else 0x1A000003, 0x20D0, 9)
        mem[0x20D0 + lookup_row * 4] = crs[1]
    if self_target:
        mem[0x1000 + 68] = 0x10F3
    if mutate:
        mutate(mem, crs)
    result = {"writes": [], "reads": [], "crs": crs, "mem": mem, "nia": []}
    before = dict(mem)

    async def bench(ctx):
        pending = None
        ctx.set(change.mem_wr_done, 1)
        ctx.set(change.active_thread_owned, 1)
        ctx.set(change.active_thread_base, 0x1000)
        ctx.set(change.code_base, 0x2004)
        ctx.set(sw.cr_src, 7)
        ctx.set(sw.target_m, 1)
        ctx.set(sw.nia_current, 0x2004)
        if not switch:
            ctx.set(change.ordinary, 1)
            ctx.set(change.cr_src, 6 if indexed else 1)
            ctx.set(change.cr_dst, 12 if indexed else 0)
            ctx.set(change.index, lookup_row if indexed else 0)
            ctx.set(change.cr6_m, source_m)
            ctx.set(change.nia_current, 0x2004)
        for cycle in range(2000):
            ctx.set(sw.switch_start, switch and cycle == 0)
            if not switch:
                ctx.set(change.change_start, cycle == 0)
            for unit in (change, sw):
                ctx.set(unit.cr15_namespace.as_value(), crs[15])
                ctx.set(unit.mem_rd_data, mem.get(pending, 0))
                ctx.set(unit.mem_rd_valid, pending is not None)
                ctx.set(unit.cr_rd_data.as_value(), crs[ctx.get(unit.cr_rd_addr)])
            ctx.set(change.cr12_thread.as_value(), crs[12])
            ctx.set(change.dr_rd_data, ctx.get(change.dr_rd_addr) + 100)
            await ctx.delay(1e-9)
            for unit in (change, sw):
                ctx.set(unit.cr_rd_data.as_value(), crs[ctx.get(unit.cr_rd_addr)])
            await ctx.delay(1e-9)
            rd = (ctx.get(change.mem_rd_addr) if ctx.get(change.mem_rd_en) else
                  ctx.get(sw.mem_addr) if ctx.get(sw.mem_rd_en) else None)
            if rd is not None:
                result["reads"].append(rd)
            if ctx.get(change.mem_wr_en):
                address, data = ctx.get(change.mem_wr_addr), ctx.get(change.mem_wr_data)
                mem[address] = data
                result["writes"].append(("mem", address))
            if ctx.get(change.cr_wr_en):
                address = ctx.get(change.cr_wr_addr)
                crs[address] = ctx.get(change.cr_wr_data.as_value())
                result["writes"].append(("cr", address))
            if ctx.get(change.nia_restore_en):
                result["nia"].append(ctx.get(change.nia_restore_val))
            if ctx.get(change.change_fault) or ctx.get(sw.switch_fault):
                result["fault"] = (ctx.get(change.fault_type) if ctx.get(change.change_fault)
                                   else ctx.get(sw.fault_type))
                return
            if ctx.get(change.change_complete):
                result["fault"] = 0
                assert not switch or ctx.get(sw.m_consume_en)
                return
            await ctx.tick()
            pending = rd
            if cycle == 0 and poison:
                # Selectors, permission and continuation are accepted once.
                ctx.set(sw.cr_src, 13)
                ctx.set(sw.target_m, 0)
                ctx.set(sw.index, 0xFFFFFFFF)
                ctx.set(sw.nia_current, 0xDEAD)
                if not switch:
                    crs[1] = 0xFFFFFFFF
                    if indexed:
                        ctx.set(change.cr6_m, 0)
                    ctx.set(change.cr_src, 13)
                    ctx.set(change.cr_dst, 13)
                    ctx.set(change.index, 99)
                    ctx.set(change.nia_current, 0xDEAD)
        pytest.fail("transition did not terminate")
    sim = Simulator(m)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()
    assert crs[13] == 0x12345678
    if result["fault"]:
        assert not result["writes"]
        assert mem == before
    return result


def test_combined_handoff_destination_table_and_save_before_root_commit():
    r = run()
    assert r["fault"] == 0
    assert r["crs"][15] == cap(0x02000004, 0x4000, 63)
    assert r["crs"][12] == cap(0x02000002, 0x5000, 255)
    assert r["nia"] == [0x6004]
    assert 0x4020 in r["reads"] and 0x4030 in r["reads"]
    midpoint = r["writes"].index(("cr", 15))
    assert all(kind == "mem" for kind, _ in r["writes"][:midpoint])
    assert r["mem"][0x1000 + 243 * 4] >> 13 & 0x7FFF == 1


@pytest.mark.parametrize("mutate", [
    lambda mem, cr: mem.__setitem__(0x4028, 0),  # bad entry integrity
    lambda mem, cr: mem.__setitem__(0x5000, 0),  # wrong Thread type
    lambda mem, cr: mem.__setitem__(0x5000 + 243 * 4, 0),  # invalid frame
    lambda mem, cr: mem.__setitem__(0x5000 + 245 * 4, 0x020001FF),
    lambda mem, cr: mem.__setitem__(0x4000, 0),  # wrong Namespace type
    lambda mem, cr: mem.__setitem__(0x4004, 0),  # wrong metadata base
    lambda mem, cr: mem.__setitem__(0x4008, 16),  # member count != capacity
])
def test_failed_destination_never_publishes(mutate):
    assert run(mutate=mutate)["fault"]


def test_change_self_target_captures_new_continuation():
    r = run(switch=False, self_target=True)
    assert r["fault"] == 0
    assert r["nia"] == [0x2008]


@pytest.mark.parametrize("row", [0, 8, 9])
@pytest.mark.parametrize("source_m", [False, True])
def test_indexed_change_single_gt_self_target_and_captured_source(row, source_m):
    r = run(switch=False, self_target=True, indexed=True,
            lookup_row=row, source_m=source_m)
    assert r["fault"] == 0
    assert r["nia"] == [0x2008]
    assert 0x20D0 + row * 4 in r["reads"]
    # No scratch CR or incoming context write before the outgoing save.
    assert r["writes"][0][0] == "mem"


@pytest.mark.parametrize("mutate,expected", [
    (lambda mem, cr: cr.__setitem__(6, cap(0x4A000003, 0x3000, 9)), 4),
    (lambda mem, cr: cr.__setitem__(6, cap(0x1A000003, 0x3000, 7)), 8),
    (lambda mem, cr: cr.__setitem__(6, cap(0x1A000003, 0xFFFFFFFC, 9)), 8),
    (lambda mem, cr: cr.__setitem__(6, cap(0x1A000003, 0x3001, 9)), 8),
])
def test_indexed_change_denied_lookup_has_no_effects(mutate, expected):
    r = run(switch=False, self_target=True, indexed=True,
            lookup_row=8, mutate=mutate)
    assert r["fault"] == expected
    assert not r["reads"]
    assert not any(kind == "cr" and addr == 15 for kind, addr in r["writes"])


def test_indexed_change_rejects_revoked_source_before_row_read():
    def revoke(mem, cr):
        authority = 63 | (1 << 21)
        mem[0x34] = authority
        mem[0x38] = integrity32(0x2000, authority)
    r = run(switch=False, self_target=True, indexed=True,
            lookup_row=8, mutate=revoke)
    assert r["fault"] == 0x1D
    assert 0x20F0 not in r["reads"]
    assert not r["writes"]


def test_switch_root_preserves_poison_frame():
    r = run(root=True)
    assert r["fault"] == 0
    assert r["nia"] == [0x6004]  # NIA 0 is relative to the entry code body
    assert r["mem"][0x5000 + 68] == 0x10F1


def test_entry_version_is_fixed_zero_not_adopted_from_descriptor():
    def revoke(mem, cr):
        authority = 255 | (1 << 20)
        mem[0x4024] = authority
        mem[0x4028] = integrity32(0x5000, authority)
    assert run(mutate=revoke)["fault"] == 0x1D


def test_ordinary_change_rejects_permissions_and_poison_continuation():
    assert run(switch=False, mutate=lambda mem, cr:
               cr.__setitem__(1, 0x12000002))["fault"] == 0x1E
    def poison(mem, cr):
        mem[0x1000 + 68] = 0x10F1
        mem[0x1000 + 243 * 4] = 0x10F3 | (0x7FFF << 13)
        # Different running Thread: the operand is a dormant target.
        cr[12] = cap(0x02000005, 0x7000, 255)
    assert run(switch=False, mutate=poison)["fault"] == 0x1D


@pytest.mark.parametrize("word", [0x20068000, 0x28068000, 0x287FFFFF, 0x20637FFF])
def test_false_predicate_skips_reserved_operands_and_m_checks(word):
    from hardware.core import ChurchCore
    from hardware.sim_boot_helpers import boot_core
    from hardware.test_phase1_independent_execution import execute_data
    dut = ChurchCore()

    async def bench(ctx):
        ctx.set(dut.defer_fault_reset, 1)
        await boot_core(ctx, dut)
        for _ in range(3):
            await execute_data(ctx, dut, 0xAF784001)  # Z=0, leaves boot window
        assert ctx.get(dut.flags.Z) == 0
        await execute_data(ctx, dut, word)  # EQ, invalid if executed

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()


@pytest.mark.parametrize("word, fault", [(0x2F038000, 4), (0x2F7B8000, 11),
                                        (0x27068000, 11), (0x27660000, 11)])
def test_core_rejects_without_any_transition_write(word, fault):
    from hardware.core import ChurchCore
    from hardware.sim_boot_helpers import boot_core
    from hardware.test_phase1_independent_execution import execute_data, snapshot
    dut = ChurchCore()

    async def bench(ctx):
        ctx.set(dut.defer_fault_reset, 1)
        await boot_core(ctx, dut)
        for _ in range(3):
            await execute_data(ctx, dut, 0xAF784001)
        before = snapshot(ctx, dut)
        ctx.set(dut.imem_data, word)
        ctx.set(dut.imem_valid, 1)
        for _ in range(30):
            assert not ctx.get(dut.dmem_wr_en)
            assert snapshot(ctx, dut) == before
            if ctx.get(dut.fault_valid):
                assert ctx.get(dut.fault) == fault
                return
            await ctx.tick()
            ctx.set(dut.imem_valid, 0)
        pytest.fail("missing rejection")

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()


@pytest.mark.parametrize("indexed", [False, True])
def test_core_switch_retires_once_then_executes_destination_instruction(indexed):
    from hardware.core import ChurchCore
    from hardware.sim_boot_helpers import boot_core
    from hardware.test_phase1_independent_execution import execute_data
    dut = ChurchCore()
    mem = fixture()
    # Bootstrap test-only capabilities through real LOAD, not internal seeds.
    mem[16], mem[20], mem[24] = 0, 63, integrity32(0, 63)
    mem[0x400], mem[0x404] = 0x02000001, 0x02000002
    mem[0x20FC] = 0x02000004  # source C-List row 1 selects destination

    async def bench(ctx):
        ctx.set(dut.defer_fault_reset, 1)
        await boot_core(ctx, dut)
        for _ in range(3):
            await execute_data(ctx, dut, 0xAF784001)

        async def issue(word, limit=2500):
            pending = None
            ctx.set(dut.imem_valid, 1)
            ctx.set(dut.imem_data, word)
            issuer = ctx.get(dut.imem_addr)
            for cycle in range(limit):
                ctx.set(dut.dmem_rd_valid, pending is not None)
                ctx.set(dut.dmem_rd_data, mem.get(pending, 0))
                await ctx.delay(1e-9)
                assert not ctx.get(dut.fault_valid), (hex(word), cycle, ctx.get(dut.fault))
                rd = ctx.get(dut.dmem_addr) if ctx.get(dut.dmem_rd_en) else None
                if ctx.get(dut.dmem_wr_en):
                    mem[ctx.get(dut.dmem_addr)] = ctx.get(dut.dmem_wr_data)
                done = ctx.get(dut.retire_valid)
                if done:
                    assert ctx.get(dut.retire_instr) == word
                    assert ctx.get(dut.retire_nia) == issuer
                await ctx.tick()
                pending = rd
                ctx.set(dut.imem_valid, 0)
                ctx.set(dut.imem_data, 0xFFFFFFFF)  # accepted instruction must persist
                if done:
                    for _ in range(3):
                        assert not ctx.get(dut.retire_valid)
                        assert not ctx.get(dut.fault_valid)
                        await ctx.tick()
                    return
            pytest.fail("core transition timed out")

        await issue(0x077B0000)  # LOAD CR15, CR6, row 0
        await issue(0x070B0010)  # LOAD CR1, CR6, row 1
        await issue(0x27008000)
        assert ctx.get(dut.active_thread_owned)
        assert ctx.get(dut.imem_addr) == 0x2004
        # Seed every writable DR, then self-target the active Thread. Neither
        # snapshot nor self-target restore may accidentally read hardwired DR0.
        for reg in range(1, 16):
            await execute_data(ctx, dut, 0xAF004000 | (reg << 19) | (reg + 100))
        expected_drs = [0] + [reg + 100 for reg in range(1, 16)]
        if indexed:
            mem[0x20FC] = 0x02000002  # current executable's bounded row
        # Exact documented indexed word, through decoder and core wiring.
        await issue(0x27630001 if indexed else 0x27060000)
        mem[0x20FC] = 0x02000004
        assert [ctx.get(dr) for dr in dut.debug_dr_words] == expected_drs
        ctx.set(dut.cr15_m_set, 1)
        await ctx.tick()
        ctx.set(dut.cr15_m_set, 0)
        # The M setup port deliberately rewrites DR11--DR15. Capture the
        # actual outgoing values after that operation, not the earlier ones.
        outgoing_drs = [ctx.get(dr) for dr in dut.debug_dr_words]
        await issue(0x2F030010)  # SWITCH CR6[DR0 + 1], fixed destinations
        assert [mem[0x1000 + 4 * (reg + 1)] for reg in range(16)] == outgoing_drs
        assert ctx.get(dut.debug_cr_words[15][1]) == 0x4000
        assert ctx.get(dut.debug_cr_words[12][1]) == 0x5000
        assert ctx.get(dut.debug_isolated_m_flags) & 8 == 0
        assert ctx.get(dut.imem_addr) == 0x6004
        await execute_data(ctx, dut, 0xAF084007)  # actual first destination retirement
        assert ctx.get(dut.debug_dr_words[1]) == 7

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()
