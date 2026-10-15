"""Independent Phase 1 test inputs. No assembler/decoder/reference imports."""
from amaranth.sim import Simulator
from hardware.core import ChurchCore
from hardware.sim_boot_helpers import boot_core

MASK = 0xffffffff


def word(op, a=0, b=0, operand=0, cond=14):
    assert 0 <= op < 32 and 0 <= a < 16 and 0 <= b < 16
    assert 0 <= operand < 32768 and 0 <= cond < 16
    return op << 27 | cond << 23 | a << 19 | b << 15 | operand


def flags(ctx, core):
    return tuple(ctx.get(core.flags[k]) for k in "NZCV")


def snapshot(ctx, core):
    return (
        tuple(ctx.get(r) for r in core.debug_dr_words),
        tuple(tuple(ctx.get(w) for w in r) for r in core.debug_cr_words),
        flags(ctx, core),
    )


async def execute(ctx, core, instruction, *, fault=False, no_memory=True, next_nia=None):
    """Capture first fault/retirement before recovery; check forbidden bus effects."""
    nia = ctx.get(core.nia)
    ctx.set(core.defer_fault_reset, 1)
    ctx.set(core.imem_data, instruction)
    ctx.set(core.imem_valid, 1)
    trace = []
    for cycle in range(96):
        trace.append((cycle, ctx.get(core.nia), ctx.get(core.retire_valid),
                      ctx.get(core.fault_valid), ctx.get(core.fault)))
        if no_memory:
            assert not ctx.get(core.dmem_wr_en), (hex(instruction), trace)
            assert not ctx.get(core.dmem_rd_en), (hex(instruction), trace)
            assert not ctx.get(core.ns_wr_en), (hex(instruction), trace)
            assert not ctx.get(core.clist_wr_en), (hex(instruction), trace)
        if ctx.get(core.retire_fault_valid):
            assert fault, (hex(instruction), trace)
            assert ctx.get(core.retire_nia) == nia, trace
            assert ctx.get(core.retire_instr) == instruction, trace
            ctx.set(core.imem_valid, 0)
            return ctx.get(core.retire_fault_code)
        if ctx.get(core.fault_valid):
            assert fault, (hex(instruction), trace)
            assert not ctx.get(core.retire_valid), trace
            assert ctx.get(core.nia) == nia, trace
            ctx.set(core.imem_valid, 0)
            return ctx.get(core.fault)
        retired = ctx.get(core.retire_valid)
        if retired:
            assert not fault, ("unexpected retirement", hex(instruction), trace)
            assert ctx.get(core.retire_instr) == instruction, trace
            assert ctx.get(core.retire_nia) == nia, trace
        await ctx.tick()
        ctx.set(core.imem_valid, 0)
        if retired:
            assert ctx.get(core.nia) == (nia + 4 if next_nia is None else next_nia), trace
            await ctx.tick()
            return
    raise AssertionError(("bounded completion expired", hex(instruction), trace))


async def ordinary(ctx, core):
    await boot_core(ctx, core)
    # Real retirements, not a forced internal counter.
    for _ in range(3):
        await execute(ctx, core, 0xaf004000)  # IADD DR0,DR0,#0
    # Synthetic X descriptor. The core's separate fetch fence is not updated by
    # this test ingress; set_dr explicitly repositions setup inside that fence.
    await set_cr(ctx, core, 14, 0x42000002, 4, 65535)
    # Nonzero preservation sentinels. CR0/CR8 deliberately remain NULL for
    # NULL/EXACT probes; CR13 must remain architecturally reserved NULL.
    for reg in (1, 2, 3, 4, 5, 7, 9, 10, 11):
        await set_cr(ctx, core, reg, 0x82000000 | reg,
                     0x5000 + reg * 256, 63 + reg)
    for reg in range(1, 16):
        await set_dr(ctx, core, reg, 0xa5000000 | reg)


async def set_dr(ctx, core, reg, value):
    assert reg != 0
    # Each setup sequence is a fresh fixture placement, not executable program
    # control flow. Keep it within the reset-established fence without resetting
    # the core or re-entering the privileged three-retirement window.
    ctx.set(core.free_run_nia, 12)
    ctx.set(core.free_run_start, 1)
    await ctx.tick()
    ctx.set(core.free_run_start, 0)
    assert ctx.get(core.nia) == 12
    await execute(ctx, core, word(21, reg, 0, 0x4000))
    for shift in (24, 16, 8, 0):
        await execute(ctx, core, word(24, reg, reg, 8))
        await execute(ctx, core, word(21, reg, reg, 0x4000 | (value >> shift & 255)))
    assert ctx.get(core.debug_dr_words[reg]) == value


def run_core(bench):
    core = ChurchCore()
    sim = Simulator(core)
    sim.add_clock(1e-6)

    async def wrapped(ctx):
        await ordinary(ctx, core)
        await bench(ctx, core)

    sim.add_testbench(wrapped)
    sim.run()


async def set_cr(ctx, core, reg, gt, base, limit):
    """Use the documented simulation ingress, never force an internal signal."""
    ctx.set(core.dbg_cr_wr_addr, reg)
    ctx.set(core.dbg_cr_wr_data.as_value(), gt | base << 32 | limit << 64)
    ctx.set(core.dbg_cr_wr_en, 1)
    await ctx.tick()
    ctx.set(core.dbg_cr_wr_en, 0)
    assert tuple(ctx.get(w) for w in core.debug_cr_words[reg]) == (gt, base, limit)


def arithmetic(left, right, subtract):
    raw = left - right if subtract else left + right
    result = raw & MASK
    overflow = ((left ^ right) if subtract else ~(left ^ right)) & (left ^ result)
    return result, (result >> 31, int(result == 0),
                    int(left >= right) if subtract else int(raw > MASK),
                    int(bool(overflow & 0x80000000)))


def predicate(n, z, c, v):
    return (z, not z, c, not c, n, not n, v, not v, c and not z,
            not c or z, n == v, n != v, not z and n == v,
            z or n != v, True)


def seal(location, authority):
    # ISA formula, deliberately not hardware.integrity32 or shared contracts.
    authority &= 0x3fffffff
    return (((location << 7) | (location >> 25)) ^
            ((authority << 13) | (authority >> 19)) ^ 0xdeadbeef) & MASK
