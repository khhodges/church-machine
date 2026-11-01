"""Exact actor candidates and reviewed Thread inputs, isolated from live state."""
import copy
import hashlib
import json
import shutil
import struct
import subprocess
from pathlib import Path

from server.boot_image import (
    _require_approved_executable_lump, generate_simulation_image, parse_ns_table_raw,
)
from server.built_thread_view import inspect_threads
from server.thread_initial_design import validate_bindings, validate_design

ROOT = Path(__file__).resolve().parents[2]
ACTORS = (
    ("alice", "ide.Alice", "ide.Alice.1.4f5f9b06.lump",
     "31bbddb5d20fe8ccd32d60b7c0d554b2af45ba80a85a9de56e3f6af8351ed93f", 16, 11),
    ("mallory", "ide.Mallory", "ide.Mallory.1.3a5e7373.lump",
     "11341685017d1852f514d1af6fda990edf87c89cbd082be8df83ccfb8a677fb5", 17, 12),
)


def test_exact_actors_to_generated_thread_tabs(tmp_path):
    lumps = tmp_path / "lumps"
    shutil.copytree(ROOT / "server/lumps", lumps)
    cfg = json.loads((ROOT / "server/boot-config.json").read_text())
    state = json.loads((lumps / "ns-state.json").read_text())
    rows = state["abstractions"]
    manifest = json.loads((lumps / "manifest.json").read_text())
    original = generate_simulation_image(cfg, str(lumps))
    original_words = struct.unpack(f"<{len(original) // 4}I", original)
    # Preserve every selected resident's placement; append only after its full
    # allocation (not its code limit, which excludes embedded source/c-lists).
    end = max(
        int(r["location"], 0) + (1 << (((original_words[int(r["location"], 0)] >> 23) & 15) + 6))
        for r in rows if r.get("resident") and int(r["location"], 0) < len(original_words))
    for key, name, filename, digest, slot, thread in ACTORS:
        raw = (lumps / filename).read_bytes()
        assert hashlib.sha256(raw).hexdigest() == digest
        words = _require_approved_executable_lump(str(lumps / filename), str(lumps), name)
        # Public dispatch and compact literal LOAD operands, no historical patch.
        assert words[1] == (3 if key == "alice" else 2)
        assert words[3 if key == "alice" else 2] == (
            0x070B0010 if key == "alice" else 0x070B0020)
        record = next(r for r in manifest if r.get("filename") == filename)
        existing = [r for r in rows if r["slot"] == slot or r["name"] == name]
        if existing:
            assert len(existing) == 1
            assert existing[0]["slot"] == slot and existing[0]["name"] == name
            assert existing[0]["filename"] == filename and existing[0]["binary_hash"] == digest
            continue
        rows.append(dict(slot=slot, name=name, seq=0, type="Inform",
                         filename=filename, binary_hash=digest,
                         token=record["token"], lump_version=record["lump_version"],
                         load_policy="Resident", resident=True, f=0, g=0,
                         location=hex(end), limit=hex(len(words) - 1)))
        end += len(words)
    (lumps / "ns-state.json").write_text(json.dumps(state))
    before = generate_simulation_image(cfg, str(lumps))
    by_slot = {r["slot"]: r for r in rows}
    designs = []
    for key, name, filename, digest, slot, thread in ACTORS:
        # Consume the same pure helper used by the Thread designer UI.
        init = json.loads(subprocess.check_output([
            "node", "-e",
            "const d=require('./simulator/thread-register-design');"
            "console.log(JSON.stringify(d.initialization(d.applyPreset("
            "d.blankDraft(),JSON.parse(process.argv[1]),process.argv[2]).draft)))",
            json.dumps(rows), key], cwd=ROOT, text=True))
        design = validate_design(dict(
            sizeWords=cfg["step1"]["threadLumpWords"],
            stackWords=cfg["step1"]["threadStackWords"],
            target=dict(slot=thread, name=by_slot[thread]["name"],
                        sequence=by_slot[thread]["seq"],
                        namespaceName=by_slot[0]["name"],
                        namespaceSequence=by_slot[0]["seq"]),
            initialization=init,
            tuples=[dict(name="TurnState", offset=0, policy="initialize",
                         fields=[dict(name="turns", type="uint32", size=1, initial=0)])]))
        validate_bindings(design, rows)
        designs.append(design)
    cfg = copy.deepcopy(cfg)
    cfg["threadInitialDesigns"] = designs
    image = generate_simulation_image(cfg, str(lumps))

    def tabs(binary):
        from server.thread_tuple_evidence import capture
        ns = parse_ns_table_raw(binary)
        for entry in ns["entries"]:
            entry["name"] = by_slot.get(entry["slot"], {}).get("name")
        evidence = capture(binary, ns, designs, [11, 12], rows) if binary == image else None
        return {t["slot"]: t for t in inspect_threads(binary, ns["entries"], ns["nsTableBase"], evidence)}

    initial_tabs, before_tabs, built = tabs(original), tabs(before), tabs(image)
    assert initial_tabs[1] == before_tabs[1] == built[1], "Boot.Thread unchanged"
    for key, name, filename, digest, slot, thread in ACTORS:
        view = built[thread]
        assert view["dataRegisters"][1]["value"] == (
            0xA11CE002 if key == "alice" else 0x0BAD0003)
        assert view["capabilities"][1]["value"] == 0x4A000000 | slot
        assert view["capabilities"][1]["targetName"] == name
        assert view["heap"]["initialWords"][0] == 0
        assert view["heap"]["definitionsStatus"] == "recorded"
        assert hashlib.sha256((lumps / filename).read_bytes()).hexdigest() == digest
    evidence_path = tmp_path / "candidate-evidence.json"
    evidence_path.write_text(json.dumps(dict(
        candidateSha256=hashlib.sha256(image).hexdigest(), threads=list(built.values()))))
    subprocess.run(["node", "simulator/test_alice_mallory_built_tabs.js", str(evidence_path)],
                   cwd=ROOT, check=True)
