"""Exact-image reset isolation. Memory reload is modelled, not UART-tested."""
import hashlib
import json
from pathlib import Path
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from amaranth.sim import Simulator
from hardware.core import ChurchCore
from hardware.boot_rom import BOOT_PROGRAM
IMAGE = ROOT / "docs/phase-1/reload-evidence/new-layout-amoeba-runtime/candidate-le.bin"
SHA = "2a16403e94639abac7716ea9cf56a35f5bbc6bf5e3a99e805457bcd1f563a451"


def probe():
    raw = IMAGE.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == SHA
    original = list(struct.unpack("<16384I", raw))
    words = original[:]
    rom = list(BOOT_PROGRAM)
    rom[1] = 0x27000001  # The guarded profile's approved reset marker.
    core = ChurchCore(expected_boot_guard=23971)
    sim = Simulator(core)
    sim.add_clock(1e-6)
    result = {"imageSha256": SHA, "physicalIO": False,
              "transportTested": False, "model": "ChurchCore with simulated memory bus",
              "passes": []}

    async def bench(ctx):
        ctx.set(core.defer_fault_reset, 1)
        ctx.set(core.boot_start, 1)
        for run in range(2):
            current = {"boundaries": [], "retired": []}
            result["passes"].append(current)
            seen = set()
            for cycle in range(20000):
                regs = [[ctx.get(w) for w in row] for row in core.debug_cr_words]
                if not any(value for row in regs for value in row):
                    assert ctx.get(core.dbg_m_bit_state) == 0
                    current["allRegistersAndMCleared"] = True
                pc = ctx.get(core.imem_addr)
                ctx.set(core.imem_fetch_address, pc)
                ctx.set(core.imem_from_reset_rom, pc < 16)
                ctx.set(core.imem_data, rom[pc//4] if pc < 16 else words[pc//4])
                ctx.set(core.imem_valid, 1)
                if pc in (4, 8, 0x3504, 0x3508, 0x350c) and pc not in seen:
                    seen.add(pc)
                    current["boundaries"].append({
                        "nia": pc, "registers": regs,
                        "m": ctx.get(core.dbg_m_bit_state),
                        "flags": ctx.get(core.flags.as_value()),
                        "shadow": ctx.get(core.retire_trace_load_shadow_gt)})
                if ctx.get(core.fault_valid):
                    current["fault"] = {"nia": pc, "code": ctx.get(core.fault)}
                    break
                if ctx.get(core.retire_valid):
                    current["retired"].append({
                        "nia": ctx.get(core.retire_nia),
                        "instruction": ctx.get(core.retire_instr),
                        "shadow": ctx.get(core.retire_trace_load_shadow_gt),
                        "registers": regs, "m": ctx.get(core.dbg_m_bit_state)})
                enabled, addr = ctx.get(core.dmem_rd_en), ctx.get(core.dmem_addr)
                data = words[addr//4] if enabled else 0
                if ctx.get(core.dmem_wr_en):
                    words[addr//4] = ctx.get(core.dmem_wr_data)
                assert not ctx.get(core.ns_wr_en)
                assert not ctx.get(core.clist_wr_en)
                await ctx.tick()
                ctx.set(core.boot_start, 0)
                ctx.set(core.dmem_rd_valid, enabled)
                ctx.set(core.dmem_rd_data, data)
            else:
                raise AssertionError("bounded core replay deadline")
            if run == 0:
                # Observe the fault edge, then replace only external memory.
                ctx.set(core.imem_valid, 0)
                await ctx.tick()
                words[:] = original
                ctx.set(core.dmem_rd_valid, 0)
                ctx.set(core.reboot_req, 1)
                await ctx.tick()
                ctx.set(core.reboot_req, 0)
                await ctx.tick()  # FAULT_RST clears the real live bank.

    sim.add_testbench(bench)
    sim.run()
    cold, warm = result["passes"]
    assert cold["fault"] == warm["fault"] == {"nia": 0x2e08, "code": 8}
    assert cold["allRegistersAndMCleared"] and warm["allRegistersAndMCleared"]
    assert len(cold["boundaries"]) == len(warm["boundaries"]) == 5
    for a, b in zip(cold["boundaries"], warm["boundaries"]):
        for key in ("nia", "registers", "m", "flags"):
            assert a[key] == b[key], (key, a, b)
    a = next(r for r in cold["retired"] if r["nia"] == 0x3504)
    b = next(r for r in warm["retired"] if r["nia"] == 0x3504)
    assert a["instruction"] == b["instruction"] == 2
    assert a["shadow"] == 0 and b["shadow"] == 0x4a000011
    assert a["registers"] == b["registers"] and a["m"] == b["m"]
    assert hashlib.sha256(IMAGE.read_bytes()).hexdigest() == SHA
    return result


if __name__ == "__main__":
    print(json.dumps(probe(), indent=2))
