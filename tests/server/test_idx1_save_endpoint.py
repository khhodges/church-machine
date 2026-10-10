"""Private-directory IDX1 compile/plan/confirmation/save/reload regressions."""
import copy
import base64
import hashlib
import subprocess
import json

import pytest
from bootstrap_test_support import isolate_application, reviewed_post

isolate_application()
from test_lump_save_endpoint import isolated_lumps
import server.app as app_module
from server.idx1_profile import validate_execution, execution_fields, frame_envelope


@pytest.fixture
def client(isolated_lumps, monkeypatch):
    monkeypatch.setenv("COMPILER_SIGNING_SECRET", "private-idx1-tests-" + "x" * 40)
    state_path = isolated_lumps / "ns-state.json"
    namespace_before = state_path.read_bytes()
    with app_module.app.test_client() as client:
        yield client
    # Successful publication, rejected candidates and failed commits must all
    # leave the existing engineer-owned assignments byte-for-byte unchanged.
    assert state_path.read_bytes() == namespace_before


def candidate(client, suffix="", tier=2):
    source = "; @abstraction PrivateIDX1\nLOAD CR1, CR6, DR2\nRETURN\n" + suffix
    result = client.post("/api/compile", json={
        "source": source, "language": "assembly", "isa_profile": "IDX1", "tier": tier,
    })
    compiled = result.get_json()
    assert result.status_code == 200 and compiled["ok"], compiled
    record = compiled["compiler_record"]
    return {"binary": compiled["words"], "metadata": {
        "abstraction": "PrivateIDX1", "language": "assembly", "content_type": "code",
        "artifact_only": True, "capabilities": compiled["capabilities"],
        "submitted_source": source, "trust_origin": compiled["trust_origin"],
        "compiler_record": record, "compiler_identity": record["compiler_identity"],
        "compiler_version": record["compiler_version"], **execution_fields(compiled),
    }}


def browser_candidate(profile="full"):
    """Use the production browser formatter/frame/envelope without /api/compile."""
    script = r"""
const fs = require('fs'), vm = require('vm');
const IDE = require('./simulator/idx1-ide.js');
const Assembler = require('./simulator/assembler.js');
const Frame = require('./simulator/lump-content-frame.js');
const Envelope = require('./simulator/idx1-execution-envelope.js');
(async () => {
 const source = '; @abstraction PrivateIDX1\nLOAD CR1, CR6, DR2\nRETURN\n';
 const assembled = IDE.compile(new Assembler(), source);
 if (assembled.errors.length) throw Error(JSON.stringify(assembled.errors));
 const caps = assembled.capabilities.map(cap => ({...cap, name:cap.name === '__SELF__' ? 'SELF' : cap.name}));
 const text = fs.readFileSync('./simulator/app-lumps.js', 'utf8');
 const start = text.indexOf('function _formatLumpApiDefinition(');
 const context = vm.createContext({});
 vm.runInContext(text.slice(start, text.indexOf('\n}', start) + 2), context);
 const api = context._formatLumpApiDefinition('PrivateIDX1', caps);
 api.isa_profile = 'IDX1';
 api.language = 'assembly';
 api.methods = [];
 const frame = await Frame.lumpBuildContentFrame(api, source, {profile:__PROFILE__});
 let size = 64;
 while (size < 1 + assembled.words.length + frame.frameWords.length + caps.length) size *= 2;
 const words = Array(size).fill(0);
 words[0] = ((31 << 27) | ((Math.log2(size)-6) << 23) | (assembled.words.length << 10) | caps.length) >>> 0;
 words.splice(1, assembled.words.length, ...assembled.words);
 words.splice(1 + assembled.words.length, frame.frameWords.length, ...frame.frameWords);
 words[size-1] = 0xFEED5E1F;
 const payload = Buffer.alloc(size*4);
 words.forEach((w,i) => payload.writeUInt32BE(w >>> 0,i*4));
 const envelope = await Envelope.frame(payload, assembled.layout);
 console.log(JSON.stringify({binary:words, metadata:{
   abstraction:'PrivateIDX1', language:'assembly', content_type:'code',
   artifact_only:true, capabilities:caps,
   compiler_owned_self:true, identity_contract:'dynamic-local',
   original_source:source, submitted_source:__PROFILE__ === 'compact'
     ? Frame.lumpFrameStripComments(source) : (__PROFILE__ === 'api' ? '' : source), original_binary:words,
   original_compiled_words:assembled.words, compiled_words:assembled.words,
   isa_profile:'IDX1', execution_envelope:Buffer.from(envelope.bytes).toString('base64'),
   execution_digest:envelope.executionDigest
 }}));
})().catch(e => {console.error(e);process.exit(1)});
"""
    script = script.replace("__PROFILE__", json.dumps(profile))
    result = subprocess.run(["node", "-e", script], check=True, capture_output=True, text=True)
    return json.loads(result.stdout)


def test_unsigned_real_browser_full_frame_is_attested(client, isolated_lumps):
    payload = browser_candidate()
    assert "compiler_record" not in payload["metadata"]
    saved, plan = save(client, payload)
    assert plan["compiler_record"]["isa_profile"] == "IDX1"
    raw = (isolated_lumps / saved["filename"]).read_bytes()
    assert app_module._inspect_lump_binary(raw)["source"] == payload["metadata"]["original_source"]
    assert validate_execution(saved, raw) is not None


@pytest.mark.parametrize("signed", [False, True])
def test_source_free_idx1_save_is_explicitly_unsupported(client, isolated_lumps, signed):
    payload = candidate(client, tier=0) if signed else browser_candidate("api")
    assert bool(payload["metadata"].get("compiler_record")) is signed
    # An external source snapshot is not a substitute for source actually
    # embedded in the selected saved artifact.
    response = client.post("/api/lumps/save-plan", json=payload)
    assert response.status_code == 400, response.get_json()
    assert "Full or Compact embedded source" in response.json["error"]
    assert json.loads((isolated_lumps / "manifest.json").read_text()) == []
    assert not list(isolated_lumps.glob("PrivateIDX1*"))

@pytest.mark.parametrize("signed", [False, True])
def test_api_idx1_exact_bundle_reload(client, isolated_lumps, signed):
    payload = candidate(client, tier=0) if signed else browser_candidate("api")
    source = payload["metadata"].get("original_source") or payload["metadata"]["submitted_source"]
    payload["metadata"].update(save_variants=True, original_source=source, source_required=True)
    payload["metadata"]["submitted_source"] = None
    saved, _ = save(client, payload)
    path = isolated_lumps / saved["filename"]
    assert app_module._inspect_lump_binary(path)["source"] is None
    url = f'/api/lump/{saved["token"]}/words'
    query = {"exact_filename": saved["filename"]}
    loaded = client.get(url, query_string=query)
    assert loaded.status_code == 200, loaded.json
    assert loaded.json["compiler_verified_source"] == source
    assert loaded.json["editing_source"] == source
    latest = client.get('/api/lumps/latest-primary/PrivateIDX1')
    assert latest.status_code == 200, latest.json
    assert latest.json["source"] == source
    assert latest.json["verified_bundle_source"] is True
    assert latest.json["intrinsic_source"] is False
    assert latest.json["words"] == loaded.json["words"]
    assert latest.json["binary_hash"] == saved["binary_hash"]
    detail = client.get(f'/api/lumps/{saved["token"]}/detail').json
    browser = subprocess.run(["node", "simulator/test_idx1_saved_flow.js", "--validate-repository"],
                             input=json.dumps({"words": loaded.json, "detail": detail}),
                             text=True, capture_output=True)
    assert browser.returncode == 0, browser.stderr
    approval = app_module._matching_lump_approval(str(isolated_lumps), saved["binary_hash"])
    loaded_data = dict(loaded.json, compiler_record=approval["compiler_record"])
    # Exercise the actual protected browser validator with the saved bytes.
    script = """
const fs = require('fs'), IDE = require('./simulator/idx1-ide.js');
const p = JSON.parse(fs.readFileSync(0, 'utf8'));
IDE.validateSaved(p.words, {...p, source:p.editing_source})
 .then(x => {if (!x) process.exit(2)}).catch(e => {console.error(e);process.exit(1)});
"""
    verified = subprocess.run(["node", "-e", script], input=json.dumps(loaded_data),
                              text=True, capture_output=True)
    assert verified.returncode == 0, verified.stderr
    bundle_path = isolated_lumps / (loaded.json["variant_bundle_id"] + ".variants.json")
    retained_bundle = bundle_path.read_bytes()
    bundle = json.loads(retained_bundle)
    bundle["source_sha256"] = "0" * 64
    bundle_path.write_text(json.dumps(bundle))
    tampered = client.get(url, query_string=query).json
    assert "compiler_verified_source" not in tampered and "variant_error" in tampered
    bundle_path.write_bytes(retained_bundle)
    # Even a self-consistent bundle for identical code but another source
    # revision cannot replace the signed source hash.
    from server.lump_variants import build_bundle
    wrong_source = source + "; different revision\n"
    wrong = build_bundle(path.read_bytes(), wrong_source,
                         hashlib.sha256(wrong_source.encode()).hexdigest(),
                         app_module._parse_intrinsic_lump_content,
                         loaded.json["source_compiler_record"]["compact_compile_context"])
    (isolated_lumps / (wrong["bundle_id"] + ".variants.json")).write_text(json.dumps(wrong))
    manifest_path = isolated_lumps / "manifest.json"
    manifest_original = manifest_path.read_bytes()
    manifest = json.loads(manifest_original)
    for row in manifest:
        if row.get("filename") == saved["filename"]:
            row["variant_bundle_id"] = wrong["bundle_id"]
    manifest_path.write_text(json.dumps(manifest))
    substituted = client.get(url, query_string=query).json
    assert "compiler_verified_source" not in substituted and "variant_error" in substituted
    manifest_path.write_bytes(manifest_original)
    bundle_path.unlink()
    rejected = client.get(url, query_string=query).json
    assert "compiler_verified_source" not in rejected
    assert "editing_source" not in rejected
    assert "variant_error" in rejected
    assert client.get('/api/lumps/latest-primary/PrivateIDX1').status_code == 409
    failed = subprocess.run(["node", "-e", script], input=json.dumps(
        dict(rejected, compiler_record=approval["compiler_record"])),
                            text=True, capture_output=True)
    assert failed.returncode != 0
def test_unsigned_browser_compact_frame_is_attested(client, isolated_lumps):
    payload = browser_candidate("compact")
    saved, _ = save(client, payload)
    raw = (isolated_lumps / saved["filename"]).read_bytes()
    inspected = app_module._inspect_lump_binary(raw)
    assert inspected["content_profile"] == "compact"
    assert inspected["source"] == "; @abstraction PrivateIDX1\nLOAD CR1, CR6, DR2\nRETURN\n"

def test_api_comment_only_history_retains_exact_source(client, isolated_lumps):
    saved_revisions = []
    for suffix in ("; first\n", "; second\n"):
        payload = candidate(client, suffix=suffix, tier=0)
        source = payload["metadata"]["submitted_source"]
        payload["metadata"].update(original_source=source, submitted_source=None,
                                   save_variants=True, source_required=True)
        saved, _ = save(client, payload)
        saved_revisions.append((saved, source))
    assert saved_revisions[0][0]["binary_hash"] == saved_revisions[1][0]["binary_hash"]
    manifest = json.loads((isolated_lumps / "manifest.json").read_text())
    archived = next(row for row in manifest if row.get("archived"))
    response = client.get(f'/api/lump/{archived["token"]}/words',
                          query_string={"archive_filename": archived["filename"]})
    assert response.status_code == 200, response.json
    assert response.json["compiler_verified_source"] == saved_revisions[0][1]
    assert response.json["source_compiler_record"]["source_hash"] == hashlib.sha256(
        saved_revisions[0][1].encode()).hexdigest()
@pytest.mark.parametrize("attack", ["source", "code", "layout", "api"])
def test_unsigned_browser_candidate_cannot_forge_compiler_facts(client, attack):
    payload = browser_candidate()
    if attack == "source":
        payload["metadata"]["original_source"] += "RETURN\n"
    else:
        original = validate_execution(payload["metadata"], bytes.fromhex(
            "".join(f"{word:08x}" for word in payload["binary"])))
        meta = json.loads(original.metadata_bytes)
        if attack == "code":
            payload["binary"][1] ^= 1
        elif attack == "layout":
            meta["layout"]["fastEntry"] = 3
        else:
            # Change an API byte, keeping JSON/frame lengths and envelope valid.
            raw = bytearray(original.payload)
            at = raw.index(b'"DR1"')
            raw[at + 3] = ord("0")
            payload["binary"] = [int.from_bytes(raw[i:i+4], "big") for i in range(0,len(raw),4)]
        raw = bytes.fromhex("".join(f"{word:08x}" for word in payload["binary"]))
        meta["payloadSha256"] = hashlib.sha256(raw).hexdigest()
        framed = frame_envelope(raw, meta)
        payload["metadata"].update(execution_envelope=base64.b64encode(framed).decode(),
                                   execution_digest=hashlib.sha256(framed).hexdigest())
    rejected = client.post("/api/lumps/save-plan", json=payload)
    assert rejected.status_code == 403, rejected.get_json()


def save(client, payload, prepare_only=False):
    planned = client.post("/api/lumps/save-plan", json=payload)
    assert planned.status_code == 201, planned.get_json()
    plan = planned.get_json()
    assert plan["ns_slot"] is None
    intent = client.post("/api/lumps/approval-intent", json={
        "digest": plan["digest"], "action": plan["action"], "plan_id": plan["plan_id"],
        "confirmation": True, "approval": {"grants": ["E"], "capability_type": "inform"},
    })
    assert intent.status_code == 201, intent.get_json()
    commit = {"binary": plan["final_binary"], "metadata": {
        **payload["metadata"], **execution_fields(plan),
        "compiler_record": plan["compiler_record"], "save_plan_id": plan["plan_id"],
        "approval_intent": intent.get_json()["intent"],
    }}
    if prepare_only:
        return commit, plan
    result = reviewed_post(client, "/api/lumps/save", commit)
    assert result.status_code == 200, result.get_json()
    assert result.get_json().get("ns_slot") is None
    return result.get_json(), plan


def test_idx1_roundtrip(client, isolated_lumps):
    payload = candidate(client)
    saved, plan = save(client, payload)
    raw = (isolated_lumps / saved["filename"]).read_bytes()
    envelope = validate_execution(saved, raw)
    assert envelope is not None
    assert saved["execution_digest"] == plan["execution_digest"]
    assert app_module._inspect_lump_binary(raw)["source"] == payload["metadata"]["submitted_source"]
    approval = app_module._matching_lump_approval(str(isolated_lumps), saved["binary_hash"])
    assert validate_execution(approval, raw) is not None
    loaded = client.get(f'/api/lump/{saved["token"]}/words', query_string={
        "exact_filename": saved["filename"]})
    assert loaded.status_code == 200, loaded.get_json()
    assert loaded.get_json()["execution_digest"] == saved["execution_digest"]
    operation = client.get(f'/api/lumps/save-operations/{saved["operation_id"]}/artifact')
    assert operation.status_code == 200, operation.get_json()
    assert operation.json["execution_digest"] == saved["execution_digest"]


@pytest.mark.parametrize("attack", ["missing", "digest", "payload", "profile", "strip"])
def test_idx1_rejects_tampering(client, isolated_lumps, attack):
    payload = candidate(client)
    if attack == "missing":
        del payload["metadata"]["execution_envelope"]
    elif attack == "digest":
        payload["metadata"]["execution_digest"] = "0" * 64
    elif attack == "profile":
        del payload["metadata"]["isa_profile"]
    elif attack == "strip":
        for key in ("isa_profile", "execution_envelope", "execution_digest",
                    "compiler_record", "trust_origin", "compiler_identity", "compiler_version"):
            payload["metadata"].pop(key)
    else:
        payload["binary"][1] ^= 1
    result = client.post("/api/lumps/save-plan", json=payload)
    assert result.status_code in (400, 403), result.get_json()
    assert json.loads((isolated_lumps / "manifest.json").read_text()) == []


def test_idx1_finalization_and_immutable_history(client, isolated_lumps):
    first = candidate(client)
    original = validate_execution(first["metadata"], bytes.fromhex(
        "".join(f"{word:08x}" for word in first["binary"])))
    first["metadata"].update(compiler_owned_self=True, identity_contract="dynamic-local")
    saved, plan = save(client, first)
    raw = (isolated_lumps / saved["filename"]).read_bytes()
    finalized = validate_execution(plan, raw)
    assert finalized.extents == original.extents
    assert finalized.instruction_starts == original.instruction_starts
    assert finalized.dispatch == original.dispatch
    sidecar = isolated_lumps / saved["filename"].replace(".lump", ".json")
    before_sidecar = sidecar.read_bytes()
    second = candidate(client, "; second revision\n")
    # Publish another artifact revision, not a replacement Namespace occupant.
    newer, _ = save(client, second)
    assert newer["lump_version"] > saved["lump_version"]
    manifest = json.loads((isolated_lumps / "manifest.json").read_text())
    archived = next(row for row in manifest if row.get("archived") and
                    row.get("execution_digest") == saved["execution_digest"])
    assert (isolated_lumps / archived["filename"]).read_bytes() == raw
    assert (isolated_lumps / archived["filename"].replace(".lump", ".json")).read_bytes() == before_sidecar
    loaded = client.get(f'/api/lump/{archived["token"]}/words',
                        query_string={"archive_filename": archived["filename"]})
    assert loaded.status_code == 200, loaded.get_json()
    assert loaded.json["execution_digest"] == saved["execution_digest"]


@pytest.mark.parametrize("location", ["approval", "sidecar", "manifest"])
def test_idx1_retrieval_rejects_tampering(client, isolated_lumps, location):
    saved, _ = save(client, candidate(client))
    if location == "approval":
        path = isolated_lumps / "approvals.json"
        document = json.loads(path.read_text())
        records = document["approvals"]
        records[saved["binary_hash"]]["execution_digest"] = "0" * 64
    elif location == "sidecar":
        path = isolated_lumps / saved["filename"].replace(".lump", ".json")
        document = json.loads(path.read_text())
        del document["execution_envelope"]
    else:
        path = isolated_lumps / "manifest.json"
        document = json.loads(path.read_text())
        document[0]["execution_digest"] = "0" * 64
    path.write_text(json.dumps(document))
    loaded = client.get(f'/api/lump/{saved["token"]}/words',
                        query_string={"exact_filename": saved["filename"]})
    assert loaded.status_code == 409, loaded.get_json()


def test_idx1_self_rehashed_layout_does_not_forge_attestation(client, isolated_lumps):
    payload = candidate(client)
    raw = bytes.fromhex("".join(f"{word:08x}" for word in payload["binary"]))
    parsed = validate_execution(payload["metadata"], raw)
    meta = json.loads(parsed.metadata_bytes)
    meta["layout"]["fastEntry"] = 3
    envelope = frame_envelope(raw, meta)
    payload["metadata"].update(
        execution_envelope=base64.b64encode(envelope).decode(),
        execution_digest=hashlib.sha256(envelope).hexdigest())
    result = client.post("/api/lumps/save-plan", json=payload)
    assert result.status_code in (400, 403), result.get_json()
    assert json.loads((isolated_lumps / "manifest.json").read_text()) == []


def test_idx1_plan_stale_revision_is_not_published(client, isolated_lumps):
    save(client, candidate(client))
    payload = candidate(client, "; stale revision\n")
    commit, _ = save(client, payload, prepare_only=True)
    path = isolated_lumps / "manifest.json"
    manifest = json.loads(path.read_text())
    manifest[0]["lump_version"] += 1
    path.write_text(json.dumps(manifest))
    before = path.read_bytes()
    before_files = {p.name: p.read_bytes() for p in isolated_lumps.glob("PrivateIDX1*.lump")}
    response = reviewed_post(client, "/api/lumps/save", commit)
    assert response.status_code in (403, 409, 423), response.get_json()
    assert path.read_bytes() == before
    assert {p.name: p.read_bytes() for p in isolated_lumps.glob("PrivateIDX1*.lump")} == before_files


def test_idx1_atomic_stage_failure_publishes_nothing(client, isolated_lumps, monkeypatch):
    commit, _ = save(client, candidate(client), prepare_only=True)
    original = app_module._atomic_write_json

    def fail_sidecar(path, document):
        if isinstance(document, dict) and document.get("isa_profile") == "IDX1":
            raise OSError("synthetic private IDX1 sidecar staging failure")
        return original(path, document)

    monkeypatch.setattr(app_module, "_atomic_write_json", fail_sidecar)
    result = reviewed_post(client, "/api/lumps/save", commit)
    assert result.status_code >= 400
    assert json.loads((isolated_lumps / "manifest.json").read_text()) == []
    assert not list(isolated_lumps.glob("PrivateIDX1*"))


def test_idx1_plan_cannot_drop_execution_snapshot(client, isolated_lumps):
    commit, _ = save(client, candidate(client), prepare_only=True)
    del commit["metadata"]["execution_envelope"]
    result = reviewed_post(client, "/api/lumps/save", commit)
    assert result.status_code == 409, result.get_json()
    assert result.json["plan_execution_mismatch"] is True
    assert json.loads((isolated_lumps / "manifest.json").read_text()) == []


def test_idx1_trusted_admission_and_hardware_fail_closed(client, isolated_lumps):
    saved, _ = save(client, candidate(client))
    raw = (isolated_lumps / saved["filename"]).read_bytes()
    approval = app_module._matching_lump_approval(str(isolated_lumps), saved["binary_hash"])
    from server.lump_approvals import is_trusted_compiler_record
    assert is_trusted_compiler_record(
        approval, binary=raw, signing_key=app_module._compiler_attestation_key())
    tampered = copy.deepcopy(approval)
    del tampered["execution_envelope"]
    assert not is_trusted_compiler_record(
        tampered, binary=raw, signing_key=app_module._compiler_attestation_key())
    from server.boot_image import _require_approved_executable_lump
    with pytest.raises(ValueError, match="IDX1"):
        _require_approved_executable_lump(
            str(isolated_lumps / saved["filename"]), str(isolated_lumps), "PrivateIDX1")
    from server.lump_admission_service import verify_gates, AdmissionError
    with pytest.raises(AdmissionError, match="IDX1"):
        verify_gates(raw, token=saved["token"], expected_digest=saved["binary_hash"],
                     authorization={}, requested=[], granted=[])
