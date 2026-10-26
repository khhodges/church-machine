"""Bounded full-top replay of the exact retained trial; no physical I/O."""
import json
from pathlib import Path
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from amaranth.sim import Simulator
from hardware.wukong_top import ChurchWukongXC7A100T
from hardware.test_wukong_upload_fsm import _install_amaranth_elaboration_caches
from scripts.prepare_actor_manager_runtime_trial import build, BASE


def replay(*, through_return=False, complete_program=False, image_builder=build,
           retained_dir="new-layout-change-runtime"):
    expected, evidence = image_builder()
    retained = BASE / retained_dir
    if (retained / "candidate-le.bin").read_bytes() != expected:
        raise ValueError("Retained image differs from deterministic reconstruction")
    if json.loads((retained / "evidence.json").read_text()) != evidence:
        raise ValueError("Retained provenance changed")
    _install_amaranth_elaboration_caches()
    top = ChurchWukongXC7A100T(
        clk_freq=80, baud=10, sim_mode=True, sim_dmem_init=False,
        expected_boot_guard=23971, sim_boot_image_words=struct.unpack("<16384I", expected))
    sim = Simulator(top)
    sim.add_clock(1e-6)
    result = dict(imageSha256=evidence["sha256"], model="full ChurchWukongXC7A100T",
                  physicalBoardTested=False, transportVerified=False,
                  installedBytesVerified=False, cycleBudget=120000 if complete_program else (80000 if through_return else 20000),
                  goal="complete-program" if complete_program else ("caller-resumption" if through_return else "first-incoming-instruction"),
                  retired=[], memorySignals=[], outcome="deadline",
                  firstChangeRetired=False, incomingThreadExecuted=False,
                  returnRetired=False, callerResumed=False)

    async def bench(ctx):
        core = top.sim_core
        for cycle in range(result["cycleBudget"]):
            if ctx.get(core.dmem_rd_en) or ctx.get(core.dmem_wr_en):
                result["memorySignals"].append(dict(
                    cycle=cycle, address=ctx.get(core.dmem_addr),
                    readEnable=ctx.get(core.dmem_rd_en),
                    readValid=ctx.get(core.dmem_rd_valid),
                    readData=ctx.get(core.dmem_rd_data),
                    writeEnable=ctx.get(core.dmem_wr_en),
                    writeData=ctx.get(core.dmem_wr_data)))
                result["memorySignals"] = result["memorySignals"][-32:]
            if ctx.get(core.fault_valid):
                result.update(outcome="fault", cycle=cycle,
                              faultCode=ctx.get(core.fault), fetchAddress=ctx.get(core.imem_addr),
                              sources={name: ctx.get(signal) for name, signal
                                       in core.model_fault_sources.items() if ctx.get(signal)})
                await ctx.tick()
                result.update(faultStage=ctx.get(core.fault_stage),
                              faultInstruction=ctx.get(core.fault_instr),
                              registers={str(i): [ctx.get(w) for w in core.debug_cr_words[i]]
                                         for i in (2, 6, 12, 13, 14, 15)})
                return
            if complete_program and ctx.get(top.step_halted) and result["retired"]:
                result.update(outcome="halted", cycle=cycle,
                              registers={str(i): [ctx.get(w) for w in core.debug_cr_words[i]]
                                         for i in (2, 6, 12, 14, 15)},
                              dataRegisters=[ctx.get(w) for w in core.debug_dr_words])
                return
            if ctx.get(core.retire_valid):
                nia, word = ctx.get(core.retire_nia), ctx.get(core.retire_instr)
                result["retired"].append(dict(cycle=cycle, address=nia, instruction=word))
                if word >> 27 == 3:
                    result["returnRetired"] = True
                if (through_return or complete_program) and nia == 0x3910:
                    assert result["returnRetired"] and result["incomingThreadExecuted"]
                    assert word == 0x07130010
                    result.update(outcome="caller-resumed", callerResumed=True, cycle=cycle)
                    if not complete_program:
                        return
                    result["outcome"] = "deadline"
                if nia == 0x350c:
                    assert word == 0x27010000
                    result["firstChangeRetired"] = True
                elif result["firstChangeRetired"] and not result["incomingThreadExecuted"]:
                    assert ctx.get(core.debug_cr_words[12][0]) == 0x0200000b
                    # The frozen Thread.2 continuation selects AmoebaStartup's
                    # first authored body word, not ActorManager's next LOAD.
                    assert (nia, word) == (0x3908, 0xaf084000)
                    result.update(outcome="incoming-thread-retired", incomingThreadExecuted=True,
                                  cycle=cycle)
                    if not through_return and not complete_program:
                        return
                    result["outcome"] = "deadline"
            await ctx.tick()

    sim.add_testbench(bench)
    sim.run()
    return result


if __name__ == "__main__":
    extended = "--through-return" in sys.argv[2:]
    result = replay(through_return=extended)
    with Path(sys.argv[1]).open("x") as output:
        json.dump(result, output, indent=2)
        output.write("\n")
    print(json.dumps({k: v for k, v in result.items() if k not in ("memorySignals", "registers")}))
    sys.exit(0 if (result["callerResumed"] if extended else result["incomingThreadExecuted"]) else 1)
