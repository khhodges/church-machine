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
    digest = hashlib.sha256(_raw(words)).hexdigest()
    issued = client.post("/api/lumps/approval-intent", json={
        "digest": digest, "action": "save", "confirmation": True,
        "approval": {"grants": ["E"], "capability_type": "inform"},
    })
    assert issued.status_code == 201
    return {
        "binary": words,
        "metadata": {
            "token": token, "abstraction": name, "content_type": "code",
            "language": "assembly", "ns_slot": None, "capabilities": [],
            "methods": [], "grants": ["E"],
            "approval_intent": issued.get_json()["intent"],
            "approval_action": "save",
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


def test_bad_binary_is_rejected_before_any_artifact_write(isolated_lumps):
    words = _words(cw=0, marker=1)
    words[0] = 0
    with app_module.app.test_client() as client:
        response = client.post("/api/lumps/save",
                               json=_approved_payload(client, words))
    assert response.status_code == 400
    assert not list(isolated_lumps.glob("*.lump"))