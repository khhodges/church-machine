"""Isolated component probe; retained Thread reconstruction is NOT image acceptance."""
import json
from pathlib import Path
import struct
import sys
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from amaranth.sim import Simulator
from hardware.core import ChurchCore
from hardware.wukong_top import _WUKONG_ROM
from hardware.test_wukong_upload_fsm import _install_amaranth_elaboration_caches


def replay_words(words):
    words = list(words)
    _install_amaranth_elaboration_caches()
    core = ChurchCore(expected_boot_guard=0)
    sim = Simulator(core)
    sim.add_clock(1e-6)
    result = {}

    async def bench(ctx):
        ctx.set(core.defer_fault_reset, 1)
        ctx.set(core.boot_start, 1)
        previous = None
        states = []
        for cycle in range(5000):
            boot = ctx.get(core.boot_state)
            if boot != previous:
                states.append([cycle, boot])
                previous = boot
            if ctx.get(core.fault_valid) or ctx.get(core.boot_complete):
                result.update(cycle=cycle, boot=boot, fault=ctx.get(core.fault),
                              complete=bool(ctx.get(core.boot_complete)), states=states,
                              nia=ctx.get(core.imem_addr),
                              cr=[[ctx.get(w) for w in cr] for cr in core.debug_cr_words])
                return
            fetch = ctx.get(core.imem_addr)
            addr = ctx.get(core.dmem_addr)
            rd = ctx.get(core.dmem_rd_en)
            if ctx.get(core.dmem_wr_en):
                words[addr // 4] = ctx.get(core.dmem_wr_data)
            ns_addr = ctx.get(core.ns_addr)
            cl_addr = ctx.get(core.clist_addr)
            await ctx.tick()
            ctx.set(core.boot_start, 0)
            ctx.set(core.dmem_rd_valid, rd)
            ctx.set(core.dmem_rd_data, words[addr // 4] if rd else 0)
            ctx.set(core.ns_rd_data, words[ns_addr // 4])
            ctx.set(core.clist_rd_data.as_value(), words[cl_addr // 4])
            ctx.set(core.imem_valid, 1)
            ctx.set(core.imem_fetch_address, fetch)
            ctx.set(core.imem_from_reset_rom, fetch < 16)
            ctx.set(core.imem_data, (0x27000001 if fetch == 4 else _WUKONG_ROM[fetch // 4])
                    if fetch < 16 else words[fetch // 4])
        raise AssertionError("core probe timed out")
    sim.add_testbench(bench)
    sim.run()
    return result


def run(directory):
    words = list(struct.unpack("<16384I", (directory / "admitted.bin").read_bytes()))
    for e in json.loads((directory / "rtl-recovery-diagnostic.json").read_text())["memoryEvents"]:
        if e["write"]:
            words[e["address"] // 4] = e["data"]
    result = replay_words(words)
    print(json.dumps(result, indent=2))
    assert result["complete"] and not result["fault"], result


if __name__ == "__main__":
    run(Path(sys.argv[1]))
