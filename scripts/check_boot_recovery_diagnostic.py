"""Read-only verification and isolated validator replay of recovery evidence."""
import hashlib
import json
from pathlib import Path
import struct
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from amaranth.sim import Simulator
from hardware.boot_thread_validation import BootThreadValidation


def validate(words):
    dut = BootThreadValidation(expected_guard=0)
    sim = Simulator(dut)
    sim.add_clock(1e-6)
    result = {}

    async def bench(ctx):
        ctx.set(dut.namespace_slots, 64)
        ctx.set(dut.start, 1)
        await ctx.tick()
        ctx.set(dut.start, 0)
        reads = []
        for cycle in range(200):
            addr = ctx.get(dut.mem_addr)
            if ctx.get(dut.mem_en):
                ctx.set(dut.mem_data, words[addr // 4])
                ctx.set(dut.mem_valid, 1)
                reads.append([addr, words[addr // 4]])
            else:
                ctx.set(dut.mem_valid, 0)
            if ctx.get(dut.done) or ctx.get(dut.fault):
                result.update(done=bool(ctx.get(dut.done)),
                              fault=ctx.get(dut.fault_type), reads=reads,
                              indicator=ctx.get(dut.indicator))
                return
            await ctx.tick()
        raise AssertionError("validator did not finish")

    sim.add_testbench(bench)
    sim.run()
    return result


def main(directory):
    raw = (directory / "admitted.bin").read_bytes()
    evidence = json.loads((directory / "rtl-recovery-diagnostic.json").read_text())
    assert hashlib.sha256(raw).hexdigest() == evidence["imageSha256"]
    assert evidence["outcome"] == "second-fault"
    assert [f["code"] for f in evidence["faults"]] == [8, 18]
    words = list(struct.unpack("<16384I", raw))
    original = validate(words)
    assert original["done"] and original["fault"] == 0
    writes = [e for e in evidence["memoryEvents"] if e["write"]]
    reset_cycle = next(cycle for cycle, state in evidence["bootTransitions"] if state == 1)
    for event in writes:
        # Initial guarded CALL also creates the pristine root frame.
        assert event["boot"] in (6, 7) and event["cycle"] < reset_cycle
        words[event["address"] // 4] = event["data"]
    retained = validate(words)
    assert not retained["done"] and retained["fault"] == 18
    # A synchronous BRAM exposes the previous address's data on the first
    # request cycle. The validator's armed handshake consumes the settled
    # response, not that first bus sample. Keep the final sample per address.
    reads = []
    for event in evidence["memoryEvents"]:
        if not event["write"]:
            if reads and reads[-1]["address"] == event["address"]:
                reads[-1] = event
            else:
                reads.append(event)
    assert reads
    for event in reads:
        assert words[event["address"] // 4] == event["data"], event
        assert not event["threadValidated"] and not event["threadActivated"]
    base = words[8]
    indicator_address = (base + 17) * 4
    assert reads[-1]["address"] == indicator_address
    assert reads[-1]["data"] == retained["indicator"]
    header = words[base]
    caps = (1 << (((header >> 23) & 15) + 6)) - 12
    stack_start = caps - ((header >> 10) & 8191)
    indicator = retained["indicator"]
    sp = indicator & 4095
    frame = words[base + sp + 2]
    # These are CHANGE's structural suspension-frame checks only. Passing
    # them is not a claim that all capability/entry restoration checks pass.
    assert indicator & 4096 and (indicator >> 13) & 32767 == 0
    assert stack_start <= sp and sp + 2 <= caps - 1
    assert frame & 4095 == sp + 2
    result = dict(imageSha256=evidence["imageSha256"],
                  originalValidator=original, retainedValidator=retained,
                  suspensionGeometry=dict(stackStart=stack_start, stackEnd=caps - 1,
                                          sp=sp, frame=frame,
                                          entryGT=words[base + sp + 1],
                                          fullRestorationValidated=False),
                  indicatorWrites=[e for e in writes if e["address"] == indicator_address],
                  recoveryReads=reads,
                  conclusion="Retained Boot.Thread indicator fails fresh-root admission")
    (directory / "boot-recovery-cause.json").write_text(json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main(Path(sys.argv[1]))
