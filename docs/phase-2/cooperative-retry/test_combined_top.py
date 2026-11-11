"""One UART-pin session, one combined elaboration, three distinct evidence records."""
import hashlib
import json
import struct
from hardware.combined_observer import MAGIC, REPORT_SIZE, decode_report, input_identity
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
    identity = input_identity([old, new], [old_caller, new_caller])
    top = StarterTop(clock_hz=HZ, baud=BAUD, sim_mode=True, lump_records=[old, new],
                     caller_records=[old_caller, new_caller])
    h = Harness(top=top)
    core, rx = top.core, top.lump_receiver
    evidence = []

    def reports(image, epoch):
        # Resynchronize after BEGIN cuts a report; never accept a truncated or
        # bad-CRC packet, nor a valid packet for another exact image/epoch.
        data = bytes(h.output)
        found = []
        for offset in range(len(data) - REPORT_SIZE + 1):
            if data[offset:offset + 4] != MAGIC:
                continue
            try:
                item = decode_report(data[offset:offset + REPORT_SIZE],
                                     image_digest=manifest["applications"][image],
                                     inputs_digest=identity)
            except ValueError:
                continue
            if item["epoch"] == epoch:
                found.append(item)
        assert found, "no complete UART report for admitted image epoch"
        assert all(a["sequence"] < b["sequence"] for a, b in zip(found, found[1:]))
        return found

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
        baseline = reports("user-b", epoch)[-1]
        assert baseline["progress"] > 1 and baseline["renewals"] > 2
        assert baseline["publications"] == baseline["result_count"] == baseline["fault_seen"] == 0
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
        assert reports("user-b", epoch)[-1]["result_count"] == 0 and not ctx.get(h.fault)
        assert ctx.get(h.progress) > before
        # Wrong bytes never become ready. SYSTEM and USER B keep executing.
        await deliver(0, 2, True)
        assert ctx.get(rx.state) == rx.FAILED
        assert reports("user-b", epoch)[-1]["result_count"] == 0 and not ctx.get(h.fault)
        await deliver(0, 3)
        await ctx.tick().repeat(HZ * 2)
        assert ctx.get(rx.state) == rx.CONSUMED
        lazy = reports("user-b", epoch)[-1]
        assert lazy["result_count"] == 0, "old method must remain suspended until new publication"
        assert lazy["publications"] == lazy["phase"] == 1
        assert lazy["transaction"] == 3 and lazy["receiver_state"] == rx.CONSUMED
        assert lazy["progress"] > baseline["progress"] and not lazy["fault_seen"]
        assert ctx.get(h.progress) > before
        assert not ctx.get(h.fault)
        evidence.append({"proof": "lazy-delivery", "digest": old["localizedSha256LE"],
                         "epoch": epoch, "wrongContentRejected": True,
                         "userBProgress": lazy["progress"],
                         "scope": "CALL entered old method; RETURN deliberately pending for adoption"})
        evidence[-1]["uartReport"] = lazy
        progress_before_repeat = ctx.get(h.progress)
        await deliver(0, 4)
        assert ctx.get(rx.state) == rx.FAILED
        assert reports("user-b", epoch)[-1]["result_count"] == 0 and not ctx.get(h.fault)
        assert ctx.get(h.progress) > progress_before_repeat
        await deliver(1, 5)
        await ctx.tick().repeat(HZ * 2)
        assert not ctx.get(h.fault), (ctx.get(core.fault), hex(ctx.get(core.imem_addr)))
        assert ctx.get(rx.state) == rx.CONSUMED
        adopted = reports("user-b", epoch)[-1]
        assert adopted["result_count"] == 3
        assert [adopted[f"result{i}"] for i in range(3)] == [17, 29, 17]
        assert [adopted[f"pc{i}"] for i in range(3)] == [
            old_caller["baseByte"] + 16, new_caller["baseByte"] + 16,
            old_caller["baseByte"] + 16]
        assert adopted["publications"] == 3 and adopted["phase"] == 2
        assert adopted["transaction"] == 5 and not adopted["fault_seen"]
        evidence.append({"proof": "revision-adoption", "sizesWords": [64, 256],
                         "results": [17, 29, 17], "epoch": epoch,
                         "newDigest": new["localizedSha256LE"]})
        evidence[-1]["uartReport"] = adopted
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
        replacement = reports("all-waiting", epoch)[-1]
        assert replacement["renewals"] > 1 and replacement["ticks"] > 0
        assert all(replacement[key] == 0 for key in (
            "progress", "publications", "result_count", "phase", "transaction", "fault_seen",
            "result0", "result1", "result2", "pc0", "pc1", "pc2"))
        # Old-epoch delivery cannot cross the image reset boundary.
        await h.send(ctx, command(BEGIN, 1, epoch - 1, 3, 1024))
        assert ctx.get(rx.state) == rx.EMPTY
        evidence.append({"proof": "image-replacement", "epoch": epoch,
                         "imageSha256": manifest["applications"]["all-waiting"],
                         "userBProgressUnchanged": True, "staleDeliveryRejected": True})
        evidence[-1]["uartReport"] = replacement
        assert ctx.get(top.boots) == 2
        for item in evidence:
            item["sourceConfigurationSha256"] = manifest["sourceConfigurationSha256"]
            item["observerInputsSha256"] = identity.hex()
        (ROOT / "combined-evidence.json").write_text(json.dumps(evidence, indent=2) + "\n")
        record_property("combined_evidence", json.dumps(evidence))
    h.run(bench)
