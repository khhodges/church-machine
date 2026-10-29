"""Exact-image fault recovery through real simulated UART; no board access."""
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
from hardware.wukong_bridge import decode_snapshot_frame


def replay(directory, budget=4000000):
    raw = (directory / "admitted.bin").read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    assert digest == json.loads((directory / "admission.json").read_text())["imageHash"]
    assert len(raw) == 65536
    _install_amaranth_elaboration_caches()
    top = ChurchWukongXC7A100T(clk_freq=80, baud=10, sim_mode=True,
        sim_dmem_init=False, expected_boot_guard=0,
        sim_boot_image_words=struct.unpack("<16384I", raw))
    sim = Simulator(top)
    sim.add_clock(1e-6)
    received = []
    result = dict(imageSha256=digest, physicalBoardTested=False,
                  outcome="deadline", faults=[], recoveryRetirements=[],
                  bootTransitions=[], snapshot=None)
    bit = 8

    async def capture(ctx):
        while True:
            if ctx.get(top.uart_tx_pin) == 0:
                await ctx.tick().repeat(bit + bit // 2)
                value = 0
                for b in range(8):
                    value |= ctx.get(top.uart_tx_pin) << b
                    await ctx.tick().repeat(bit)
                received.append(value)
                await ctx.tick().repeat(bit // 2)
            else:
                await ctx.tick()

    async def bench(ctx):
        core = top.sim_core
        ctx.set(top.uart_rx_pin, 1)
        phase, scan, retirements = "running", 0, 0

        async def send(value):
            for level in [0, *[(value >> i) & 1 for i in range(8)], 1]:
                ctx.set(top.uart_rx_pin, level)
                await ctx.tick().repeat(bit)

        def fault(cycle, code):
            return dict(cycle=cycle, code=code,
                instruction=ctx.get(core.fault_instr),
                fetchAddress=ctx.get(core.imem_addr),
                threadGT=ctx.get(core.debug_cr_words[12][0]),
                artifactGT=ctx.get(core.debug_cr_words[14][0]),
                retirements=retirements)

        for cycle in range(budget):
            if cycle % 100000 == 0:
                progress = dict(cycle=cycle, phase=phase, retirements=retirements,
                                imageSha256=digest, complete=False)
                (directory / "rtl-recovery-progress.json").write_text(
                    json.dumps(progress, indent=2))
                print(json.dumps(progress), flush=True)
            if ctx.get(core.retire_valid):
                retirements += 1
                if phase == "recovering":
                    result["recoveryRetirements"].append([
                        ctx.get(core.retire_nia), ctx.get(core.retire_instr),
                        ctx.get(core.debug_cr_words[12][0]),
                        ctx.get(core.debug_cr_words[14][0])])
            if phase == "running" and ctx.get(core.fault_valid):
                fault_code = ctx.get(core.fault)
                await ctx.tick()
                first = fault(cycle, fault_code)
                result["faults"].append(first)
                assert first["code"] == 8 and first["instruction"] == 0x070B0020
                assert first["threadGT"] & 65535 == 12
                assert first["artifactGT"] & 65535 == 17
                phase = "snapshot"
            if phase == "snapshot":
                while scan + 292 <= len(received):
                    if received[scan:scan+4] == [0xAC, 1, 1, 28]:
                        frame = received[scan:scan+292]
                        snap = decode_snapshot_frame(frame)
                        if snap["reason"] == 2:
                            assert snap["cr"][12][0] == first["threadGT"]
                            assert snap["cr"][14][0] == first["artifactGT"]
                            result["snapshot"] = snap
                            (directory / "recovery-snapshot.bin").write_bytes(bytes(frame))
                            break
                    scan += 1
                if result["snapshot"]:
                    # Let UART DONE drain; then show Run cannot bypass hold.
                    await ctx.tick().repeat(32)
                    assert ctx.get(core.halt_req), "Fault must hold fetch until authorization"
                    await send(0x72)
                    for _ in range(2000):
                        assert not ctx.get(core.retire_valid)
                        await ctx.tick()
                    result["runCouldNotBypassFault"] = True
                    # Simulated bridge acknowledgement after CRC-checked evidence.
                    result["authorizedAfterSnapshot"] = True
                    await send(0x67)
                    phase = "waiting-reset"
            if phase in ("waiting-reset", "recovering"):
                if phase == "waiting-reset" and result.get("resetObserved"):
                    phase = "recovering"
                elif phase == "recovering" and ctx.get(core.fault_valid):
                    fault_code = ctx.get(core.fault)
                    await ctx.tick()
                    result["faults"].append(fault(cycle, fault_code))
                    result["outcome"] = "second-fault"
                    break
            await ctx.tick()
        result["retirements"] = retirements
        result["finalPhase"] = phase
        result["uartBytes"] = len(received)
        return

    async def observe_boot(ctx):
        # Continuous observation also covers UART send()'s awaits. A fault is
        # a pulse, not a held flag, and its deassertion is not proof of reset.
        previous = None
        cycle = 0
        while True:
            if result.get("authorizedAfterSnapshot"):
                boot = ctx.get(top.sim_core.boot_state)
                if boot != previous:
                    result["bootTransitions"].append([cycle, boot])
                    previous = boot
                if boot == 1:  # BootState.FAULT_RST
                    result["resetObserved"] = True
                if result.get("resetObserved") and ctx.get(top.sim_core.boot_complete):
                    result["bootCompletedAfterAuthorization"] = True
            cycle += 1
            await ctx.tick()

    sim.add_testbench(bench)
    sim.add_testbench(capture, background=True)
    sim.add_testbench(observe_boot, background=True)
    try:
        sim.run()
    except Exception as exc:
        result.update(outcome="probe-error", error=str(exc))
        (directory / "rtl-recovery-partial.json").write_text(json.dumps(result, indent=2))
        raise
    return result


if __name__ == "__main__":
    directory = Path(sys.argv[1])
    result = replay(directory)
    (directory / "rtl-recovery.json").write_text(json.dumps(result, indent=2))
    print(json.dumps({k:v for k,v in result.items()
                      if k not in ("snapshot", "recoveryRetirements")}, indent=2))
