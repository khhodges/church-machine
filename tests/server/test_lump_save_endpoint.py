import hashlib
import json
import struct
import sys
import types

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


@pytest.fixture
def isolated_lumps(tmp_path, monkeypatch):
    (tmp_path / "manifest.json").write_text("[]")
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(tmp_path))
    monkeypatch.setattr(app_module, "_LUMPS_DIR", str(tmp_path))
    monkeypatch.setattr(app_module, "LUMPS_MANIFEST_PATH", str(tmp_path / "manifest.json"))
    monkeypatch.setattr(app_module, "BOOT_IMAGE_PATH", str(tmp_path / "absent-boot.bin"))
    return tmp_path


def _approved_payload(client, words, token="7c501001", name="LumpSaveTest"):
    identity = hashlib.sha256(f"{name}#1".encode()).hexdigest()
    words[-1] = 0x0A000000 | (int(identity[:8], 16) & 0x1FFFFFF)
    candidate = {
        "binary": words,
        "metadata": {
            "token": token, "abstraction": name, "content_type": "code",
            "language": "assembly", "ns_slot": None, "capabilities": [],
            "methods": [], "grants": ["E"],
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