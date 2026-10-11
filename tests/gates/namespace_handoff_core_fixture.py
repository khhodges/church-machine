"""Independent byte-addressed synthetic image; no catalog or runtime writers.

Initial register deposit models an already-admitted coordinator, NOT its grant
issuance. After that boundary only instruction execution and reboot may mutate
the machine. All instruction fetches come from the selected CR14 byte address.
"""
from amaranth.sim import Simulator

from hardware.core import ChurchCore
from hardware.integrity32 import integrity32
from hardware.sim_boot_helpers import boot_core
from hardware.test_shift_ops import _exec, encode_iadd


BOOT, SYSTEM = 0x2000, 0x3000
BRIDGE, TARGET = 0x4000, 0x5000
BRIDGE_CODE, TARGET_CODE, RECOVERY = 0x6000, 0x7000, 0x8000
THREAD_GT, ENTRY_GT = 0x0200000B, 0x4A00000C


def instruction(op, dst, src, imm=0):
    return op << 27 | 14 << 23 | dst << 19 | src << 15 | imm


def image(operand=1):
    memory = {}

    def descriptor(root, slot, base, limit):
        address = root + slot * 16
        memory.update({address: base, address + 4: limit,
                       address + 8: integrity32(base, limit), address + 12: 0})

    # Only these four objects are shared, never the entire table: bridge Thread,
    # bridge executable/C-List, destination root, recovery Thread.
    for root in (BOOT, SYSTEM):
        for slot, base, limit in ((1, BRIDGE, 255), (2, BRIDGE_CODE, 63),
                                  (3, SYSTEM, 63), (4, RECOVERY, 255)):
            descriptor(root, slot, base, limit)
    descriptor(SYSTEM, 11, TARGET, 255)
    descriptor(SYSTEM, 12, TARGET_CODE, 63)
    # Deliberately incompatible old-root binding, not a mirror.
    descriptor(BOOT, 12, 0x9000, 63)
    for base, entry in ((BRIDGE, 0x4A000002), (TARGET, ENTRY_GT),
                        (RECOVERY, 0x4A000002)):
        memory[base] = 0xF900820C  # 256 words, 32 stack words, 12 cap homes
        memory[base + 17 * 4] = 0x10EF  # prepared suspension STO=239, SZ=1
        memory[base + 240 * 4] = entry
        code_base = TARGET_CODE if base == TARGET else BRIDGE_CODE
        memory[base + 241 * 4] = (((code_base + 4) // 4) << 13) | 0x10F1
        memory[base + 242 * 4] = entry
        memory[base + 243 * 4] = (0x7FFF << 13) | 0x10F3  # poison root
        memory[base + 244 * 4] = entry
        for i in range(16):
            memory[base + (i + 1) * 4] = 0
    memory[BRIDGE + 17 * 4] = 0x10F1  # running bridge, retained poison root
    memory[BRIDGE_CODE] = 0xF8001001  # 64 words, four code words, one C-List row
    memory[TARGET_CODE] = 0xF8001001
    memory[BRIDGE_CODE + 63 * 4] = 0x1A000003  # Namespace L
    memory[TARGET_CODE + 63 * 4] = ENTRY_GT
    memory[BRIDGE_CODE + 4] = instruction(5, 15, 6)  # SWITCH CR15, CR6, #0
    memory[BRIDGE_CODE + 8] = instruction(4, operand, operand)  # CHANGE CRn
    memory[TARGET_CODE + 4] = encode_iadd(1, 0, 37)
    cr = [[0, 0, 0] for _ in range(16)]
    cr[0] = [0x4A000002, BRIDGE_CODE, 63]
    cr[1] = [THREAD_GT, TARGET, 255]
    cr[5] = [0x32000000, BRIDGE + 72, 193]
    cr[6] = [0x1A000002, BRIDGE_CODE + 252, 0]
    cr[12] = [0x02000001, BRIDGE, 255]
    cr[13] = [0x02000004, RECOVERY, 255]
    cr[14] = [0x52000002, BRIDGE_CODE + 4, 3]
    cr[15] = [0x1A000000, BOOT, 63]
    if operand != 1:
        cr[operand] = [THREAD_GT, TARGET, 255]
    return memory, cr


def run_probe(*, operand=1, action="change", m_authorized=True,
              owned_bridge=False, mutate=None):
    """Return complete architectural checkpoints and accepted bus writes."""
    core = ChurchCore()
    memory, initial_cr = image(operand)
    memory[0] = memory[BRIDGE_CODE + 4]
    memory[4] = memory[BRIDGE_CODE + 8]
    if owned_bridge:
        # Enter a genuinely prepared bridge with an ordinary instruction.
        # CR13 is a pre-admitted target token, not a resolved source-table home.
        # No ownership/debug deposit occurs after this initial boundary.
        initial_cr[12] = [0x02000001, BRIDGE, 255]
        initial_cr[13] = [THREAD_GT, 0, 0]
        initial_cr[14] = [0x52000002, 0xA000, 3]
        memory[0] = instruction(4, 12, 12)
        memory[BRIDGE + 17 * 4] = 0x10EF
        memory[BRIDGE + 241 * 4] |= 2 << 28
        memory[BRIDGE_CODE] = 0xF8001002
        memory[BRIDGE_CODE + 62 * 4] = 0x4A000002
        memory[BRIDGE_CODE + 63 * 4] = 0x1A000003
        memory[BRIDGE_CODE + 4] = instruction(5, 15, 6, 1)
        memory[BRIDGE_CODE + 8] = instruction(4, 13, 13)
        if action == "self":
            memory[BRIDGE_CODE + 4] = instruction(4, 12, 12)
            memory[BRIDGE_CODE + 8] = encode_iadd(1, 0, 37)
    if mutate:
        mutate(memory, initial_cr)
    original = dict(memory)
    result = {"checkpoints": {}, "writes": [], "reads": [], "retirements": []}

    async def bench(ctx):
        pending = None

        def snapshot():
            return dict(cr=[[ctx.get(w) for w in row] for row in core.debug_cr_words],
                        dr=[ctx.get(w) for w in core.debug_dr_words],
                        flags=ctx.get(core.flags.as_value()), nia=ctx.get(core.nia),
                        m=ctx.get(core.dbg_m_bit_state),
                        owned=ctx.get(core.active_thread_owned),
                        active_base=ctx.get(core.active_thread_base))

        async def tick_bus():
            nonlocal pending
            ctx.set(core.dmem_rd_valid, pending is not None)
            ctx.set(core.dmem_rd_data, memory.get(pending, 0))
            await ctx.delay(1e-9)
            read = ctx.get(core.dmem_addr) if ctx.get(core.dmem_rd_en) else None
            write = ((ctx.get(core.dmem_addr), ctx.get(core.dmem_wr_data))
                     if ctx.get(core.dmem_wr_en) else None)
            assert not ctx.get(core.ns_wr_en), "unexpected Namespace write"
            assert not ctx.get(core.clist_wr_en), "unexpected C-List write"
            if read is not None:
                result["reads"].append(read)
            if write is not None:
                result["writes"].append(write)
            await ctx.tick()
            if write is not None:
                memory[write[0]] = write[1]
            pending = read

        async def execute():
            address = ctx.get(core.imem_addr)
            word = memory.get(address, 0)
            assert word, f"no fixture instruction at {address:#x}"
            ctx.set(core.imem_data, word)
            ctx.set(core.imem_valid, 1)
            for _ in range(2000):
                fault = ctx.get(core.fault_valid) or ctx.get(core.retire_fault_valid)
                retired = ctx.get(core.retire_valid)
                if retired:
                    result["retirements"].append(
                        (ctx.get(core.retire_nia), ctx.get(core.retire_instr), bool(fault)))
                code = ctx.get(core.fault)
                await tick_bus()
                ctx.set(core.imem_valid, 0)
                if fault or retired:
                    return code if fault else 0
            raise AssertionError("instruction failed to terminate")

        await boot_core(ctx, core)
        for _ in range(3):
            await _exec(ctx, core, encode_iadd(0, 0, 0))
        # A single pre-issue deposit, never a post-SWITCH repair. No private FSM
        # or scheduler state injection. Active ownership remains explicitly false.
        for i, words in enumerate(initial_cr):
            ctx.set(core.dbg_cr_wr_en, 1)
            ctx.set(core.dbg_cr_wr_addr, i)
            ctx.set(core.dbg_cr_wr_data.as_value(),
                    words[0] | words[1] << 32 | words[2] << 64)
            await ctx.tick()
        ctx.set(core.dbg_cr_wr_en, 0)
        ctx.set(core.dbg_m_bit_wr_en, 1)
        ctx.set(core.dbg_m_bit_word, 0x8000 if m_authorized else 0)
        await ctx.tick()
        ctx.set(core.dbg_m_bit_wr_en, 0)
        ctx.set(core.free_run_nia, 0)
        ctx.set(core.free_run_start, 1)
        await ctx.tick()
        ctx.set(core.free_run_start, 0)
        ctx.set(core.defer_fault_reset, 1)
        if owned_bridge:
            result["activation_fault"] = await execute()
            result["checkpoints"]["owned_bridge"] = snapshot()
            result["activation_writes"] = list(result["writes"])
            if result["activation_fault"]:
                result["memory_unchanged"] = memory == original
                return
        result["checkpoints"]["before_switch"] = snapshot()
        if action != "reset_before":
            result["switch_fault"] = await execute()
            result["checkpoints"]["after_switch"] = snapshot()
        if action.startswith("reset"):
            ctx.set(core.reboot_req, 1)
            await tick_bus()
            ctx.set(core.reboot_req, 0)
            for _ in range(32):
                await tick_bus()
                if ctx.get(core.boot_complete):
                    break
            else:
                raise AssertionError("reboot did not complete")
            result["checkpoints"]["after_reset"] = snapshot()
        elif action == "self" and not result["switch_fault"]:
            result["target_fault"] = await execute()
            result["checkpoints"]["after_target"] = snapshot()
        elif not result["switch_fault"]:
            result["change_fault"] = await execute()
            result["checkpoints"]["after_change"] = snapshot()
            # Held faults must not serialize context or silently resume.
            for _ in range(8):
                await tick_bus()
            result["checkpoints"]["held_fault"] = snapshot()
            if not result["change_fault"]:
                # This fetch is selected only by the hardware-restored CR14/NIA.
                result["target_fault"] = await execute()
                result["checkpoints"]["after_target"] = snapshot()
        result["memory_unchanged"] = memory == original
        result["memory"] = memory

    sim = Simulator(core)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()
    return result
