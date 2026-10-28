"""Read-only, exact admitted Factory Build replay in the full Wukong model.

No image translation, register injection, upload or physical hardware access.
Stops at the first fault; this is diagnostic evidence, not release acceptance.
"""
import hashlib
import json
from pathlib import Path
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from amaranth.sim import Simulator
from hardware.wukong_top import ChurchWukongXC7A100T
from hardware.test_wukong_upload_fsm import _install_amaranth_elaboration_caches


def replay(directory, cycles=120000):
    raw = (directory / "admitted.bin").read_bytes()
    admission = json.loads((directory / "admission.json").read_text())
    digest = hashlib.sha256(raw).hexdigest()
    if digest != admission["imageHash"] or len(raw) != 65536:
        raise ValueError("Exact admitted image/hash required")
    _install_amaranth_elaboration_caches()
    top = ChurchWukongXC7A100T(
        clk_freq=80, baud=10, sim_mode=True, sim_dmem_init=False,
        # Frozen saved New layout selects sequence zero for Boot.NS/Boot.Thread.
        # This is a model build constant, never adopted from incoming RAM.
        expected_boot_guard=0, sim_boot_image_words=struct.unpack("<16384I", raw))
    sim = Simulator(top)
    sim.add_clock(1e-6)
    result = dict(imageSha256=digest, outcome="deadline", cycleBudget=cycles,
                  physicalBoardTested=False, retirements=0, recentRetirements=[])

    async def bench(ctx):
        core = top.sim_core
        for cycle in range(cycles):
            if ctx.get(core.fault_valid):
                result.update(outcome="fault", cycle=cycle,
                              faultCode=ctx.get(core.fault),
                              mBits=ctx.get(core.dbg_m_bit_state),
                              fetchAddress=ctx.get(core.imem_addr))
                await ctx.tick()
                result.update(faultInstruction=ctx.get(core.fault_instr),
                              faultStage=ctx.get(core.fault_stage),
                              registers={str(i): [ctx.get(w) for w in core.debug_cr_words[i]]
                                         for i in (6, 12, 14, 15)})
                return
            if ctx.get(core.retire_valid):
                result["retirements"] += 1
                result["recentRetirements"].append(
                    [ctx.get(core.retire_nia), ctx.get(core.retire_instr),
                     ctx.get(core.dbg_m_bit_state)])
                result["recentRetirements"] = result["recentRetirements"][-24:]
            await ctx.tick()
    sim.add_testbench(bench)
    sim.run()
    return result


if __name__ == "__main__":
    print(json.dumps(replay(Path(sys.argv[1]) if len(sys.argv) > 1 else
                           ROOT / "generated-artifacts/factory-build"), indent=2))
