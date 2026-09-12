import hashlib
import json
import struct
import sys
import types
import zlib

import pytest

_trace_stub = types.ModuleType("hardware.wukong_trace_symbols")
_trace_stub.trace_metadata = lambda _nia: None
_trace_stub._disassemble_word = lambda word: f"0x{word:08X}"
sys.modules.setdefault("hardware.wukong_trace_symbols", _trace_stub)
import server.app as app_module


def _words(cw=1, cc=1, marker=0):
    words = [(0x1F << 27) | (cw << 10) | cc, marker] + [0] * 62
    identity = hashlib.sha256(b"LumpSaveTest#1").hexdigest()
    words[-1] = 0x0A000000 | (int(identity[:8], 16) & 0x1FFFFFF)
    return words


def _raw(words):
    return struct.pack(">64I", *words)


def _words_with_source(source):
    source_bytes = source.encode("utf-8")
    api_bytes = b"{}"
    words = _words(cw=1, marker=36)
    words[2] = (0xAB << 24) | (0x01 << 16) | len(api_bytes)
    words[3] = int.from_bytes(api_bytes.ljust(4, b"\0"), "big")
    words[4] = len(source_bytes)
    for offset in range(0, len(source_bytes), 4):
        words[5 + offset // 4] = int.from_bytes(
            source_bytes[offset:offset + 4].ljust(4, b"\0"), "big")
    return words


def _actual_client_new_entry_payload(source):
    """Build the full Save-to-Namespace payload emitted by app-run.js.

    This deliberately includes the V1.3 API/source frame and the immutable
    compiler snapshot fields.  The server boundary must accept this shape, not
    only the compact header/code/c-list arrays used by older endpoint tests.
    """
    code_words = [0, 0]
    api_bytes = json.dumps(
        {"abstraction": "Task3430RoundTrip", "capabilities": ["__SELF__"]},
        separators=(",", ":"),
    ).encode("utf-8")
    source_bytes = source.encode("utf-8")
    compressor = zlib.compressobj(wbits=-15)
    source_frame_bytes = compressor.compress(source_bytes) + compressor.flush()

    def pack_words(raw):
        return [
            int.from_bytes(raw[offset:offset + 4].ljust(4, b"\0"), "big")
            for offset in range(0, len(raw), 4)
        ]

    # flags=0x07 is the production full-profile, deflate-raw source frame.
    frame = [
        (0xAB << 24) | (0x07 << 16) | len(api_bytes),
        *pack_words(api_bytes),
        len(source_frame_bytes),
        *pack_words(source_frame_bytes),
    ]
    lump_size = 64
    binary = [0] * lump_size
    binary[0] = (0x1F << 27) | (len(code_words) << 10) | 1
    binary[1:1 + len(code_words)] = code_words
    frame_start = 1 + len(code_words)
    assert frame_start + len(frame) < lump_size - 1
    binary[frame_start:frame_start + len(frame)] = frame
    binary[-1] = 0xFEED5E1F

    capabilities = [{
        "name": "__SELF__",
        "rights": ["E"],
        "grants": [],
        "compiler_owned_self": True,
        "placeholder": True,
    }]
    metadata = {
        "abstraction": "Task3430RoundTrip",
        "content_type": "code",
        "language": "",
        "ns_slot": None,
        "ns_slot_policy": "dynamic",
        "new_entry": True,
        "replacement": False,
        "capabilities": capabilities,
        "compiler_owned_self": True,
        "identity_contract": "dynamic-local",
        "compiled_words": code_words[:],
        "original_compiled_words": code_words[:],
        "original_binary": binary[:],
        "original_source": source,
        "submitted_source": source,
        "source_required": True,
        "output_profile": "full",
        "namespace_sequence": 0,
        "grants": ["E"],
        "token": "12345678",
    }
    return {"binary": binary, "metadata": metadata}


@pytest.fixture
def isolated_lumps(tmp_path, monkeypatch):
    (tmp_path / "manifest.json").write_text("[]")
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(tmp_path))
    monkeypatch.setattr(app_module, "_LUMPS_DIR", str(tmp_path))
    monkeypatch.setattr(app_module, "LUMPS_MANIFEST_PATH", str(tmp_path / "manifest.json"))
    monkeypatch.setattr(app_module, "BOOT_IMAGE_PATH", str(tmp_path / "absent-boot.bin"))
    return tmp_path


def _approved_payload(client, words, token="7c501001", name="LumpSaveTest",
                      submitted_source=None):
    identity = hashlib.sha256(f"{name}#1".encode()).hexdigest()
    words[-1] = 0x0A000000 | (int(identity[:8], 16) & 0x1FFFFFF)
    candidate = {
        "binary": words,
        "metadata": {
            "token": token, "abstraction": name, "content_type": "code",
            "language": "assembly", "ns_slot": None, "capabilities": [],
            "methods": [], "grants": ["E"],
            "submitted_source": submitted_source,
        },
    }
    plan_response = client.post("/api/lumps/save-plan", json=candidate)
    assert plan_response.status_code == 201, plan_response.get_data(as_text=True)
    plan = plan_response.get_json()
    assert plan["plan_id"] == plan["plan"]
    assert plan["action"] == (
        "replace" if plan["consequence"] == "replace" else "save")
    issued = client.post("/api/lumps/approval-intent", json={
        "digest": plan["digest"],
        "action": plan["action"],
        "plan_id": plan["plan_id"],
        "confirmation": True,
        "approval": {"grants": ["E"], "capability_type": "inform"},
    })
    assert issued.status_code == 201
    return {
        "binary": words,
        "metadata": {
            "token": token, "abstraction": name, "content_type": "code",
            "language": "assembly", "ns_slot": None, "capabilities": [],
            "methods": [], "grants": ["E"],
            "submitted_source": submitted_source,
            "save_plan_id": plan["plan_id"],
            "approval_intent": issued.get_json()["intent"],
        },
    }


def test_save_persists_exact_binary_and_exact_approval(isolated_lumps):
    words = _words(cw=1, marker=7)
    with app_module.app.test_client() as client:
        response = client.post("/api/lumps/save",
                               json=_approved_payload(client, words))
    assert response.status_code == 200, response.get_data(as_text=True)
    path = isolated_lumps / response.get_json()["lump"]
    raw = path.read_bytes()
    facts = app_module._inspect_lump_binary(raw)
    approval = app_module._matching_lump_approval(
        str(isolated_lumps), facts["binary_hash"])
    assert raw == _raw(words)
    assert approval["binary_hash"] == hashlib.sha256(raw).hexdigest()
    manifest = json.loads((isolated_lumps / "manifest.json").read_text())
    assert manifest[0]["filename"] == path.name
    assert "sidecar_file" not in manifest[0]
    saved = response.get_json()
    assert saved["filename"] == path.name
    assert saved["abstraction"] == "LumpSaveTest"
    assert saved["dot_name"] == approval["dot_name"]
    assert saved["issue_n"] == approval["issue_n"]
    assert saved["binary_hash"] == approval["binary_hash"]
    assert saved["operation_id"]
    assert response.headers["X-Lump-Save-Operation"] == saved["operation_id"]
    diagnostics = (
        isolated_lumps / "save-runtime-diagnostics.jsonl"
    ).read_text().splitlines()
    assert diagnostics
    diagnostic = json.loads(diagnostics[-1])
    assert diagnostic["operation_id"] == saved["operation_id"]
    assert diagnostic["committed"] is True
    assert "source_text" not in json.dumps(diagnostic)
    assert "submitted_source" not in json.dumps(diagnostic)


def test_actual_client_full_new_entry_payload_round_trips_before_self_rewrite(
        isolated_lumps, monkeypatch):
    state = isolated_lumps / "ns-state.json"
    state.write_text(json.dumps({"abstractions": []}))
    monkeypatch.setattr(app_module, "NS_STATE_PATH", str(state))
    source = """abstraction Task3430RoundTrip {
    method Ping() {
        return(3430)
    }
}
"""
    candidate = _actual_client_new_entry_payload(source)
    with app_module.app.test_client() as client:
        planned = client.post("/api/lumps/save-plan", json=candidate)
        assert planned.status_code == 201, planned.get_data(as_text=True)
        plan = planned.get_json()
        assert isinstance(plan["ns_slot"], int)
        issued = client.post("/api/lumps/approval-intent", json={
            "digest": plan["digest"],
            "action": plan["action"],
            "plan_id": plan["plan_id"],
            "confirmation": True,
            "approval": {"grants": ["E"], "capability_type": "inform"},
        })
        assert issued.status_code == 201, issued.get_data(as_text=True)
        commit = dict(candidate)
        commit["binary"] = plan["final_binary"]
        commit["metadata"] = dict(
            candidate["metadata"],
            ns_slot=plan["ns_slot"],
            save_plan_id=plan["plan_id"],
            approval_intent=issued.get_json()["intent"],
        )
        saved = client.post("/api/lumps/save", json=commit)

    assert saved.status_code == 200, saved.get_data(as_text=True)
    body = saved.get_json()
    assert body["ns_slot"] == plan["ns_slot"]
    assert body["final_binary"][-1] != 0xFEED5E1F
    assert body["final_binary"][-1] >> 16 != 0xFEED
    state_doc = json.loads((isolated_lumps / "ns-state.json").read_text())
    state_row = next(
        row for row in state_doc["abstractions"]
        if row.get("slot") == plan["ns_slot"]
    )
    assert state_row["name"] == "Task3430RoundTrip"
    assert state_row["token"] == body["token"]


def test_each_replacement_save_gets_a_new_history_version_and_timestamp(isolated_lumps):
    with app_module.app.test_client() as client:
        first = client.post("/api/lumps/save", json=_approved_payload(
            client, _words(marker=41), token="7c504041"))
        assert first.status_code == 200
        first_saved = first.get_json()

        second = client.post("/api/lumps/save", json=_approved_payload(
            client, _words(marker=42), token="7c504041"))
        assert second.status_code == 200
        second_saved = second.get_json()

        history_response = client.get("/api/lumps/7c504041/history")

    assert second_saved["lump_version"] > first_saved["lump_version"]
    assert second_saved["compiled_at"] > first_saved["compiled_at"]
    assert history_response.status_code == 200
    history = history_response.get_json()["history"]
    versions = [row["version"] for row in history]
    assert len(versions) == len(set(versions))
    assert sorted(versions) == [
        first_saved["lump_version"], second_saved["lump_version"]
    ]
    assert all(row.get("compiled_at") for row in history)


def test_missing_approval_intent_fails_closed_without_mutation(isolated_lumps):
    payload = _approved_payload
    words = _words(marker=3)
    with app_module.app.test_client() as client:
        response = client.post("/api/lumps/save", json={
            "binary": words,
            "metadata": {"token": "7c501002", "abstraction": "Denied",
                         "language": "assembly", "capabilities": []},
        })
    assert response.status_code == 403
    assert not list(isolated_lumps.glob("*.lump"))


def test_approval_intent_is_consumed_once(isolated_lumps):
    words = _words(marker=9)
    with app_module.app.test_client() as client:
        payload = _approved_payload(client, words, token="7c501003")
        assert client.post("/api/lumps/save", json=payload).status_code == 200
        replay = client.post("/api/lumps/save", json=payload)
    assert replay.status_code == 403


def test_plan_binds_hash_and_token_even_for_same_abstraction(isolated_lumps):
    words = _words(marker=12)
    with app_module.app.test_client() as client:
        payload = _approved_payload(client, words, token="7c501012")
        # The filename is content/name-derived, so a second token for the same
        # abstraction is precisely the case where token binding must matter.
        payload["metadata"]["token"] = "7c501013"
        response = client.post("/api/lumps/save", json=payload)
    assert response.status_code == 403
    assert "token does not match" in response.get_json()["error"]

    words = _words(marker=13)
    with app_module.app.test_client() as client:
        payload = _approved_payload(client, words, token="7c501014")
        payload["binary"][1] = 14
        response = client.post("/api/lumps/save", json=payload)
    assert response.status_code == 403
    assert "digest does not match" in response.get_json()["error"]


def test_plan_rejects_authoritative_library_mutation(isolated_lumps):
    with app_module.app.test_client() as client:
        # Establish a valid replacement destination.
        assert client.post("/api/lumps/save", json=_approved_payload(
            client, _words(marker=20), token="7c501020")).status_code == 200
        payload = _approved_payload(client, _words(marker=21), token="7c501020")
        manifest = json.loads((isolated_lumps / "manifest.json").read_text())
        (isolated_lumps / manifest[0]["filename"]).write_bytes(_raw(_words(marker=22)))
        response = client.post("/api/lumps/save", json=payload)
    assert response.status_code == 403
    assert "authoritative library changed" in response.get_json()["error"]


def test_same_abstraction_new_token_is_server_authored_create(isolated_lumps):
    with app_module.app.test_client() as client:
        assert client.post("/api/lumps/save", json=_approved_payload(
            client, _words(marker=30), token="7c501030")).status_code == 200
        response = client.post("/api/lumps/save-plan", json={
            "binary": _words(marker=31),
            "metadata": {
                "token": "7c501031", "abstraction": "LumpSaveTest",
                "content_type": "code", "language": "assembly",
                "capabilities": [], "approval_action": "replace",
            },
        })
    assert response.status_code == 201
    plan = response.get_json()
    assert plan["action"] == "save"
    assert plan["consequence"] == "create"
    assert plan["current_lump"] is None


def test_stale_editor_base_is_blocked_or_explicitly_preserved(isolated_lumps):
    with app_module.app.test_client() as client:
        first = client.post("/api/lumps/save", json=_approved_payload(
            client, _words(marker=32), token="7c501032"))
        assert first.status_code == 200
        first_saved = first.get_json()
        base = {
            "token": first_saved["token"],
            "source_hash": None,
            "compiled_at": first_saved["compiled_at"],
            "abstraction": "LumpSaveTest",
        }

        second = client.post("/api/lumps/save", json=_approved_payload(
            client, _words(marker=33), token="7c501033"))
        assert second.status_code == 200

        stale_candidate = {
            "binary": _words(marker=34),
            "metadata": {
                "token": "7c501034",
                "abstraction": "LumpSaveTest",
                "content_type": "code",
                "language": "assembly",
                "capabilities": [],
                "submitted_source": None,
                "editor_base": base,
            },
        }
        blocked = client.post("/api/lumps/save-plan", json=stale_candidate)
        assert blocked.status_code == 409
        assert blocked.get_json()["stale_editor_base"] is True
        assert blocked.get_json()["latest"]["token"] == "7c501033"

        stale_candidate["metadata"]["preserve_stale_revision"] = True
        preserved = client.post("/api/lumps/save-plan", json=stale_candidate)
        assert preserved.status_code == 201
        assert preserved.get_json()["consequence"] == "create"


def test_submitted_source_must_match_embedded_source(isolated_lumps):
    with app_module.app.test_client() as client:
        response = client.post("/api/lumps/save-plan", json={
            "binary": _words(marker=35),
            "metadata": {
                "token": "7c501035",
                "abstraction": "LumpSaveTest",
                "content_type": "code",
                "language": "assembly",
                "capabilities": [],
                "submitted_source": "source that is not embedded",
            },
        })
    assert response.status_code == 422
    assert response.get_json()["source_mismatch"] is True
    assert not list(isolated_lumps.glob("*.lump"))


def test_matching_submitted_and_embedded_source_is_accepted(isolated_lumps):
    source = "method Main { RETURN }"
    with app_module.app.test_client() as client:
        response = client.post("/api/lumps/save-plan", json={
            "binary": _words_with_source(source),
            "metadata": {
                "token": "7c501036",
                "abstraction": "LumpSaveTest",
                "content_type": "code",
                "language": "assembly",
                "capabilities": [],
                "submitted_source": source,
            },
        })
    assert response.status_code == 201, response.get_data(as_text=True)


def test_source_required_rejects_api_only_binary_before_commit(isolated_lumps):
    words = _words(marker=37)
    with app_module.app.test_client() as client:
        payload = _approved_payload(client, words, token="7c501037")
        payload["metadata"]["source_required"] = True
        response = client.post("/api/lumps/save", json=payload)
    assert response.status_code == 422, response.get_data(as_text=True)
    body = response.get_json()
    assert body["source_required"] is True
    assert body["committed"] is False
    assert body["safe_retry"] is True
    assert not list(isolated_lumps.glob("*.lump"))


def test_source_required_accepts_matching_embedded_source(isolated_lumps):
    source = "method Main { RETURN }"
    words = _words_with_source(source)
    with app_module.app.test_client() as client:
        payload = _approved_payload(
            client, words, token="7c501038", submitted_source=source)
        payload["metadata"]["source_required"] = True
        response = client.post("/api/lumps/save", json=payload)
    assert response.status_code == 200, response.get_data(as_text=True)
    saved = response.get_json()
    assert saved["binary_hash"] == hashlib.sha256(_raw(words)).hexdigest()


def test_expired_or_other_session_plan_requires_fresh_review(isolated_lumps):
    words = _words(marker=40)
    with app_module.app.test_client() as client:
        payload = _approved_payload(client, words, token="7c501040")
        plan_id = payload["metadata"]["save_plan_id"]
        app_module._LUMP_SAVE_PLANS[plan_id]["expires"] = 0
        expired = client.post("/api/lumps/save", json=payload)
    assert expired.status_code == 403
    assert "expired" in expired.get_json()["error"]
    assert not list(isolated_lumps.glob("*.lump"))

    owner = app_module.app.test_client()
    payload = _approved_payload(owner, _words(marker=41), token="7c501041")
    with app_module.app.test_client() as other:
        wrong_session = other.post("/api/lumps/save", json=payload)
    assert wrong_session.status_code == 403
    assert "different session" in wrong_session.get_json()["error"]
    assert not list(isolated_lumps.glob("*.lump"))


@pytest.mark.parametrize(
    "alternate_action", ["fork", "restore", "deploy", "import-approval"])
def test_alternate_approval_action_cannot_bypass_save_plan(
        isolated_lumps, alternate_action):
    words = _words(marker=50)
    digest = hashlib.sha256(_raw(words)).hexdigest()
    with app_module.app.test_client() as client:
        issued = client.post("/api/lumps/approval-intent", json={
            "digest": digest, "action": alternate_action,
            "confirmation": True, "approval": {},
        })
        assert issued.status_code == 201
        response = client.post("/api/lumps/save", json={
            "binary": words,
            "metadata": {
                "token": "7c501050", "abstraction": "LumpSaveTest",
                "content_type": "code", "language": "assembly",
                "capabilities": [],
                "approval_action": alternate_action,
                "approval_intent": issued.get_json()["intent"],
            },
        })
    assert response.status_code == 403
    assert "save plan" in response.get_json()["error"]
    assert not list(isolated_lumps.glob("*.lump"))


def test_bad_binary_is_rejected_before_any_artifact_write(isolated_lumps):
    words = _words(cw=0, marker=1)
    words[0] = 0
    with app_module.app.test_client() as client:
        response = client.post("/api/lumps/save", json={
            "binary": words,
            "metadata": {"token": "7c501001", "abstraction": "LumpSaveTest",
                         "capabilities": []},
        })
    assert response.status_code == 400
    assert not list(isolated_lumps.glob("*.lump"))


def test_compiler_self_placeholder_requires_namespace_destination(
        isolated_lumps):
    words = _words(cw=1, cc=1, marker=0)
    words[-1] = 0xFEED5E1F
    with app_module.app.test_client() as client:
        response = client.post("/api/lumps/save-plan", json={
            "binary": words,
            "metadata": {
                "token": "7c501080",
                "abstraction": "UnboundCompilerSelf",
                "content_type": "code",
                "capabilities": [{
                    "name": "__SELF__",
                    "rights": ["E"],
                    "compiler_owned_self": True,
                }],
            },
        })

    assert response.status_code == 422, response.get_data(as_text=True)
    body = response.get_json()
    assert body["namespace_identity_failed"] is True
    assert body["clist_row"] == 0
    assert not list(isolated_lumps.glob("*.lump"))


def test_unresolved_self_placeholder_cannot_hide_in_non_self_row(
        isolated_lumps):
    words = _words(cw=1, cc=1, marker=0)
    words[-1] = 0xFEED5E1F
    with app_module.app.test_client() as client:
        response = client.post("/api/lumps/save-plan", json={
            "binary": words,
            "metadata": {
                "token": "7c501081",
                "abstraction": "ForgedCompilerSelf",
                "content_type": "code",
                "capabilities": [{
                    "name": "NotSelf",
                    "rights": ["E"],
                }],
            },
        })

    assert response.status_code == 422, response.get_data(as_text=True)
    body = response.get_json()
    assert body["capability_validation_failed"] is True
    assert body["clist_row"] == 0
    assert body["actual_word"] == 0xFEED5E1F
    assert not list(isolated_lumps.glob("*.lump"))


@pytest.mark.parametrize("submitted_word", [0xFEEDDEAD, 0])
def test_compiler_self_rejects_noncanonical_intermediate_word(
        isolated_lumps, submitted_word):
    words = _words(cw=1, cc=1, marker=0)
    words[-1] = submitted_word
    with app_module.app.test_client() as client:
        response = client.post("/api/lumps/save-plan", json={
            "binary": words,
            "metadata": {
                "token": "7c501083",
                "abstraction": "NoncanonicalCompilerSelf",
                "content_type": "code",
                "ns_slot": 7,
                "capabilities": [{
                    "name": "__SELF__",
                    "rights": ["E"],
                    "compiler_owned_self": True,
                }],
            },
        })

    assert response.status_code == 422, response.get_data(as_text=True)
    body = response.get_json()
    assert body["self_intermediate_contract_failed"] is True
    assert body["actual_word"] == submitted_word
    assert not list(isolated_lumps.glob("*.lump"))


def test_compiler_self_marker_requires_compiler_provenance(
        isolated_lumps):
    words = _words(cw=1, cc=1, marker=0)
    words[-1] = 0xFEED5E1F
    with app_module.app.test_client() as client:
        response = client.post("/api/lumps/save-plan", json={
            "binary": words,
            "metadata": {
                "token": "7c501084",
                "abstraction": "UnprovenCompilerSelf",
                "content_type": "code",
                "ns_slot": 7,
                "capabilities": [{"name": "__SELF__", "rights": ["E"]}],
            },
        })

    assert response.status_code == 422, response.get_data(as_text=True)
    body = response.get_json()
    assert body["self_intermediate_contract_failed"] is True
    assert body["actual_word"] == 0xFEED5E1F
    assert not list(isolated_lumps.glob("*.lump"))


def test_misplaced_self_marker_is_rejected_before_namespace_rewrite(
        isolated_lumps):
    header = (0x1F << 27) | (1 << 10) | 2
    words = [header, 0] + [0] * 62
    words[-2] = 0x4A000007
    words[-1] = 0xFEED5E1F
    with app_module.app.test_client() as client:
        response = client.post("/api/lumps/save-plan", json={
            "binary": words,
            "metadata": {
                "token": "7c501085",
                "abstraction": "MisplacedCompilerSelf",
                "content_type": "code",
                "ns_slot": 7,
                "capabilities": [
                    {"name": "Other", "rights": ["E"], "nsIndex": 7},
                    {
                        "name": "__SELF__",
                        "rights": ["E"],
                        "compiler_owned_self": True,
                    },
                ],
            },
        })

    assert response.status_code == 422, response.get_data(as_text=True)
    body = response.get_json()
    assert body["capability_validation_failed"] is True
    assert body["clist_row"] == 1
    assert body["actual_word"] == 0xFEED5E1F
    assert not list(isolated_lumps.glob("*.lump"))


@pytest.mark.parametrize("sequence", [255, 256, 511])
def test_compiler_self_commit_contains_only_final_namespace_gt(
        isolated_lumps, monkeypatch, sequence):
    state = isolated_lumps / "ns-state.json"
    state.write_text(json.dumps({"abstractions": [{
        "name": "PriorEntry",
        "slot": 7,
        "seq": sequence,
    }]}))
    monkeypatch.setattr(app_module, "NS_STATE_PATH", str(state))
    words = _words(cw=1, cc=1, marker=0)
    words[-1] = 0xFEED5E1F
    metadata = {
        "token": "7c501082",
        "abstraction": "FinalCompilerSelf",
        "content_type": "code",
        "capabilities": [{
            "name": "__SELF__",
            "rights": ["E"],
            "compiler_owned_self": True,
        }],
        "ns_slot": 7,
    }
    with app_module.app.test_client() as client:
        planned = client.post("/api/lumps/save-plan", json={
            "binary": words, "metadata": metadata,
        })
        assert planned.status_code == 201, planned.get_data(as_text=True)
        plan = planned.get_json()
        issued = client.post("/api/lumps/approval-intent", json={
            "digest": plan["digest"],
            "action": plan["action"],
            "plan_id": plan["plan_id"],
            "confirmation": True,
            "approval": {},
        })
        assert issued.status_code == 201, issued.get_data(as_text=True)
        metadata = dict(
            metadata,
            save_plan_id=plan["plan_id"],
            approval_intent=issued.get_json()["intent"],
        )
        saved = client.post("/api/lumps/save", json={
            "binary": plan["final_binary"], "metadata": metadata,
        })

    assert saved.status_code == 200, saved.get_data(as_text=True)
    result = saved.get_json()
    assert result["final_binary"][-1] != 0xFEED5E1F
    expected = app_module._boot_image_gen.create_gt(
        sequence, 7, {"E": 1}, 1)
    assert result["final_binary"][-1] == expected
    assert (isolated_lumps / result["filename"]).read_bytes()[-4:] == (
        expected.to_bytes(4, "big")
    )


@pytest.mark.parametrize("dynamic_marker", ["new_entry", "policy"])
def test_new_entry_null_slot_is_allocated_before_self_plan_and_commit(
        isolated_lumps, monkeypatch, dynamic_marker):
    state = isolated_lumps / "ns-state.json"
    state.write_text(json.dumps({"abstractions": []}))
    monkeypatch.setattr(app_module, "NS_STATE_PATH", str(state))
    words = _words(cw=1, cc=1, marker=0)
    words[-1] = 0xFEED5E1F
    metadata = {
        "abstraction": "NewEntryCompilerSelf",
        "content_type": "code",
        "language": "assembly",
        "ns_slot": None,
        "ns_slot_policy": "dynamic",
        "capabilities": [{
            "name": "__SELF__",
            "rights": ["E"],
            "compiler_owned_self": True,
            "placeholder": True,
        }],
        "compiler_owned_self": True,
        "identity_contract": "dynamic-local",
        "grants": ["E"],
        "replacement": False,
    }
    if dynamic_marker == "new_entry":
        metadata["new_entry"] = True

    with app_module.app.test_client() as client:
        planned = client.post("/api/lumps/save-plan", json={
            "binary": words,
            "metadata": metadata,
        })
        assert planned.status_code == 201, planned.get_data(as_text=True)
        plan = planned.get_json()
        selected_slot = plan["ns_slot"]
        assert isinstance(selected_slot, int)
        assert plan["consequence"] == "create"
        issued = client.post("/api/lumps/approval-intent", json={
            "digest": plan["digest"],
            "action": plan["action"],
            "plan_id": plan["plan_id"],
            "confirmation": True,
            "approval": {},
        })
        assert issued.status_code == 201, issued.get_data(as_text=True)
        save_metadata = dict(
            metadata,
            save_plan_id=plan["plan_id"],
            approval_intent=issued.get_json()["intent"],
        )
        saved = client.post("/api/lumps/save", json={
            "binary": plan["final_binary"],
            "metadata": save_metadata,
        })

    assert saved.status_code == 200, saved.get_data(as_text=True)
    result = saved.get_json()
    assert result["ns_slot"] == selected_slot
    expected = app_module._boot_image_gen.create_gt(
        0, selected_slot, {"E": 1}, 1)
    assert result["final_binary"][-1] == expected
    saved_state = json.loads(state.read_text())
    destination = next(
        row for row in saved_state["abstractions"]
        if row.get("slot") == selected_slot
    )
    assert destination["name"] == "NewEntryCompilerSelf"


@pytest.mark.parametrize("slot", range(32))
def test_every_slot_accepts_programmer_selected_identity(
        isolated_lumps, slot):
    with app_module.app.test_client() as client:
        response = client.post("/api/lumps/save-plan", json={
            "binary": _words(marker=70 + slot),
            "metadata": {
                "token": f"aa00{slot:04x}",
                "abstraction": "LumpSaveTest",
                "content_type": "code",
                "language": "assembly",
                "ns_slot": slot,
                "capabilities": [],
                "methods": [],
                "grants": ["E"],
            },
        })
    assert response.status_code == 201, response.get_data(as_text=True)


def test_resident_namespace_failure_never_enters_commit_helper(
        isolated_lumps, monkeypatch):
    state = isolated_lumps / "ns-state.json"
    state.write_text(json.dumps({"abstractions": []}))
    monkeypatch.setattr(app_module, "NS_STATE_PATH", str(state))
    commit_entered = False

    def fail_binding(*_args, **_kwargs):
        raise ValueError("injected binding failure")

    def record_commit(**_kwargs):
        nonlocal commit_entered
        commit_entered = True
        raise AssertionError("commit helper must not run")

    words = _words(marker=103)
    with app_module.app.test_client() as client:
        payload = _approved_payload(
            client, words, token="7c501103", name="ResidentFailure")
        payload["metadata"]["ns_slot"] = 11
        monkeypatch.setattr(
            app_module, "_prepare_saved_lump_ns_state", fail_binding)
        monkeypatch.setattr(
            app_module, "_commit_lump_history_transition", record_commit)
        response = client.post("/api/lumps/save", json=payload)

    assert response.status_code == 422
    assert response.get_json()["namespace_identity_failed"] is True
    assert response.get_json()["failure_owner"] == "ide"
    assert response.get_json()["committed"] is False
    assert response.get_json()["safe_retry"] is True
    assert "injected binding failure" in response.get_json()["error"]
    assert commit_entered is False
    assert json.loads(state.read_text()) == {"abstractions": []}
    assert not list(isolated_lumps.glob("*.lump"))
