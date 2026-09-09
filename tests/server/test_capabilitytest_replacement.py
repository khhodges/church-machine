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
import server.boot_image as boot_image


def _words(marker):
    words = [(0x1F << 27) | (1 << 10) | 1, marker] + [0] * 62
    identity = hashlib.sha256(b"CapabilityTest#1").hexdigest()
    words[-1] = 0x0A000000 | (int(identity[:8], 16) & 0x1FFFFFF)
    return words


def _raw(marker):
    return struct.pack(">64I", *_words(marker))


@pytest.fixture
def repository(tmp_path, monkeypatch):
    old = _raw(1)
    digest = hashlib.sha256(old).hexdigest()
    (tmp_path / "old.lump").write_bytes(old)
    (tmp_path / "manifest.json").write_text(json.dumps([{
        "token": "00000a00", "abstraction": "CapabilityTest",
        "filename": "old.lump", "lump_version": 3,
    }]))
    (tmp_path / "approvals.json").write_text(json.dumps({
        "version": 1, "algorithm": "sha256",
        "approvals": {digest: {"binary_hash": digest,
                               "dot_name": "CapabilityTest", "issue_n": 0}},
    }))
    (tmp_path / ".history-transition.lock").write_bytes(b"")
    state = tmp_path / "ns-state.json"
    state.write_text(json.dumps({"abstractions": [{
        "name": "CapabilityTest", "slot": 10, "type": "Inform", "seq": 7,
        "resident": True, "filename": "old.lump", "token": "00000a00",
    }]}))
    boot = tmp_path / "boot-image.bin"
    boot.write_bytes(b"old boot")
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(tmp_path))
    monkeypatch.setattr(app_module, "_LUMPS_DIR", str(tmp_path))
    monkeypatch.setattr(app_module, "LUMPS_MANIFEST_PATH", str(tmp_path / "manifest.json"))
    monkeypatch.setattr(app_module, "NS_STATE_PATH", str(state))
    monkeypatch.setattr(app_module, "BOOT_IMAGE_PATH", str(boot))
    monkeypatch.setattr(
        app_module, "_read_saved_boot_config",
        lambda: ({"bootEntrySlot": 10}, None))
    monkeypatch.setattr(
        app_module, "_read_boot_entry_slot_from_image",
        lambda: (_ for _ in ()).throw(
            AssertionError("regeneration must not read the stale boot image")))
    monkeypatch.setattr(app_module._boot_image_gen, "generate_boot_image",
                        lambda *a, **k: b"new boot")
    monkeypatch.setattr(app_module, "_write_boot_image_bytes", boot.write_bytes)
    monkeypatch.setattr(app_module, "_load_boot_abstr_lump", lambda: None)
    monkeypatch.setattr(app_module, "_load_boot_ns_lump", lambda: None)
    return tmp_path, state, boot


def _payload(client):
    metadata = {
        "token": "00000a00", "abstraction": "CapabilityTest",
        "content_type": "code", "language": "assembly", "ns_slot": 10,
        "grants": ["E"], "capability_type": "inform",
        "namespace_sequence": 7, "replacement": True, "capabilities": [],
        "approval_action": "replace",
    }
    plan_response = client.post("/api/lumps/save-plan", json={
        "binary": _words(2), "metadata": metadata,
    })
    assert plan_response.status_code == 201, plan_response.get_data(as_text=True)
    plan = plan_response.get_json()
    intent = client.post("/api/lumps/approval-intent", json={
        "digest": plan["digest"], "action": "replace", "plan": plan["plan"],
        "confirmation": True,
        "approval": {"grants": ["E"], "capability_type": "inform"},
    }).get_json()["intent"]
    metadata.update({"approval_intent": intent, "save_plan": plan["plan"]})
    return {"binary": _words(2), "metadata": metadata}


def test_replacement_updates_binary_approval_namespace_and_boot(repository):
    root, state_path, boot = repository
    with app_module.app.test_client() as client:
        response = client.post("/api/lumps/save", json=_payload(client))
    assert response.status_code == 200, response.get_data(as_text=True)
    result = response.get_json()
    saved = (root / result["lump"]).read_bytes()
    digest = hashlib.sha256(saved).hexdigest()
    assert json.loads((root / "approvals.json").read_text())["approvals"][digest]["binary_hash"] == digest
    assert json.loads(state_path.read_text())["abstractions"][0]["filename"] == result["lump"]
    assert json.loads(state_path.read_text())["abstractions"][0]["lump_version"] == result["lump_version"]
    assert boot.read_bytes() == b"new boot"
    assert not list(root.glob("*.json")) or all(
        p.name in {"manifest.json", "approvals.json", "ns-state.json"}
        for p in root.glob("*.json"))


def test_boot_failure_keeps_approved_capabilitytest_save_and_old_boot(
        repository, monkeypatch):
    root, _state, boot = repository
    before = {p.name: p.read_bytes() for p in root.iterdir()}
    monkeypatch.setattr(app_module._boot_image_gen, "generate_boot_image",
                        lambda *a, **k: (_ for _ in ()).throw(OSError("boot failure")))
    with app_module.app.test_client() as client:
        response = client.post("/api/lumps/save", json=_payload(client))
    assert response.status_code == 200, response.get_data(as_text=True)
    result = response.get_json()
    assert result["boot_image_refreshed"] is False
    assert "saved but not yet installed in the hardware image" in result["boot_image_note"]
    assert "boot failure" in result["boot_image_note"]
    assert boot.read_bytes() == before["boot-image.bin"]
    assert (root / result["lump"]).read_bytes() == _raw(2)
    current = json.loads((root / "manifest.json").read_text())
    assert next(entry for entry in current
                if entry["token"] == "00000a00")["filename"] == result["lump"]


def test_old_eloadcall_halt_image_rejected_after_two_eloadcall_branch_save(
        repository, monkeypatch):
    root, state_path, _boot = repository
    total, location, slot = 256, 64, 10
    old_words = _words((8 << 27) | (6 << 15))
    old_words[0] = (old_words[0] & ~(0x1FFF << 10)) | (2 << 10)
    old_words[2] = 31 << 27
    image_words = [0] * total
    image_words[location:location + len(old_words)] = old_words
    boot_image.write_ns_entry(
        image_words, total, boot_image.NS_ENTRY_WORDS, slot, location,
        len(old_words) - 2, 0, 0, 1, 7, 1, int("00000a00", 16))
    previous_image = struct.pack(f"<{total}I", *image_words)

    new_words = _words((8 << 27) | (6 << 15))
    new_words[0] = (new_words[0] & ~(0x1FFF << 10)) | (3 << 10)
    new_words[2] = (8 << 27) | (6 << 15) | 1
    new_words[3] = (23 << 27) | 1
    new_raw = struct.pack(">64I", *new_words)
    (root / "new.lump").write_bytes(new_raw)
    state = json.loads(state_path.read_text())
    state["abstractions"][0]["filename"] = "new.lump"
    state_path.write_text(json.dumps(state))
    monkeypatch.setattr(boot_image, "validate_boot_image", lambda _image: None)

    with pytest.raises(ValueError, match="currently selected artifact"):
        boot_image.validate_resident_artifact_bindings(previous_image, str(root))