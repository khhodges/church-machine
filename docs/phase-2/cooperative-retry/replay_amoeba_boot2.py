"""Bounded exact-image RTL probes. Faults are evidence, never repaired in replay."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys

RTL_MANIFEST_SHA = "b478e4bb67ddfb55f6098f18f5f0f44204b2115e5b31494a1bed15f8bdedc8cc"


def verify_snapshot(snapshot):
    if hashlib.sha256((snapshot / "starter-source-manifest.json").read_bytes()).hexdigest() != RTL_MANIFEST_SHA:
        raise ValueError("RTL manifest differs from pinned qualification snapshot")
    source_manifest = json.loads((snapshot / "starter-source-manifest.json").read_text())
    for name, expected in source_manifest["files"].items():
        path = (snapshot / name).resolve()
        if not path.is_relative_to(snapshot) or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError(f"Retained RTL input changed: {name}")


def replay(directory, snapshot, mode):
    verify_snapshot(snapshot)
    sys.path.insert(0, str(snapshot))
    from amaranth import Elaboratable, Module, Signal
    from amaranth.sim import Simulator
    import hardware.starter_top as starter
    from hardware.starter_transport import command as image_command
    from hardware.amoeba_protocol import command, BEGIN, FINISH, validate_records

    evidence = json.loads((directory / "preparation.json").read_text())
    raw = (directory / f"{mode}.bin").read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if digest != evidence["imageHashes"][mode] or len(raw) != 65536:
        raise ValueError("Prepared image changed")
    records = validate_records(evidence["records"], staging_base=evidence["stagingBase"],
                               staging_words=evidence["stagingWords"])
    receivers = []
    class Bytes(Elaboratable):
        def __init__(self, **kwargs):
            self.rx, self.valid, self.data, self.error = Signal(init=1), Signal(), Signal(8), Signal()
            receivers.append(self)
        def elaborate(self, platform):
            return Module()
    starter.UartRx = Bytes
    top = starter.StarterTop(sim_mode=True, general_image=True, boot_guard=0,
        amoeba_records=records, staging_base=evidence["stagingBase"],
        staging_words=evidence["stagingWords"], clock_hz=20000, baud=5000)
    sim = Simulator(top)
    sim.add_clock(1e-6)
    result = dict(mode=mode, imageSha256=digest,
        rtlManifestSha256=hashlib.sha256((snapshot / "starter-source-manifest.json").read_bytes()).hexdigest(),
        requests=[], publications=[],
        trace=[], handoffs=[], hardwareOperations=False,
        scope="decoded UART, real RAM/SHA and retained RTL; no instruction translation")
    class Fault(Exception):
        pass
    async def bench(ctx):
        rx, core, ctl, receiver = receivers[0], top.core, top.control, top.lump_receiver
        cycle = 0
        copied = {r["slot"]: {} for r in records}
        async def tick(observe=True):
            nonlocal cycle
            if observe:
                if ctx.get(core.retire_valid):
                    result["trace"].append(dict(cycle=cycle, nia=ctx.get(core.retire_nia),
                                               dr1=ctx.get(core.debug_dr_words[1])))
                    result["trace"] = result["trace"][-128:]
                if ctx.get(core.llr_complete):
                    result["handoffs"].append(dict(cycle=cycle, slot=ctx.get(core.debug_dr_words[5])))
                if ctx.get(top.program_commit):
                    addr, value = ctx.get(top.memory_address)*4, ctx.get(top.memory_data)
                    for r in records:
                        if r["baseByte"] <= addr < r["baseByte"]+4*r["sizeWords"]:
                            writes = copied[r["slot"]]
                            writes[addr] = value
                            if addr == r["baseByte"]:
                                exact = (len(writes) == r["sizeWords"] and
                                    [writes.get(addr+i*4) for i in range(r["sizeWords"])] == r["words"])
                                result["publications"].append(dict(slot=r["slot"], cycle=cycle,
                                    exactBytes=exact, headerLast=len(writes) == r["sizeWords"]))
                                assert exact, "Native publication differs from selected localized body"
                if ctx.get(core.fault_valid):
                    result.update(outcome="first-runtime-fault", cycle=cycle,
                        fault=ctx.get(core.fault), nia=ctx.get(core.nia),
                        faultInstruction=ctx.get(core.fault_instr),
                        faultGT=ctx.get(core.fault_gt), faultStage=ctx.get(core.fault_stage),
                        receiverState=ctx.get(receiver.state),
                        receiverTransaction=ctx.get(receiver.transaction),
                        bootComplete=ctx.get(core.boot_complete))
                    raise Fault()
            await ctx.tick()
            cycle += 1
        async def send(data, observe=True, spacing=0):
            for b in data:
                ctx.set(rx.valid, 1)
                ctx.set(rx.data, b)
                await tick(observe)
                ctx.set(rx.valid, 0)
                for _ in range(spacing):
                    await tick(observe)
            ctx.set(rx.valid, 0)
            await tick(observe)
        ctx.set(top.maintenance_enable, 1)
        await ctx.tick().repeat(4)
        await send(image_command(1, 0, 0, 65536, general_image=True), False)
        await send(bytes.fromhex(digest)+raw, False)
        await send(image_command(2, 0, 1, general_image=True), False)
        await ctx.tick().repeat(100000)
        assert ctx.get(ctl.state) == ctl.READY
        assert ctx.get(top.admitted_digest) == int(digest, 16)
        result["admission"] = "READY"
        try:
            await send(image_command(3, 0, 1, general_image=True), False)
            ctx.set(top.maintenance_enable, 0)
            for _ in range(60000):
                await tick()
                if ctx.get(receiver.state) == receiver.WAITING:
                    slot, txn = ctx.get(receiver.selector), ctx.get(receiver.transaction)
                    r = next(r for r in records if r["slot"] == slot)
                    result["requests"].append(dict(slot=slot, transaction=txn, cycle=cycle))
                    if len(result["requests"]) > len(records):
                        result["outcome"] = "repeated-request-bound"
                        break
                    for _ in range(1000):
                        await tick()
                    payload = struct.pack(f"<{r['sizeWords']}I", *r["words"])
                    await send(command(BEGIN, slot, 1, txn, len(payload)), spacing=39)
                    await send(payload, spacing=39)
                    await send(command(FINISH, slot, 1, txn), spacing=39)
            else:
                result["outcome"] = "bounded-observation"
        except Fault:
            pass
        result["targetWriteCounts"] = {str(s): len(w) for s, w in copied.items()}
    sim.add_testbench(bench)
    sim.run()
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", required=True, type=Path)
    parser.add_argument("--rtl", required=True, type=Path)
    parser.add_argument("--mode", choices=["system", "alice", "mallory"], required=True)
    args = parser.parse_args()
    directory = args.candidate.resolve()
    output = directory / f"{args.mode}-replay.json"
    if output.exists():
        raise ValueError("Refusing to overwrite retained evidence")
    result = replay(directory, args.rtl.resolve(), args.mode)
    output.write_text(json.dumps(result, indent=2)+"\n")
    print(json.dumps({k: v for k, v in result.items() if k != "trace"}))
