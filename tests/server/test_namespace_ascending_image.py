import copy
import hashlib
import json
from pathlib import Path
import struct
import subprocess

import pytest

from server import boot_image
from server.namespace_ascending_image import (
    AscendingCandidateStore, FORMAT, generate_image, validate_image,
)
from server.namespace_image_refresh import RefreshStore
import scripts.generate_ascending_namespace_image as image_cli


ROOT = Path(__file__).resolve().parents[2]


def fixture():
    app_words = [boot_image.pack_lump_header(0, 1, 1, 0)] + [0] * 62
    app_words.append(boot_image.create_gt(0, 3, {"E": 1}, 1))
    raw = struct.pack(f">{len(app_words)}I", *app_words)
    state = {
        "namespaceFormat": FORMAT,
        "abstractions": [
            {"slot": 1, "name": "Boot.NS", "seq": 0, "type": "Inform", "location": 0},
            {"slot": 2, "name": "Boot.Thread", "seq": 0, "type": "Thread",
             "allocationWords": 256, "stackWords": 32},
            {"slot": 3, "name": "EntryProgram", "seq": 0, "type": "Inform",
             "filename": "EntryProgram.lump",
             "binary_hash": hashlib.sha256(raw).hexdigest(),
             "limit": 1, "boot": True},
            {"slot": 4, "name": "UART_DEV", "seq": 0, "type": "Inform",
             "backing": "mmio", "location": 0x40000014, "limit": 2},
        ],
    }
    config = {"step1": {
        "totalNamespaceWords": 8192, "nsSlotsMax": 64,
        "threadLumpWords": 256, "threadStackWords": 32,
    }}
    return state, config, {"EntryProgram.lump": raw}


def build():
    state, config, artifacts = fixture()
    return generate_image(state, config, None, image_format=FORMAT, artifacts=artifacts)


def _assembled_lump(source, clist):
    assemble_script = r"""
const fs = require('node:fs');
const Assembler = require('./simulator/assembler');
const assembler = new Assembler();
const result = assembler.assemble(fs.readFileSync(0, 'utf8'));
if (assembler.errors.length) {
  console.error(JSON.stringify(assembler.errors));
  process.exit(1);
}
process.stdout.write(JSON.stringify(result.words));
"""
    completed = subprocess.run(
        ["node", "-e", assemble_script], cwd=ROOT,
        input=source, text=True, capture_output=True, check=False,
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr
    instructions = __import__("json").loads(completed.stdout)
    words = [0] * 64
    words[0] = boot_image.pack_lump_header(0, len(instructions), len(clist), 0)
    words[1:1 + len(instructions)] = instructions
    words[-len(clist):] = clist
    return struct.pack(f">{len(words)}I", *words)


def _generated_switch_pair():
    state, config, _ = fixture()
    self_gt = boot_image.create_gt(0, 3, {"E": 1}, 1)
    namespace_gt = boot_image.create_gt(0, 4, {"L": 1}, 1)
    source_artifact = _assembled_lump(
        "SWITCH CR15, CR6, #1\nIADD DR1, DR0, #41\nHALT",
        [self_gt, namespace_gt],
    )
    destination_artifact = _assembled_lump(
        "IADD DR1, DR0, #202\nHALT", [self_gt],
    )

    def image_for(artifact):
        target_state = copy.deepcopy(state)
        target_state["abstractions"][2]["binary_hash"] = hashlib.sha256(
            artifact).hexdigest()
        target_state["abstractions"][2]["limit"] = (
            struct.unpack(">I", artifact[:4])[0] >> 10
        ) & 8191
        return generate_image(
            target_state, config, None, image_format=FORMAT,
            artifacts={"EntryProgram.lump": artifact},
        )[0]

    namespace_a = image_for(source_artifact)
    namespace_b = image_for(destination_artifact)
    words = list(struct.unpack(f"<{len(namespace_a) // 4}I", namespace_a))
    base_b = len(words)
    words.extend(struct.unpack(f"<{len(namespace_b) // 4}I", namespace_b))

    # Relocate the separately generated Namespace B into a disjoint RAM range.
    words[base_b + 1] = base_b
    for slot in range(1, 64):
        offset = base_b + slot * 4
        entry = words[offset:offset + 4]
        if any(entry) and entry[0] < base_b:
            location = entry[0] + base_b
            words[offset:offset + 4] = [
                location, entry[1], boot_image.integrity32(location, entry[1]), entry[3]
            ]

    # NS[4] is generated as a live placeholder target, then bound to the exact
    # generated Namespace B root that SWITCH will install.
    root_offset = 4 * 4
    root_authority = boot_image.pack_ns_word1(255)
    words[root_offset:root_offset + 4] = [
        base_b, root_authority, boot_image.integrity32(base_b, root_authority), 0
    ]
    return struct.pack(f"<{len(words)}I", *words)


def test_ascending_image_has_four_word_header_ascending_slots_and_version_zero_entry():
    image, evidence = build()
    result = validate_image(image, image_format=FORMAT)
    words = struct.unpack(f"<{len(image) // 4}I", image)
    assert words[:4] == (boot_image.pack_namespace_word0(8192, 64), 0, 3, 0)
    assert words[4:8] == (
        0, boot_image.pack_ns_word1(255), boot_image.integrity32(0, boot_image.pack_ns_word1(255)), 0
    )
    assert result["format"] == FORMAT
    assert result["tableWords"] == 256
    assert result["liveSlots"] == [1, 2, 3, 4]
    assert result["entryThread"] == {"slot": 2, "sequence": 0, "gt": "02000002"}
    assert result["cr15"] == {
        "word0": "02000001", "word1": 0, "word2": 255, "word3": 0, "m": 1,
    }
    assert evidence["hardwareCertified"] is False
    assert evidence["approvalEligible"] is False
    assert evidence["activationAllowed"] is False


def test_generated_image_is_consumed_by_only_the_explicit_runtime_factory(tmp_path):
    image, _ = build()
    path = tmp_path / "ascending-image.bin"
    path.write_bytes(image)
    script = r"""
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Simulator = require('./simulator/simulator');
const sim = Simulator.fromAscendingNamespaceImage(fs.readFileSync(process.argv[1]), {
  word0: 0x02000001, word1: 0, word2: 255, word3: 0, m: 1
});
assert.equal(sim.namespaceGeometry().count, 64);
assert.equal(sim.readNSEntry(0), null);
assert.equal(sim.readNSEntry(2).word0_location, 256);
assert(sim.startEntryThread(), JSON.stringify(sim.faultLog));
sim.step();
assert.equal(sim.halted, true);
"""
    completed = subprocess.run(
        ["node", "-e", script, str(path)], cwd=ROOT,
        text=True, capture_output=True, check=False,
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr


def test_generated_ascending_namespaces_switch_preserves_context_and_faults_cleanly(tmp_path):
    path = tmp_path / "generated-switch-pair.bin"
    path.write_bytes(_generated_switch_pair())
    completed = subprocess.run(
        ["node", "simulator/test_namespace_runtime_core.js",
         "--generated-switch", str(path)],
        cwd=ROOT, text=True, capture_output=True, check=False,
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr
    assert "Generated ascending-image SWITCH context and fault tests passed." in completed.stdout


def test_candidate_cli_stages_only_validated_output_and_preserves_all_inputs(tmp_path, monkeypatch):
    state, config, artifacts = fixture()
    lumps = tmp_path / "lumps"
    lumps.mkdir()
    for name, raw in artifacts.items():
        (lumps / name).write_bytes(raw)
    state_path, config_path = tmp_path / "target-state.json", tmp_path / "config.json"
    state_path.write_text(__import__("json").dumps(state))
    config_path.write_text(__import__("json").dumps(config))
    before = {path: path.read_bytes() for path in (state_path, config_path, *lumps.iterdir())}
    monkeypatch.setattr(image_cli, "ROOT", tmp_path)
    output = tmp_path / "generated-artifacts" / "trial"

    record = image_cli.prepare(state_path, config_path, lumps, output, image_format=FORMAT)

    assert record["status"] == "private-candidate"
    assert record["activationAllowed"] is False
    assert record["installationAllowed"] is False
    assert record["hardwareProgrammingAllowed"] is False
    assert validate_image((output / "candidate.bin").read_bytes(), image_format=FORMAT)
    assert {path: path.read_bytes() for path in before} == before
    with pytest.raises(ValueError, match="existing"):
        image_cli.prepare(state_path, config_path, lumps, output, image_format=FORMAT)


def test_candidate_profile_review_and_approval_are_separate_and_non_activating(tmp_path):
    state, config, artifacts = fixture()
    lumps = tmp_path / "lumps"
    lumps.mkdir()
    for name, raw in artifacts.items():
        (lumps / name).write_bytes(raw)
    state_path, config_path = tmp_path / "target.json", tmp_path / "config.json"
    state_path.write_text(__import__("json").dumps(state))
    config_path.write_text(__import__("json").dumps(config))
    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(image_cli, "ROOT", tmp_path)
    output = tmp_path / "generated-artifacts" / "trial"
    try:
        image_cli.prepare(state_path, config_path, lumps, output, image_format=FORMAT)
    finally:
        monkeypatch.undo()
    candidate_before = {
        path.name: path.read_bytes() for path in output.iterdir()
    }
    store = AscendingCandidateStore(output.parent)

    review = store.review("trial")

    assert review["status"] == "profile-review-ready"
    assert review["historicalApprovalEligible"] is False
    assert review["activationAllowed"] is False
    assert review["hardwareProgrammingAllowed"] is False
    approval = store.approve("trial", review["reviewId"])
    assert approval["status"] == "profile-approved"
    assert approval["profileApprovalEligible"] is True
    assert approval["profileApproved"] is True
    assert approval["historicalApprovalEligible"] is False
    assert approval["approvalScope"] == "ascending-v1-profile-review-only"
    assert approval["installationAllowed"] is False
    assert approval["activationAllowed"] is False
    assert approval["hardwareProgrammingAllowed"] is False
    assert store.approve("trial", review["reviewId"]) == approval
    assert {path.name: path.read_bytes() for path in output.iterdir()} == candidate_before
    assert not (lumps / "approvals.json").exists()
    assert (output.parent / "ascending-v1-approvals" /
            f"{review['imageSha256']}.json").is_file()


def test_profile_approval_rejects_stale_review_and_tampered_candidate(tmp_path):
    state, config, artifacts = fixture()
    lumps = tmp_path / "lumps"
    lumps.mkdir()
    for name, raw in artifacts.items():
        (lumps / name).write_bytes(raw)
    state_path, config_path = tmp_path / "target.json", tmp_path / "config.json"
    state_path.write_text(__import__("json").dumps(state))
    config_path.write_text(__import__("json").dumps(config))
    monkeypatch = pytest.MonkeyPatch()
    monkeypatch.setattr(image_cli, "ROOT", tmp_path)
    output = tmp_path / "generated-artifacts" / "trial"
    try:
        image_cli.prepare(state_path, config_path, lumps, output, image_format=FORMAT)
    finally:
        monkeypatch.undo()
    store = AscendingCandidateStore(output.parent)
    review = store.review("trial")
    with pytest.raises(ValueError, match="stale"):
        store.approve("trial", "0" * 64)
    with (output / "candidate.bin").open("r+b") as image:
        image.seek(-4, 2)
        image.write(b"\x01\x00\x00\x00")
    with pytest.raises(ValueError, match="hash"):
        store.approve("trial", review["reviewId"])


def test_historical_refresh_rejects_ascending_profile_before_writing(tmp_path):
    state, config, _artifacts = fixture()
    state_path = tmp_path / "ns-state.json"
    config_path = tmp_path / "config.json"
    state_path.write_text(__import__("json").dumps(state))
    config_path.write_text(__import__("json").dumps(config))
    (tmp_path / "manifest.json").write_text("[]")
    store = RefreshStore(tmp_path, state_path, config_path)
    before = {path.name: path.read_bytes() for path in tmp_path.iterdir()}

    with pytest.raises(ValueError, match="profile-specific review"):
        store.prepare("owner")

    assert {path.name: path.read_bytes() for path in tmp_path.iterdir()} == before


def test_historical_boot_image_publication_rejects_valid_ascending_image():
    image, _evidence = build()
    from server import app as app_module

    with pytest.raises(ValueError, match="historical Header V2"):
        app_module._write_boot_image_bytes(image)


def test_profile_approval_route_requires_one_time_confirmation_and_never_installs(tmp_path, monkeypatch):
    image, evidence = build()
    candidate_root = tmp_path / "generated-artifacts"
    candidate = candidate_root / "trial"
    candidate.mkdir(parents=True)
    (candidate / "candidate.bin").write_bytes(image)
    (candidate / "candidate.json").write_text(__import__("json").dumps({
        **evidence,
        "status": "private-candidate",
        "approvalEligible": False,
        "installationAllowed": False,
        "activationAllowed": False,
        "hardwareProgrammingAllowed": False,
        "hardwareCertified": False,
    }))
    store = AscendingCandidateStore(candidate_root)
    from server import app as app_module

    lumps = tmp_path / "lumps"
    lumps.mkdir()
    for name, content in {
        "manifest.json": b"[]",
        "ns-state.json": b'{"abstractions":[]}',
        "approvals.json": b'{"version":1,"algorithm":"sha256","approvals":{}}',
    }.items():
        (lumps / name).write_bytes(content)
    config = tmp_path / "boot-config.json"
    config.write_text("{}")
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(lumps))
    monkeypatch.setattr(app_module, "LUMPS_MANIFEST_PATH", str(lumps / "manifest.json"))
    monkeypatch.setattr(app_module, "NS_STATE_PATH", str(lumps / "ns-state.json"))
    monkeypatch.setattr(app_module, "BOOT_CONFIG_PATH", str(config))
    monkeypatch.setattr(app_module, "BOOT_IMAGE_PATH", str(lumps / "boot-image.bin"))
    monkeypatch.setattr(
        app_module, "BOOT_IMAGE_PROVENANCE_PATH",
        str(lumps / "boot-image.provenance.json"))
    monkeypatch.setattr(app_module, "_ascending_candidate_store", lambda: store)
    client = app_module.app.test_client()

    reviewed = client.post("/api/namespace/ascending/review", json={"candidate": "trial"})
    assert reviewed.status_code == 200, reviewed.json
    review = reviewed.json
    request_body = {"candidate": "trial", "reviewId": review["reviewId"]}
    pending = client.post("/api/namespace/ascending/approve", json=request_body)
    assert pending.status_code == 428, pending.json
    assert not (candidate_root / "ascending-v1-approvals").exists()

    approved = client.post(
        "/api/namespace/ascending/approve", json=request_body,
        headers={"X-Change-Confirmation": pending.json["change_confirmation"]["id"]})

    assert approved.status_code == 200, approved.json
    assert approved.json["profileApprovalEligible"] is True
    assert approved.json["profileApproved"] is True
    assert approved.json["historicalApprovalEligible"] is False
    assert approved.json["activationAllowed"] is False
    assert approved.json["hardwareProgrammingAllowed"] is False
    assert not (lumps / "boot-image.bin").exists()
    assert (lumps / "approvals.json").read_bytes() == (
        b'{"version":1,"algorithm":"sha256","approvals":{}}')
    assert __import__("json").loads((candidate / "candidate.json").read_text())[
        "approvalEligible"] is False


@pytest.mark.parametrize("corruption, message", [
    ("legacy", "Historical Namespace Header V2"),
    ("members", "member count"),
    ("seal", "integrity seal"),
    ("reserved", "reserved metadata"),
    ("thread-sequence", "integrity seal"),
])
def test_validator_rejects_wrong_format_and_corrupt_new_images(corruption, message):
    image, _ = build()
    words = list(struct.unpack(f"<{len(image) // 4}I", image))
    if corruption == "legacy":
        words[1] = 0x4E534832
    elif corruption == "members":
        words[2] -= 1
    elif corruption == "seal":
        words[4 + 2] ^= 1
    elif corruption == "reserved":
        words[3] = 1
    elif corruption == "thread-sequence":
        words[2 * 4 + 1] ^= 1 << 21
    corrupted = struct.pack(f"<{len(words)}I", *words)
    with pytest.raises(ValueError, match=message):
        validate_image(corrupted, image_format=FORMAT)


def test_builder_requires_explicit_new_format_and_preserves_stale_self_binding():
    state, config, artifacts = fixture()
    with pytest.raises(ValueError, match="explicit selection"):
        generate_image(state, config, None, image_format="clean-saved-namespace-v1",
                       artifacts=artifacts)
    artifacts["EntryProgram.lump"] = artifacts["EntryProgram.lump"][:-4] + struct.pack(">I", 0x02000006)
    state["abstractions"][2]["binary_hash"] = hashlib.sha256(
        artifacts["EntryProgram.lump"]).hexdigest()
    image, _ = generate_image(state, config, None, image_format=FORMAT, artifacts=artifacts)
    words = struct.unpack(f"<{len(image)//4}I", image)
    assert words[words[3 * 4] + 63] == 0x02000006
    assert validate_image(image, image_format=FORMAT)
