"""Replay the local candidate at the decoded-byte interface, not UART pins."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[3]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate", type=Path, required=True)
    args = parser.parse_args()
    directory = args.candidate.resolve()
    report = directory / "replay.json"
    if report.exists():
        raise ValueError("Refusing to overwrite replay evidence")
    receipt = json.loads((directory / "preparation.json").read_text())
    raw = (directory / "boot2.bin").read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if len(raw) != 65536 or digest != receipt["imageSha256"]:
        raise ValueError("Candidate bytes differ from preparation receipt")
    snapshot = ROOT / "generated-artifacts/boot2-explicit-boot-guard"
    sys.path.insert(0, str(snapshot))
    from amaranth import Elaboratable, Module, Signal
    from amaranth.sim import Simulator
    import hardware.starter_top as starter
    from hardware.starter_transport import command
    receivers = []

    class DecodedBytes(Elaboratable):
        def __init__(self, **kwargs):
            self.rx, self.valid, self.data, self.error = Signal(init=1), Signal(), Signal(8), Signal()
            receivers.append(self)

        def elaborate(self, platform):
            return Module()

    starter.UartRx = DecodedBytes
    top = starter.StarterTop(sim_mode=True, general_image=True, boot_guard=0,
                             clock_hz=20000, baud=5000)
    sim = Simulator(top)
    sim.add_clock(1e-6)
    result = dict(scope="decoded-byte transport, actual RAM SHA and retained core",
        imageSha256=digest, bootGuard=0, hardwareOperations=False,
        trace=[], writes=[], lazyHeaderReads=[])
    lazy_addresses = {r["locationWords"] * 4 for r in receipt["records"]}

    async def bench(ctx):
        rx, ctl, core = receivers[0], top.control, top.core
        async def send(data):
            ctx.set(rx.valid, 1)
            for b in data:
                ctx.set(rx.data, b)
                await ctx.tick()
            ctx.set(rx.valid, 0)
        ctx.set(top.maintenance_enable, 1)
        await ctx.tick().repeat(4)
        await send(command(1, 0, 0, 65536, general_image=True))
        await send(bytes.fromhex(digest) + raw)
        await send(command(2, 0, 1, general_image=True))
        await ctx.tick().repeat(100000)
        assert ctx.get(ctl.state) == ctl.READY
        assert ctx.get(top.admitted_digest) == int(digest, 16)
        assert ctx.get(ctl.execution_reset)
        result["admission"] = "READY"
        await send(command(3, 0, 1, general_image=True))
        for cycle in range(20000):
            if ctx.get(core.retire_valid) and len(result["trace"]) < 64:
                result["trace"].append(dict(cycle=cycle, nia=ctx.get(core.retire_nia),
                                           fault=ctx.get(core.retire_fault_valid)))
            if ctx.get(core.dmem_rd_en) and ctx.get(core.dmem_addr) in lazy_addresses:
                result["lazyHeaderReads"].append(dict(cycle=cycle, address=ctx.get(core.dmem_addr),
                    valid=ctx.get(core.dmem_rd_valid), data=ctx.get(core.dmem_rd_data)))
            if ctx.get(top.memory_write) and len(result["writes"]) < 256:
                result["writes"].append(dict(cycle=cycle, address=ctx.get(top.memory_address)*4,
                                             data=ctx.get(top.memory_data)))
            if ctx.get(core.fault_valid):
                result.update(outcome="first-runtime-fault", cycle=cycle,
                    fault=ctx.get(core.fault), nia=ctx.get(core.nia),
                    bootComplete=ctx.get(core.boot_complete),
                    namespaceAdmitted=ctx.get(core.boot_namespace_admitted),
                    threadValidated=ctx.get(core.boot_thread_validated),
                    threadActivated=ctx.get(core.boot_thread_activated))
                break
            await ctx.tick()
        else:
            result["outcome"] = "bounded-observation-no-fault"

    sim.add_testbench(bench)
    sim.run()
    report.write_text(json.dumps(result, indent=2)+"\n")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
