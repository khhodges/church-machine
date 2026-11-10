"""One UART-pin session, one combined elaboration, three distinct evidence records."""
import hashlib
import json
import struct
from amaranth import Array, Signal
from hardware.starter_top import StarterTop
from hardware.starter_transport import command as image_command
from hardware.combined_protocol import command, BEGIN, FINISH
from test_starter_top import Harness, ROOT, HZ, BAUD


def test_one_configuration_three_flows(record_property):
    inputs = json.loads((ROOT / "combined-inputs.json").read_text())
    manifest_path = ROOT / "combined-source-manifest.json"
    manifest = json.loads(manifest_path.read_text())
    for name, expected in manifest["files"].items():
        assert hashlib.sha256((ROOT / name).read_bytes()).hexdigest() == expected, name
    old, old_caller, new, new_caller = inputs["records"]
    top = StarterTop(clock_hz=HZ, baud=BAUD, sim_mode=True, lump_records=[old, new])
    h = Harness(top=top)
    count = Signal(3)
    results = Array(Signal(32) for _ in range(3))
    core, rx = top.core, top.lump_receiver
    with h.module.If(core.retire_valid & ~core.fault_valid &
                     ((core.retire_nia == old_caller["baseByte"] + 16) |
                      (core.retire_nia == new_caller["baseByte"] + 16)) & (count < 3)):
        h.module.d.sync += [results[count].eq(core.debug_dr_words[1]), count.eq(count + 1)]
    evidence = []

    async def bench(ctx, h):
        ctl = top.control
        epoch = await h.load(ctx, 1)
        assert ctx.get(ctl.state) == ctl.READY
        await h.send(ctx, image_command(3, 1, epoch))
        await h.enable(ctx, False)
        await ctx.tick().repeat(HZ * 2)
        assert ctx.get(h.progress) > 1
        assert ctx.get(h.renewals) > 2
        assert not ctx.get(h.fault)
        before = ctx.get(h.progress)

        async def deliver(selector, txn, corrupt=False):
            r = (old, new)[selector]
            raw = bytearray(struct.pack("<" + "I" * len(r["words"]), *r["words"]))
            if corrupt:
                raw[8] ^= 1
            await h.send(ctx, command(BEGIN, selector, epoch, txn, len(raw)))
            assert ctx.get(rx.state) == rx.RECEIVING
            await h.send(ctx, raw)
            assert ctx.get(rx.state) == rx.SEALED
            await h.send(ctx, command(FINISH, selector, epoch, txn))
            await ctx.tick().repeat(2200)

        # Exact approved but out-of-phase bytes must never become READY.
        await deliver(1, 1)
        assert ctx.get(rx.state) == rx.FAILED
        assert ctx.get(count) == 0 and not ctx.get(h.fault)
        assert ctx.get(h.progress) > before
        # Wrong bytes never become ready. SYSTEM and USER B keep executing.
        await deliver(0, 2, True)
        assert ctx.get(rx.state) == rx.FAILED
        assert ctx.get(count) == 0 and not ctx.get(h.fault)
        await deliver(0, 3)
        await ctx.tick().repeat(12000)
        assert ctx.get(rx.state) == rx.CONSUMED
        assert ctx.get(count) == 0, "old method must remain suspended until new publication"
        assert ctx.get(h.progress) > before
        assert not ctx.get(h.fault)
        evidence.append({"proof": "lazy-delivery", "digest": old["localizedSha256LE"],
                         "epoch": epoch, "wrongContentRejected": True,
                         "userBProgress": ctx.get(h.progress),
                         "scope": "CALL entered old method; RETURN deliberately pending for adoption"})
        progress_before_repeat = ctx.get(h.progress)
        await deliver(0, 4)
        assert ctx.get(rx.state) == rx.FAILED
        assert ctx.get(count) == 0 and not ctx.get(h.fault)
        assert ctx.get(h.progress) > progress_before_repeat
        await deliver(1, 5)
        await ctx.tick().repeat(20000)
        assert not ctx.get(h.fault), (ctx.get(core.fault), hex(ctx.get(core.imem_addr)))
        assert ctx.get(rx.state) == rx.CONSUMED
        assert ctx.get(count) == 3
        assert [ctx.get(r) for r in results] == [17, 29, 17]
        evidence.append({"proof": "revision-adoption", "sizesWords": [64, 256],
                         "results": [17, 29, 17], "epoch": epoch,
                         "newDigest": new["localizedSha256LE"]})
        evidence[-1]["newFirstRejected"] = True
        evidence[-1]["repeatedOldRejected"] = True
        renewals = ctx.get(h.renewals)
        await ctx.tick().repeat(HZ * 2)
        assert ctx.get(h.renewals) > renewals + 1 and not ctx.get(h.fault)

        before = ctx.get(h.progress)
        epoch = await h.load(ctx, 0)
        assert ctx.get(ctl.state) == ctl.READY
        await h.send(ctx, image_command(3, 0, epoch))
        await h.enable(ctx, False)
        renewals = ctx.get(h.renewals)
        await ctx.tick().repeat(HZ * 2)
        assert ctx.get(h.progress) == before
        assert ctx.get(h.renewals) > renewals + 1
        assert not ctx.get(h.fault) and not ctx.get(h.violation)
        assert ctx.get(rx.state) == rx.EMPTY
        # Old-epoch delivery cannot cross the image reset boundary.
        await h.send(ctx, command(BEGIN, 1, epoch - 1, 3, 1024))
        assert ctx.get(rx.state) == rx.EMPTY
        evidence.append({"proof": "image-replacement", "epoch": epoch,
                         "imageSha256": manifest["applications"]["all-waiting"],
                         "userBProgressUnchanged": True, "staleDeliveryRejected": True})
        assert ctx.get(top.boots) == 2
        for item in evidence:
            item["sourceConfigurationSha256"] = manifest["sourceConfigurationSha256"]
        (ROOT / "combined-evidence.json").write_text(json.dumps(evidence, indent=2) + "\n")
        record_property("combined_evidence", json.dumps(evidence))
    h.run(bench)
