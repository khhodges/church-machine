"""Production decoder observations and bounded full-core MCMP execution."""
from amaranth.sim import Simulator
from hardware.core import ChurchCore
from hardware.decoder import ChurchDecoder
from hardware.sim_boot_helpers import boot_core


def run(vectors):
    output = {"vectors": [], "conditions": []}
    for profile in (False, True):
        decoder = ChurchDecoder(iot_profile=profile)

        async def decode(ctx):
            ctx.set(decoder.instr_valid, 1)
            for v in vectors:
                if v["kind"] != "index":
                    continue
                ctx.set(decoder.instruction, v["word"])
                output["vectors"].append(dict(
                    id=v["id"], profile="IoT" if profile else "Full",
                    stage="decoder-only", index=ctx.get(decoder.cap_index),
                    arithmetic_fault=False))
            for c in range(16):
                for f in range(16):
                    ctx.set(decoder.instruction, (20 << 27) | (c << 23))
                    ctx.set(decoder.flags.as_value(), f)
                    output["conditions"].append(
                        ["IoT" if profile else "Full", c, f, ctx.get(decoder.exec_enable)])

        sim = Simulator(decoder)
        sim.add_testbench(decode)
        sim.run()
        core = ChurchCore(iot_profile=profile)

        def snapshot(ctx):
            return dict(pc=ctx.get(core.nia) // 4,
                        dr=[ctx.get(r) for r in core.debug_dr_words],
                        cr=[[ctx.get(w) for w in cr] for cr in core.debug_cr_words],
                        flags=[ctx.get(core.flags[k]) for k in ("N", "Z", "C", "V")])

        async def execute(ctx, word):
            ctx.set(core.imem_data, word)
            ctx.set(core.imem_valid, 1)
            before = snapshot(ctx)
            events = dict(reads=[], writes=[], retired=False, fault=None)
            for cycle in range(32):
                if ctx.get(core.dmem_rd_en):
                    events["reads"].append(ctx.get(core.dmem_addr) // 4)
                if ctx.get(core.dmem_wr_en):
                    events["writes"].append(dict(address=ctx.get(core.dmem_addr) // 4,
                                                  value=ctx.get(core.dmem_wr_data)))
                fault = ctx.get(core.fault_valid) or ctx.get(core.retire_fault_valid)
                retired = bool(ctx.get(core.retire_valid))
                if fault:
                    events["fault"] = ctx.get(core.fault)
                if retired:
                    events["retired"] = True
                    events["retire_word"] = ctx.get(core.retire_instr)
                    if ctx.get(core.retire_nia) // 4 != before["pc"]:
                        raise RuntimeError("Retirement NIA does not match issued instruction")
                await ctx.tick()
                ctx.set(core.imem_valid, 0)
                if fault or retired:
                    events.update(before=before, after=snapshot(ctx),
                                  z=ctx.get(core.flags["Z"]), cycles=cycle+1)
                    await ctx.tick()
                    return events
            raise RuntimeError("MCMP/setup failed to retire or fault within 32 cycles")

        async def bench(ctx):
            await boot_core(ctx, core)
            for v in vectors:
                if v["kind"] != "mcmp":
                    continue
                # Construct DR values via actual IADD, checking setup independently.
                for reg, value in [(1, v["right"]), (2, v["left"])]:
                    setup = await execute(ctx, (21 << 27) | (14 << 23) |
                                          (reg << 19) | 0x4000 | value)
                    if setup["fault"] or setup["after"]["dr"][reg] != value:
                        raise RuntimeError("IADD fixture setup failed")
                observed = await execute(ctx, v["word"])
                observed.update(id=v["id"], profile="IoT" if profile else "Full",
                                stage="core-issue-to-retire")
                output["vectors"].append(observed)

        sim = Simulator(core)
        sim.add_clock(1e-6)
        sim.add_testbench(bench)
        sim.run()
    return output