"""Offline hardware-model probe; raw fixture bytes grant no admission authority."""
import hashlib
import json
from pathlib import Path
import struct
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from amaranth.sim import Simulator
from hardware import test_boot_rom_no_false_halt as t
from hardware import boot_rom as b


def probe(directory, method=1):
    directory = Path(directory)
    review = json.loads((directory / "review.json").read_text())
    raw = (directory / review["filename"]).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == review["binary_hash"]
    words = list(struct.unpack(f">{len(raw)//4}I", raw))
    alloc = len(words)
    assert alloc == 1 << (((words[0] >> 23) & 15) + 6)
    base = b.WUKONG_SELFTEST_BASE_WORD
    thread = base + alloc
    caller = ((thread + 257 + 127) // 128) * 128
    cap = caller + 128
    end = cap + b.WUKONG_CAPABILITY_TEST_ALLOC
    assert end <= 16384
    memory = list(t._DMEM_INIT[:384]) + [0] * (16384 - 384)
    memory[base:base + alloc] = words
    memory[thread:thread + 256] = t._DMEM_INIT[
        b.WUKONG_THREAD_BASE_WORD:b.WUKONG_THREAD_BASE_WORD + 256]
    def descriptor(slot, address, size):
        row = slot * 4
        memory[row:row + 4] = [address * 4, size - 1,
                              t.integrity32(address * 4, size - 1), 0]
    descriptor(1, thread, 256)
    descriptor(6, base, alloc)
    descriptor(7, caller, 128)
    caller_gt = t.make_gt(t.GT_TYPE_INFORM, t.PERM_MASK_E, 7)
    memory[thread + b.WUKONG_THREAD_CAPS0_WORD - b.WUKONG_THREAD_BASE_WORD] = caller_gt
    memory[caller] = t._lump_header(n_minus_6=1, cw=3, cc=1)
    memory[caller + 1] = t.encode_church(t.ChurchOpcode.LOAD, t.CondCode.AL, cr_dst=0, cr_src=6)
    memory[caller + 2] = t.encode_church(t.ChurchOpcode.CALL, t.CondCode.AL, cr_src=0, imm=method)
    memory[caller + 3] = t.encode_turing(t.TuringOpcode.BRANCH, t.CondCode.AL, imm=0)
    cc = words[0] & 255
    assert cc > 0, "candidate lacks SELF"
    memory[caller + 127] = words[-cc]
    dut = t.BootRomHarness(memory)
    rows = []
    report = dict(binary_hash=review["binary_hash"], admission_tested=False, method=method,
                  layout_words=dict(selftest=base, thread=thread, callhome=caller,
                                    capability_test=cap, end=end, capacity=16384))
    async def bench(ctx):
        report["boot_ok"] = await t._wait_boot_complete(ctx, dut)
        for cycle in range(30000):
            if ctx.get(dut.core.retire_valid):
                row = dict(nia=ctx.get(dut.core.retire_nia),
                           word=ctx.get(dut.core.retire_instr),
                           fault=bool(ctx.get(dut.core.retire_fault_valid)),
                           fault_code=ctx.get(dut.core.retire_fault_code))
                rows.append(row)
                if row["fault"] or row["nia"] == (caller + 3) * 4:
                    break
            await ctx.tick()
        report.update(cycles=cycle, retired_count=len(rows), first=rows[:8], last=rows[-10:],
                      returned=bool(rows and rows[-1]["nia"] == (caller + 3) * 4),
                      faults=[r for r in rows if r["fault"]])
        failure_addresses = {
            (base + i) * 4 for i in range(1, ((words[0] >> 10) & 8191))
            if words[i] & 0xFFFFFF80 == 0xAF084000
            and words[i] & 127 and words[i + 1] == 0x1F000000}
        report["failure_status_writes"] = [r for r in rows if r["nia"] in failure_addresses]
    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    probe(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 1)