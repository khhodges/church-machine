#!/usr/bin/env python3
"""Exact-source, authenticated, disposable Phase 1 linking and execution.

This command is deliberately not imported by the web server. No live catalog,
Namespace, hardware endpoint or production signing credential is used.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.prepare_phase1_candidates import IDENTITIES, recover, qualify_source


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def binary(words):
    return struct.pack(f">{len(words)}I", *words)


def inventory():
    paths = list((ROOT / "server/lumps").rglob("*"))
    paths += [ROOT / "server" / name for name in (
        "boot-config.json", "ide-hierarchy.json")]
    paths.append(ROOT / "tests/fixtures/phase1_namespace_target.json")
    return {str(p.relative_to(ROOT)): sha(p.read_bytes())
            for p in sorted(paths) if p.is_file()}


def private_application(directory):
    """Must run in a fresh process, before server.app is imported."""
    if "server.app" in sys.modules or "app" in sys.modules:
        raise RuntimeError("Phase 1 replay requires a fresh isolated process")
    lumps = directory / "lumps"
    lumps.mkdir()
    (lumps / "manifest.json").write_text("[]")
    (lumps / "ns-state.json").write_text('{"abstractions":[]}')
    (directory / "boot-config.json").write_text("{}")
    shutil.copyfile(ROOT / "server/ide-hierarchy.json", directory / "ide-hierarchy.json")
    hierarchy_path = directory / "ide-hierarchy.json"
    hierarchy = json.loads(hierarchy_path.read_text())
    # Approved structural identity, zero permissions. Do not reparent the
    # identity to an alias or infer local ownership of the nested Boot node.
    hierarchy.setdefault("definitions", {})["ide.Boot.Thread"] = []
    hierarchy["definitions"]["ide.Boot.NS"] = []
    hierarchy_path.write_text(json.dumps(hierarchy))
    for key, path in {
        "LUMPS_DIR": lumps, "BOOT_CONFIG_PATH": directory / "boot-config.json",
        "BUILD_SNAPSHOTS_DIR": directory / "build-snapshots",
        "DB_PATH": directory / "private.db",
        "IDE_HIERARCHY_PATH": directory / "ide-hierarchy.json",
    }.items():
        os.environ["CHURCH_TEST_" + key] = str(path)
    os.environ["CHURCH_TEST_ISOLATED_MODE"] = "1"
    # Disposable test TCB, never the configured workspace signing credential.
    os.environ["COMPILER_SIGNING_SECRET"] = "phase1-private-replay-only-" + "x" * 40
    from server import app
    assert Path(app.LUMPS_DIR).resolve() == lumps.resolve()
    assert Path(app.NS_STATE_PATH).resolve() == (lumps / "ns-state.json").resolve()
    return app, lumps


def post(client, url, payload, status):
    response = client.post(url, json=payload)
    data = response.get_json()
    if response.status_code != status or (status < 400 and data and data.get("ok") is False):
        raise ValueError(f"{url}: HTTP {response.status_code}: {data}")
    return data


def admitted_candidate(client, source, language, name):
    compiled = post(client, "/api/compile", {
        "source": source, "language": language, "tier": 2}, 200)
    post(client, "/api/compile/attest", {
        "words": compiled["words"], "compiler_record": compiled["compiler_record"]}, 200)
    tampered = list(compiled["words"])
    tampered[1] ^= 1
    post(client, "/api/compile/attest", {
        "words": tampered, "compiler_record": compiled["compiler_record"]}, 403)
    metadata = {
        "abstraction": name, "dot_name": name, "issue_n": 1,
        "language": language, "content_type": "code", "artifact_only": True,
        "capabilities": compiled["capabilities"], "submitted_source": source,
        "original_source": source, "trust_origin": compiled["trust_origin"],
        "compiler_record": compiled["compiler_record"],
        "compiler_identity": compiled["compiler_identity"],
        "compiler_version": compiled["compiler_version"],
        "portable_binding": compiled["portable_binding"],
    }
    plan = post(client, "/api/lumps/save-plan", {
        "binary": compiled["words"], "metadata": metadata}, 201)
    assert plan["ns_slot"] is None
    intent = post(client, "/api/lumps/approval-intent", {
        "digest": plan["digest"], "action": plan["action"], "plan_id": plan["plan_id"],
        "confirmation": True, "approval": {"grants": ["E"], "capability_type": "inform"}}, 201)
    payload = {"binary": plan["final_binary"], "metadata": {
        **metadata, "compiler_record": plan["compiler_record"],
        "save_plan_id": plan["plan_id"], "approval_intent": intent["intent"]}}
    review = post(client, "/api/lumps/save", payload, 428)
    saved_response = client.post("/api/lumps/save", json=payload, headers={
        "X-Change-Confirmation": review["change_confirmation"]["id"]})
    saved = saved_response.get_json()
    if saved_response.status_code != 200 or not saved.get("committed"):
        raise ValueError(f"Private admission failed: {saved}")
    assert saved.get("ns_slot") is None
    return saved


def primitive_targets(profile):
    """Only the approved structural identities and device rights, not grants
    inferred from a requesting program or catalog entries."""
    rights = {"LED_DEV": ["R", "W"], "BTN_DEV": ["R"],
              "TIMER_DEV": ["R", "W"], "UART_DEV": ["R", "W"],
              "M_BIT_DEV": ["R", "W"]}
    hierarchy = json.loads(Path(os.environ["CHURCH_TEST_IDE_HIERARCHY_PATH"]).read_text())
    targets = []
    for row in profile["rows"]:
        if row["kind"] == "lump":
            continue
        targets.append({
            "name": hierarchy.get("aliases", {}).get(IDENTITIES[row["name"]], IDENTITIES[row["name"]]),
            "declaredName": IDENTITIES[row["name"]], "slot": row["slot"],
            "seq": row["sequence"], "type": {
                "namespace": "Namespace", "thread": "Thread", "mmio": "Device"}[row["kind"]],
            "rights": rights.get(row["name"], []), "methods": [],
        })
    return targets


def build_image(profile, entries, lumps, output):
    from server.simulation_preparation import artifact_bindings, _validate_body
    from server.symbolic_binding import bind, embedded_api
    from server.namespace_ascending_image import (
        pack_namespace_word0, _write_entry, build_fresh_thread_lump, validate_image, FORMAT)
    rows = [dict(slot=e["slot"], name=e["canonicalName"], seq=e["sequence"],
                 filename=e["candidateFilename"], binary_hash=e["candidateSha256"],
                 token=e["candidateToken"], type="Inform", resident=True,
                 load_policy="Resident") for e in entries if e.get("candidateFilename")]
    bindings = artifact_bindings(rows, lumps)
    targets = primitive_targets(profile)
    for target in targets:
        next(e for e in entries if e["slot"] == target["slot"])["destinationIdentity"] = target
    for row, binding in zip(rows, bindings):
        words = _validate_body((lumps / row["filename"]).read_bytes())
        if not binding.get("portableBinding") and words[0] & 255 != 1:
            raise ValueError("Candidate dependencies lack authenticated symbolic binding")
        targets.append({**row, "rights": ["E"],
                        "methods": embedded_api(words).get("methods", [])})
    bodies = {}
    for row, binding in zip(rows, bindings):
        raw = (lumps / row["filename"]).read_bytes()
        contract = binding.get("portableBinding")
        if contract and contract["schema"] == "church.symbolic-lump-binding/v1":
            words, report = bind(_validate_body(raw), binding["portableBinding"],
                                next(t for t in targets if t["slot"] == row["slot"]), targets)
        elif contract:
            from server.simulation_preparation import _localize_portable
            localized, self_gt = _localize_portable(raw, binding, rows, bindings, lumps)
            words = _validate_body(localized)
            report = {"status": "bound", "calls": [], "rows": [
                {"index": 0, "name": "SELF", "status": "bound", "newGT": self_gt}]}
        else:
            from server.boot_image import materialize_compiler_self
            localized, self_gt = materialize_compiler_self(raw, row, lumps, row["name"])
            words = _validate_body(localized)
            report = {"status": "bound", "calls": [], "rows": [
                {"index": 0, "name": "SELF", "status": "bound", "newGT": self_gt}]}
        entry = next(e for e in entries if e["slot"] == row["slot"])
        entry.update(binding=report, approvalHash=binding["approvalHash"])
        if report["status"] != "bound":
            raise ValueError(f"NS[{row['slot']}] unresolved: {report}")
        bodies[row["slot"]] = words
        localized = binary(words)
        (output / f"slot-{row['slot']}.localized.lump").write_bytes(localized)
        entry["localizedSha256"] = sha(localized)
        assert sha((lumps / row["filename"]).read_bytes()) == entry["candidateSha256"]
    memory = [0] * profile["capacityWords"]
    table_words = profile["slotCount"] * 4
    # Unfinished entries remain in the evidence/design, with absent runtime
    # descriptors. They cannot masquerade as initialized functional objects.
    active = [r for r in profile["rows"] if r["kind"] != "lump" or r["slot"] in bodies]
    memory[:4] = [pack_namespace_word0(len(memory), profile["slotCount"]),
                  0, len(active) - 1, 0]
    _write_entry(memory, 1, 0, table_words - 1, 0)
    cursor = table_words
    for row in active:
        slot = row["slot"]
        if slot == 1:
            continue
        if row["kind"] == "mmio":
            _write_entry(memory, slot, row["address"], row["limit"], row["sequence"])
            continue
        if row["kind"] == "thread":
            raw = build_fresh_thread_lump(allocation_words=row["words"], stack_words=32,
                                        entry_slot=10, entry_sequence=0)
            words = list(struct.unpack(f">{len(raw)//4}I", raw))
            bodies[slot] = words
            (output / f"slot-{slot}.thread.lump").write_bytes(raw)
            limit = len(words) - 1
        else:
            words = bodies[slot]
            limit = (words[0] >> 10) & 8191
        if cursor + len(words) > len(memory):
            raise ValueError("Exact Phase 1 bodies exceed approved capacity")
        memory[cursor:cursor + len(words)] = words
        _write_entry(memory, slot, cursor, limit, row["sequence"])
        entry = next(e for e in entries if e["slot"] == slot)
        entry.update(location=cursor, words=len(words), runtimeBodySha256=sha(binary(words)))
        cursor += len(words)
    image = struct.pack(f"<{len(memory)}I", *memory)
    validation = validate_image(image, image_format=FORMAT)
    (output / "namespace.bin").write_bytes(image)
    return dict(imageSha256=sha(image), validation=validation, usedWords=cursor)


def run(correct_runtime_source=False):
    protected = inventory()
    root = ROOT / "generated-artifacts"
    root.mkdir(exist_ok=True)
    output = Path(tempfile.mkdtemp(prefix="phase1-linked-", dir=root))
    profile_raw = (ROOT / "tests/fixtures/phase1_namespace_target.json").read_bytes()
    profile = json.loads(profile_raw)
    report = {"schema": "phase1-linked-execution/v1", "profileSha256": sha(profile_raw),
              "scope": "Disposable compiler TCB and in-memory simulator only",
              "installed": False, "hardwareTouched": False, "full17EntryAcceptance": False,
              "sourceMode": "explicit-runtime-corrections" if correct_runtime_source else "naming-only",
              "entries": [dict(row) for row in profile["rows"]]}
    try:
        with tempfile.TemporaryDirectory(prefix="phase1-admission-") as temp:
            app, lumps = private_application(Path(temp))
            with app.app.test_client() as client:
                for entry in report["entries"]:
                    if entry["kind"] != "lump":
                        entry["status"] = "structural-or-device"
                        continue
                    if not entry.get("selection"):
                        entry.update(status="blocked", reason="No exact selected artifact; implementation/provisioning unfinished. Not stubbed.")
                        continue
                    selected = entry["selection"]
                    raw = (ROOT / "server/lumps" / selected["filename"]).read_bytes()
                    source, api = recover(raw, selected["binaryHash"])
                    qualified = qualify_source(source, entry["name"])
                    entry["qualifiedSourceSha256"] = sha(qualified.encode())
                    if correct_runtime_source:
                        from scripts.phase1_runtime_source import correct
                        qualified, entry["sourceCorrections"] = correct(qualified, entry["name"])
                    (output / f"slot-{entry['slot']}.source").write_text(source)
                    (output / f"slot-{entry['slot']}.candidate.source").write_text(qualified)
                    saved = admitted_candidate(client, qualified, api.get("language") or "assembly",
                                               IDENTITIES[entry["name"]])
                    artifact = lumps / saved["filename"]
                    shutil.copyfile(artifact, output / artifact.name)
                    entry.update(status="admitted-private", canonicalName=IDENTITIES[entry["name"]],
                                 sourceSha256=sha(source.encode()),
                                 candidateSourceSha256=sha(qualified.encode()),
                                 candidateFilename=artifact.name, candidateSha256=sha(artifact.read_bytes()),
                                 candidateToken=saved["token"])
            assert json.loads((lumps / "ns-state.json").read_text())["abstractions"] == []
            report["image"] = build_image(profile, report["entries"], lumps, output)
            replays = []
            for _ in range(3):
                result = subprocess.run(["node", str(ROOT / "scripts/replay_phase1_candidates.js"),
                                         str(output / "namespace.bin")],
                                        text=True, capture_output=True, timeout=120)
                if result.returncode:
                    raise ValueError(f"Simulator replay failed: {result.stderr}")
                replays.append(json.loads(result.stdout))
            report["execution"] = replays[0]
            report["repeatRuns"] = [dict(steps=r["steps"], faults=len(r["faults"]),
                                        selfTestReturns=len(r["selfTest"]["returns"]),
                                        evidenceSha256=sha(json.dumps(r, sort_keys=True).encode()))
                                    for r in replays]
            if replays[1:] != [replays[0], replays[0]]:
                raise ValueError("Repeated identical-image replay is not deterministic")
            for entry in report["entries"]:
                entry["use"] = report["execution"]["slots"].get(str(entry["slot"]), {})
            report["status"] = "faulted" if report["execution"]["faults"] else "bounded-replay"
            for entry in report["entries"]:
                use = entry["use"]
                if entry["status"] == "blocked":
                    continue
                if entry["slot"] == 12:
                    entry["runtimeBlocker"] = "Selected workload never CHANGE-activates Thread.3; identity access is not Thread execution."
                elif entry["slot"] in (4, 5):
                    entry["runtimeBlocker"] = "Selected workload checks the capability but performs no device data operation."
                entry["runtimeCoverage"] = (
                    "executed" if use.get("retired") or use.get("threadSteps") else
                    "device-data" if use.get("dataReads") or use.get("dataWrites") else
                    "identity-access-only" if use else "not-used")
    except Exception as exc:
        import traceback
        (output / "failure.txt").write_text(traceback.format_exc())
        report.update(status="blocked", blocker=str(exc))
    finally:
        report["fingerprints"] = {name: sha((ROOT / name).read_bytes()) for name in (
            "scripts/prepare_phase1_candidates.py", "scripts/run_phase1_candidates.py",
            "scripts/phase1_runtime_source.py", "scripts/replay_phase1_candidates.js",
            "server/symbolic_binding.py", "server/portable_binding.py",
            "server/namespace_ascending_image.py", "server/compile_worker.js",
            "simulator/lump_builder.js", "simulator/lump-api-contract.js",
            "simulator/namespace-runtime-core.js", "simulator/namespace-runtime-view.js",
            "simulator/simulator.js")}
        report["protectedInventorySha256"] = sha(json.dumps(protected, sort_keys=True).encode())
        report["protectedFilesUnchanged"] = inventory() == protected
        if not report["protectedFilesUnchanged"]:
            raise RuntimeError("Protected project inputs changed")
        (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(output.relative_to(ROOT))
    print(report["status"], report.get("blocker", ""))
    return report


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--correct-runtime-source", action="store_true",
                        help="Compile explicit, recorded private source corrections (never live files)")
    args = parser.parse_args()
    result = run(args.correct_runtime_source)
    sys.exit(1 if result["status"] == "blocked" else 2 if result["status"] == "faulted" else 0)
