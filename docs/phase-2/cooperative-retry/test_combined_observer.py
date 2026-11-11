"""Small observer tests; full acceptance separately decodes real UART pins."""
import json
import pytest
from amaranth import ResetInserter, Signal
from amaranth.sim import Simulator
from hardware.combined_observer import CombinedObserver, REPORT_SIZE, decode_report, input_identity
from test_starter_top import ROOT


def test_snapshot_backpressure_and_identity():
    old, old_caller, new, new_caller = json.loads(
        (ROOT / "combined-inputs.json").read_text())["records"]
    records, callers = [old, new], [old_caller, new_caller]
    observer = CombinedObserver(records, callers, clock_hz=100)
    identity = input_identity(records, callers)
    digest = "ab" * 32
    reset = Signal()
    sim = Simulator(ResetInserter(reset)(observer))
    sim.add_clock(1e-6)

    async def bench(ctx):
        ctx.set(observer.epoch, 7)
        ctx.set(observer.image_digest, int(digest, 16))
        ctx.set(observer.ticks, 99)
        await ctx.tick()
        # First packet has already frozen. Execution proceeds while TX waits.
        for pc, result in [(old_caller["baseByte"] + 16, 17),
                           (new_caller["baseByte"] + 16, 29),
                           (old_caller["baseByte"] + 16, 17)]:
            ctx.set(observer.retire, 1)
            ctx.set(observer.nia, pc)
            ctx.set(observer.result, result)
            ctx.set(observer.renew, 1)
            await ctx.tick()
        ctx.set(observer.retire, 0)
        ctx.set(observer.renew, 0)
        ctx.set(observer.ticks, 88)
        for i, row in enumerate(records):
            ctx.set(observer.write, 1)
            ctx.set(observer.address, row["baseByte"] if i == 0 else row["slot"] * 16 + 8)
            ctx.set(observer.data, row["words"][0] if i == 0 else row["descriptor"][2])
            await ctx.tick()
        ctx.set(observer.write, 0)
        ctx.set(observer.fault, 1)
        await ctx.tick()
        ctx.set(observer.fault, 0)

        async def receive():
            packet = bytearray()
            while len(packet) < REPORT_SIZE:
                if ctx.get(observer.tx_req):
                    byte = ctx.get(observer.tx_byte)
                    last = ctx.get(observer.tx_last)
                    ctx.set(observer.tx_ack, 0)
                    await ctx.tick().repeat(3)
                    assert ctx.get(observer.tx_byte) == byte
                    assert ctx.get(observer.tx_last) == last
                    packet.append(byte)
                    assert last == (len(packet) == REPORT_SIZE)
                    ctx.set(observer.tx_ack, 1)
                    await ctx.tick()
                    ctx.set(observer.tx_ack, 0)
                else:
                    await ctx.tick()
            return bytes(packet)

        first = await receive()
        baseline = decode_report(first, image_digest=digest, inputs_digest=identity)
        assert baseline["epoch"] == 7 and baseline["ticks"] == 99
        assert baseline["result_count"] == baseline["publications"] == 0
        second = await receive()
        result = decode_report(second, image_digest=digest, inputs_digest=identity)
        assert result["sequence"] == 2 and result["ticks"] == 88
        assert result["fault_seen"] == 1
        assert result["result_count"] == result["publications"] == result["renewals"] == 3
        assert [result[f"result{i}"] for i in range(3)] == [17, 29, 17]
        for bad in (second[:-1], bytes([second[0] ^ 1]) + second[1:],
                    second[:80] + bytes([second[80] ^ 1]) + second[81:]):
            with pytest.raises(ValueError):
                decode_report(bad, image_digest=digest, inputs_digest=identity)
        with pytest.raises(ValueError, match="identity"):
            decode_report(second, image_digest="00" * 32, inputs_digest=identity)
        with pytest.raises(ValueError, match="identity"):
            decode_report(second, image_digest=digest, inputs_digest=bytes(32))
        # BEGIN can interrupt an in-flight packet. The next epoch must not
        # inherit sequence, results, publication, progress or sticky fault.
        while not ctx.get(observer.tx_req):
            await ctx.tick()
        ctx.set(observer.tx_ack, 1)
        await ctx.tick().repeat(9)
        ctx.set(observer.tx_ack, 0)
        ctx.set(reset, 1)
        await ctx.tick()
        ctx.set(reset, 0)
        ctx.set(observer.epoch, 8)
        clean = decode_report(await receive(), image_digest=digest, inputs_digest=identity)
        assert clean["epoch"] == 8 and clean["sequence"] == 1
        assert all(clean[key] == 0 for key in (
            "publications", "result_count", "result0", "result1", "result2",
            "pc0", "pc1", "pc2", "progress", "renewals", "fault_seen"))
    sim.add_testbench(bench)
    sim.run()
