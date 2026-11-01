"""Save explicitly approved actor/Thread inputs, never install an image.

Run with --approve only after review of the pinned actors and initial values.
The generated candidate and as-built inspection are retained separately.
"""
import argparse
import copy
import hashlib
import http.cookiejar
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from server.boot_image import generate_simulation_image, parse_ns_table_raw, _require_approved_executable_lump
from server.built_thread_view import inspect_threads
from server.thread_initial_design import validate_design, validate_bindings

ACTORS = (
    ("alice", "ide.Alice", "ide.Alice.1.4f5f9b06.lump",
     "31bbddb5d20fe8ccd32d60b7c0d554b2af45ba80a85a9de56e3f6af8351ed93f", 16, 11),
    ("mallory", "ide.Mallory", "ide.Mallory.1.3a5e7373.lump",
     "11341685017d1852f514d1af6fda990edf87c89cbd082be8df83ccfb8a677fb5", 17, 12),
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--approve", action="store_true")
    args = parser.parse_args()
    base = "https://" + os.environ["REPLIT_DEV_DOMAIN"]
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(route, payload=None, confirmation=None):
        headers = {"Content-Type": "application/json"}
        if confirmation:
            headers["X-Change-Confirmation"] = confirmation
        req = urllib.request.Request(base + route, headers=headers,
                                     data=None if payload is None else json.dumps(payload).encode())
        try:
            with opener.open(req, timeout=120) as response:
                body = json.load(response)
        except urllib.error.HTTPError as exc:
            body = json.load(exc)
            if exc.code == 428 and args.approve and not confirmation:
                return request(route, payload, body["change_confirmation"]["id"])
            raise RuntimeError(f"{route}: {exc.code}: {body.get('error', body)}") from None
        if body.get("ok") is False:
            raise RuntimeError(f"{route}: {body.get('error')}")
        return body

    state = request("/api/boot-image/ns-state")
    cfg = request("/api/boot-config")["config"]
    rows = copy.deepcopy(state["savedAbstractions"])
    lumps = ROOT / "server/lumps"
    # Refuse to validate against a different filesystem than the serving IDE.
    assert rows == json.loads((lumps / "ns-state.json").read_text())["abstractions"]
    manifest = json.loads((lumps / "manifest.json").read_text())
    image_path = lumps / "boot-image.bin"
    committed = image_path.read_bytes() if image_path.exists() else None
    with tempfile.TemporaryDirectory() as temporary:
        stage = Path(temporary) / "lumps"
        shutil.copytree(lumps, stage)
        baseline = generate_simulation_image(cfg, str(stage))
        words = struct.unpack(f"<{len(baseline) // 4}I", baseline)
        end = max(int(r["location"], 0) + (1 << (((words[int(r["location"], 0)] >> 23) & 15) + 6))
                  for r in rows if r.get("resident") and int(r["location"], 0) < len(words))
        for key, name, filename, digest, slot, thread in ACTORS:
            raw = (stage / filename).read_bytes()
            assert hashlib.sha256(raw).hexdigest() == digest, f"{name} bytes changed"
            actor_words = _require_approved_executable_lump(str(stage / filename), str(stage), name)
            assert actor_words[1] == (3 if key == "alice" else 2)
            assert actor_words[3 if key == "alice" else 2] == (0x070B0010 if key == "alice" else 0x070B0020)
            matches = [r for r in rows if r["slot"] == slot or r["name"] == name]
            if matches:
                assert len(matches) == 1 and matches[0]["slot"] == slot
                assert matches[0]["name"] == name and matches[0]["filename"] == filename
                assert matches[0]["binary_hash"] == digest
                continue
            assert str(slot) not in state.get("freeSlotSequences", {}), "Reused slot needs fresh review"
            record = next(r for r in manifest if r.get("filename") == filename)
            rows.append(dict(slot=slot, name=name, seq=0, type="Inform", filename=filename,
                             binary_hash=digest, token=record["token"], lump_version=record["lump_version"],
                             load_policy="Resident", resident=True, f=0, g=0,
                             location=hex(end), limit=hex(len(actor_words) - 1)))
            end += len(actor_words)
        by_slot = {r["slot"]: r for r in rows}
        designs = []
        for key, name, filename, digest, slot, thread in ACTORS:
            init = json.loads(subprocess.check_output([
                "node", "-e", "const d=require('./simulator/thread-register-design');"
                "console.log(JSON.stringify(d.initialization(d.applyPreset("
                "d.blankDraft(),JSON.parse(process.argv[1]),process.argv[2]).draft)))",
                json.dumps(rows), key], cwd=ROOT, text=True))
            design = validate_design(dict(
                sizeWords=cfg["step1"]["threadLumpWords"], stackWords=cfg["step1"]["threadStackWords"],
                target=dict(slot=thread, name=by_slot[thread]["name"], sequence=by_slot[thread]["seq"],
                            namespaceName=by_slot[0]["name"], namespaceSequence=by_slot[0]["seq"]),
                initialization=init, tuples=[dict(name="TurnState", offset=0, policy="initialize",
                    fields=[dict(name="turns", type="uint32", size=1, initial=0)])]))
            validate_bindings(design, rows)
            designs.append(design)
        candidate_cfg = copy.deepcopy(cfg)
        candidate_cfg["threadInitialDesigns"] = [
            d for d in cfg.get("threadInitialDesigns", []) if d["target"]["slot"] not in (11, 12)
        ] + designs
        (stage / "ns-state.json").write_text(json.dumps(dict(abstractions=rows)))
        candidate = generate_simulation_image(candidate_cfg, str(stage))

        def inspect(binary):
            from server.thread_tuple_evidence import capture
            raw = parse_ns_table_raw(binary)
            for row in raw["entries"]:
                row["name"] = by_slot.get(row["slot"], {}).get("name")
            tuple_evidence = capture(binary, raw, designs, [11, 12], rows) if binary == candidate else None
            return inspect_threads(binary, raw["entries"], raw["nsTableBase"], tuple_evidence)

        before, after = inspect(baseline), inspect(candidate)
        boot_before = next(t for t in before if t["slot"] == 1)
        boot_after = next(t for t in after if t["slot"] == 1)
        assert boot_before == boot_after, "Boot.Thread inspection changed"
        start, size = boot_before["location"] * 4, boot_before["sizeWords"] * 4
        assert baseline[start:start + size] == candidate[start:start + size], "Boot.Thread bytes changed"
        for key, name, filename, digest, slot, thread in ACTORS:
            tab = next(t for t in after if t["slot"] == thread)
            assert tab["dataRegisters"][1]["value"] == (0xA11CE002 if key == "alice" else 0x0BAD0003)
            assert tab["capabilities"][1]["targetName"] == name
            assert tab["heap"]["initialWords"][0] == 0
        if args.approve:
            request("/api/namespace/save-table", dict(
                namespaceFingerprint=state["namespaceFingerprint"], ns_state=dict(abstractions=rows)))
            for design in designs:
                result = request("/api/boot-config/thread-designs", design)
                assert result["imageChanged"] is False and result["hardwareChanged"] is False
            saved = request("/api/boot-config")["config"]
            for design in designs:
                assert design in saved["threadInitialDesigns"]
            assert request("/api/boot-image/ns-state")["savedAbstractions"] == rows
        assert (image_path.read_bytes() if image_path.exists() else None) == committed
        output = ROOT / "generated-artifacts/alice-mallory-thread-preparation"
        output.mkdir(parents=True, exist_ok=True)
        (output / "candidate.bin").write_bytes(candidate)
        evidence = dict(saved=args.approve, installed=False, hardwareChanged=False,
                        candidateSha256=hashlib.sha256(candidate).hexdigest(),
                        bootThreadUnchanged=True, designs=designs, threads=after,
                        namespace=rows)
        (output / "evidence.json").write_text(json.dumps(evidence, indent=2))
        print(json.dumps({k: evidence[k] for k in (
            "saved", "installed", "hardwareChanged", "candidateSha256", "bootThreadUnchanged")}, indent=2))


if __name__ == "__main__":
    main()
