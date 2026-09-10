"""Focused regression coverage for Task #3321 bootstrap T == GT."""
import json
from pathlib import Path
import shutil
import struct

import pytest

from server import app as app_module
from server.bootstrap_identity import (
    bootstrap_identity_record,
    bootstrap_t_from_self_gt,
    validate_bootstrap_candidate,
    verify_bootstrap_self_gt,
)
from server.lump_approvals import read_approvals
from server.lump_integrity import resolve_canonical_lump, canonical_binding_headers
from server.boot_image import generate_boot_image


_RESIDENT = {
    "resident": True, "boot_resident": True, "type": "Inform",
    "load_policy": "Resident", "ns_slot_policy": "static",
    "slot": 0xBEEF, "seq": 1, "token": "4a01beef",
}


def test_bootstrap_t_serializes_the_complete_unsigned_self_gt():
    gt = 0x4A01BEEF
    record = bootstrap_identity_record(_RESIDENT, gt)
    assert record == {"bootstrap_t": "4a01beef", "bootstrap_runtime_gt": gt}
    assert verify_bootstrap_self_gt(_RESIDENT, gt, record["bootstrap_t"]) == "4a01beef"


def test_bootstrap_self_mismatch_reports_values_and_recovery_action():
    with pytest.raises(ValueError) as raised:
        verify_bootstrap_self_gt(_RESIDENT, 0x4A000006, "4a000006")
    message = str(raised.value)
    assert "actual 0x4a000006" in message
    assert "expected 0x4a01beef" in message
    assert "SELF GT differs" in message


def _candidate(row0, cc=1):
    words = [(0x1F << 27) | (1 << 10) | cc, 0] + [0] * 62
    words[-cc] = row0
    return __import__("struct").pack(">64I", *words)


def test_candidate_validation_uses_sealed_row_zero_as_ultimate_truth():
    raw = _candidate(0x4A01BEEF)
    digest = __import__("hashlib").sha256(raw).hexdigest()
    metadata = bootstrap_identity_record(_RESIDENT, 0x4A01BEEF)
    assert validate_bootstrap_candidate(
        _RESIDENT, raw, "4a01beef", digest, metadata)["binary_hash"] == digest

    with pytest.raises(ValueError, match="actual 0x4a000006"):
        validate_bootstrap_candidate(
            _RESIDENT, _candidate(0x4A000006), "4a01beef",
            __import__("hashlib").sha256(_candidate(0x4A000006)).hexdigest(),
            metadata)


@pytest.mark.parametrize("field,value,match", [
    ("canonical_token", "4a00beef", "serialized T"),
    ("approval_digest", "0" * 64, "approval digest"),
    ("bootstrap_runtime_gt", 0x4A000006, "metadata GT"),
    ("bootstrap_t", "4a000006", "metadata token"),
])
def test_candidate_validation_rejects_subordinate_identity_disagreement(
        field, value, match):
    raw = _candidate(0x4A01BEEF)
    digest = __import__("hashlib").sha256(raw).hexdigest()
    metadata = bootstrap_identity_record(_RESIDENT, 0x4A01BEEF)
    token = "4a01beef"
    if field == "canonical_token":
        token = value
    elif field == "approval_digest":
        digest = value
    else:
        metadata[field] = value
    with pytest.raises(ValueError, match=match):
        validate_bootstrap_candidate(_RESIDENT, raw, token, digest, metadata)


@pytest.mark.parametrize("binding", [
    {"resident": False, "boot_resident": True, "type": "Inform"},
    {"resident": True, "boot_resident": False, "type": "Inform"},
    {"resident": True, "boot_resident": True, "type": "Outform"},
    {"resident": True, "boot_resident": True, "type": "Inform", "load_policy": "Lazy"},
])
def test_bootstrap_helper_fails_closed_outside_frozen_resident(binding):
    with pytest.raises(ValueError):
        bootstrap_t_from_self_gt(binding, 0x4A000006)


def test_every_frozen_resident_manifest_approval_row0_and_boot_w3_share_t():
    root = Path(__file__).resolve().parents[2]
    lumps = root / "server" / "lumps"
    state = json.loads((lumps / "ns-state.json").read_text())
    image = (lumps / "boot-image.bin").read_bytes()
    words = __import__("struct").unpack(f"<{len(image) // 4}I", image)
    approvals = read_approvals(str(lumps / "approvals.json"))
    expected = {"SelfTest": 0x4A000006, "WukongCallHome": 0x4A000007,
                "CapabilityTest": 0x4A00000A}
    residents = [row for row in state["abstractions"]
                 if row.get("resident") is True and row.get("boot_resident") is True]
    assert {row["name"] for row in residents} == set(expected)
    for binding in residents:
        raw = (lumps / binding["filename"]).read_bytes()
        header = int.from_bytes(raw[:4], "big")
        allocation, cc = 1 << (((header >> 23) & 0xF) + 6), header & 0xFF
        row0 = int.from_bytes(raw[(allocation - cc) * 4:(allocation - cc + 1) * 4], "big")
        approval = approvals[__import__("hashlib").sha256(raw).hexdigest()]
        assert row0 == expected[binding["name"]]
        assert binding["token"] == f"{row0:08x}"
        assert binding["ns_slot_policy"] == "static"
        assert binding["load_policy"] == "Resident"
        assert approval["bootstrap_t"] == f"{row0:08x}"
        assert approval["bootstrap_runtime_gt"] == row0
        assert "identity_hash" not in approval
        assert words[len(words) - (binding["slot"] + 1) * 4 + 3] == row0


def test_programmer_can_plan_slot7_replacement_with_content_token_hint():
    """A content token must not turn a programmer-owned slot into a protected slot."""
    words = [(0x1F << 27) | (1 << 10) | 1, 0] + [0] * 62
    words[-1] = 0x4A000007
    capabilities = [{
        "name": "__SELF__", "rights": ["E"], "compiler_owned_self": True,
    }]

    with app_module.app.test_client() as client:
        response = client.post("/api/lumps/save-plan", json={
            "binary": words,
            "metadata": {
                "abstraction": "WukongCallHome",
                "ns_slot": 7,
                # The browser computes this from content. The verified SELF row,
                # not this lookup hint, owns resident identity.
                "token": "deadbeef",
                "content_type": "code",
                "capabilities": capabilities,
                "grants": ["E"],
            },
        })

    assert response.status_code == 201, response.get_data(as_text=True)
    assert response.get_json()["consequence"] in {"create", "replace"}


def test_programmer_can_replace_frozen_slot10_with_compiler_owned_lump():
    """The selected slot binds SELF; the old resident name does not own it."""
    words = [(0x1F << 27) | (1 << 10) | 1, 0] + [0] * 62
    words[-1] = 0xFEED5E1F
    with app_module.app.test_client() as client:
        response = client.post("/api/lumps/save-plan", json={
            "binary": words,
            "metadata": {
                "abstraction": "ProgrammerChoice",
                "ns_slot": 10,
                "token": "deadbeef",
                "content_type": "code",
                "capabilities": [{
                    "name": "__SELF__",
                    "rights": ["E"],
                    "compiler_owned_self": True,
                }],
                "grants": ["E"],
            },
        })

    assert response.status_code == 201, response.get_data(as_text=True)
    result = response.get_json()
    assert result["consequence"] in {"create", "replace"}
    canonical_words = list(words)
    canonical_words[-1] = 0x4A00000A
    canonical_bytes = __import__("struct").pack(">64I", *canonical_words)
    assert result["digest"] == __import__("hashlib").sha256(
        canonical_bytes).hexdigest()


def test_stale_browser_self_is_rebound_to_programmer_selected_slot():
    """A serialized browser GT cannot override a compiler-owned SELF row."""
    words = [(0x1F << 27) | (1 << 10) | 1, 0] + [0] * 62
    words[-1] = 0x4A000006
    with app_module.app.test_client() as client:
        response = client.post("/api/lumps/save-plan", json={
            "binary": words,
            "metadata": {
                "abstraction": "ProgrammerChoice",
                "ns_slot": 10,
                "token": "deadbeef",
                "content_type": "code",
                # Older browser snapshots omitted compiler_owned_self while
                # retaining the reserved __SELF__ row name.
                "capabilities": [{"name": "__SELF__", "rights": ["E"]}],
                "grants": ["E"],
            },
        })

    assert response.status_code == 201, response.get_data(as_text=True)
    canonical_words = list(words)
    canonical_words[-1] = 0x4A00000A
    canonical_bytes = __import__("struct").pack(">64I", *canonical_words)
    assert response.get_json()["digest"] == __import__("hashlib").sha256(
        canonical_bytes).hexdigest()


@pytest.mark.parametrize("mutation", ["slot", "seq", "token"])
def test_resolver_and_boot_reject_descriptor_or_token_mutation(tmp_path, mutation):
    root = Path(__file__).resolve().parents[2]
    source = root / "server" / "lumps"
    lumps = tmp_path / "lumps"
    shutil.copytree(source, lumps, symlinks=True)
    state = json.loads((lumps / "ns-state.json").read_text())
    row = next(r for r in state["abstractions"] if r.get("name") == "CapabilityTest")
    raw = (lumps / row["filename"]).read_bytes()
    request_token = row["token"]
    if mutation == "slot":
        row["slot"] = 11
    elif mutation == "seq":
        row["seq"] = 1
    else:
        row["token"] = "4a00000b"
    (lumps / "ns-state.json").write_text(json.dumps(state))
    resolution = resolve_canonical_lump(str(lumps), request_token, raw)
    assert not resolution["trusted"]
    assert "X-Lump-Identity-Hash" not in canonical_binding_headers(resolution)
    with pytest.raises(ValueError):
        generate_boot_image({"step1": {"totalNamespaceWords": 16384,
                                      "namespaceLumpWords": 1024,
                                      "threadLumpWords": 256}},
                            str(lumps))


def test_boot_rejects_identity_hash_downgrade_of_frozen_approval(tmp_path):
    root = Path(__file__).resolve().parents[2]
    lumps = tmp_path / "lumps"
    shutil.copytree(root / "server" / "lumps", lumps, symlinks=True)
    state = json.loads((lumps / "ns-state.json").read_text())
    row = next(r for r in state["abstractions"] if r.get("name") == "WukongCallHome")
    raw = (lumps / row["filename"]).read_bytes()
    digest = __import__("hashlib").sha256(raw).hexdigest()
    envelope = json.loads((lumps / "approvals.json").read_text())
    approval = envelope["approvals"][digest]
    approval.pop("bootstrap_t")
    approval.pop("bootstrap_runtime_gt")
    approval["identity_hash"] = __import__("hashlib").sha256(
        b"WukongCallHome#1").hexdigest()
    (lumps / "approvals.json").write_text(json.dumps(envelope))
    with pytest.raises(ValueError, match="requires bootstrap_t"):
        generate_boot_image({"step1": {"totalNamespaceWords": 16384,
                                      "namespaceLumpWords": 1024,
                                      "threadLumpWords": 256}}, str(lumps))


def _repository_snapshot(root):
    return {
        str(path.relative_to(root)): (
            "link", path.readlink()
        ) if path.is_symlink() else (
            "file", path.read_bytes()
        )
        for path in root.rglob("*")
        if path.is_file() or path.is_symlink()
    }


@pytest.fixture
def isolated_bootstrap_repository(tmp_path, monkeypatch):
    root = Path(__file__).resolve().parents[2]
    lumps = tmp_path / "lumps"
    shutil.copytree(root / "server" / "lumps", lumps, symlinks=True)
    state_path = lumps / "ns-state.json"
    state = json.loads(state_path.read_text())
    capability_test = next(
        row for row in state["abstractions"]
        if row.get("name") == "CapabilityTest")
    capability_test["token"] = "4a00000a"
    state_path.write_text(json.dumps(state))
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(lumps))
    monkeypatch.setattr(app_module, "_LUMPS_DIR", str(lumps))
    monkeypatch.setattr(app_module, "LUMPS_MANIFEST_PATH", str(lumps / "manifest.json"))
    monkeypatch.setattr(app_module, "NS_STATE_PATH", str(lumps / "ns-state.json"))
    monkeypatch.setattr(app_module, "BOOT_IMAGE_PATH", str(lumps / "boot-image.bin"))
    return lumps


def _bootstrap_save_payload(client, *, sequence=0):
    words = [(0x1F << 27) | (1 << 10) | 1, 0] + [0] * 62
    words[-1] = 0x4A000006  # stale browser SELF from the former slot 6
    metadata = {
        "abstraction": "CapabilityTest",
        "ns_slot": 10,
        "namespace_sequence": sequence,
        "token": "4a00000a",
        "content_type": "code",
        "capabilities": [{
            "name": "__SELF__", "rights": ["E"], "compiler_owned_self": True,
        }],
        "grants": ["E"],
        "enforce_bootstrap_identity": True,
    }
    plan_response = client.post(
        "/api/lumps/save-plan", json={"binary": words, "metadata": metadata})
    assert plan_response.status_code == 201, plan_response.get_data(as_text=True)
    plan = plan_response.get_json()
    canonical = list(words)
    canonical[-1] = 0x4A00000A
    assert plan["digest"] == __import__("hashlib").sha256(
        struct.pack(">64I", *canonical)).hexdigest()
    intent_response = client.post("/api/lumps/approval-intent", json={
        "digest": plan["digest"], "action": plan["action"],
        "plan_id": plan["plan_id"], "confirmation": True,
        "approval": {"grants": ["E"], "capability_type": "inform"},
    })
    assert intent_response.status_code == 201
    metadata.update({
        "save_plan_id": plan["plan_id"],
        "approval_intent": intent_response.get_json()["intent"],
    })
    return {"binary": words, "metadata": metadata}


def test_final_bootstrap_gate_rejects_before_any_repository_mutation(
        isolated_bootstrap_repository, monkeypatch):
    original = app_module._validate_bootstrap_candidate
    calls = {"count": 0}

    def injected_failure(*args, **kwargs):
        calls["count"] += 1
        if calls["count"] == 3:
            raise ValueError("injected final validation failure")
        return original(*args, **kwargs)

    with app_module.app.test_client() as client:
        payload = _bootstrap_save_payload(client)
        before = _repository_snapshot(isolated_bootstrap_repository)
        monkeypatch.setattr(
            app_module, "_validate_bootstrap_candidate", injected_failure)
        response = client.post("/api/lumps/save", json=payload)

    assert response.status_code == 422
    assert "IDE refused" in response.get_json()["error"]
    assert "before changing any data" in response.get_json()["error"]
    assert _repository_snapshot(isolated_bootstrap_repository) == before


def test_valid_slot10_bootstrap_save_commits_exact_sealed_self(
        isolated_bootstrap_repository):
    with app_module.app.test_client() as client:
        payload = _bootstrap_save_payload(client)
        response = client.post("/api/lumps/save", json=payload)
    assert response.status_code == 200, response.get_data(as_text=True)
    saved = (
        isolated_bootstrap_repository / response.get_json()["lump"]
    ).read_bytes()
    header = int.from_bytes(saved[:4], "big")
    allocation = 1 << (((header >> 23) & 0xF) + 6)
    cc = header & 0xFF
    row0 = int.from_bytes(
        saved[(allocation - cc) * 4:(allocation - cc + 1) * 4], "big")
    digest = __import__("hashlib").sha256(saved).hexdigest()
    approvals = read_approvals(
        str(isolated_bootstrap_repository / "approvals.json"))
    assert row0 == 0x4A00000A
    assert response.get_json()["token"] == "4a00000a"
    assert approvals[digest]["binary_hash"] == digest
    assert approvals[digest]["bootstrap_runtime_gt"] == row0
    assert approvals[digest]["bootstrap_t"] == "4a00000a"


def test_bootstrap_sequence_mismatch_is_rejected_without_mutation(
        isolated_bootstrap_repository):
    before = _repository_snapshot(isolated_bootstrap_repository)
    words = [(0x1F << 27) | (1 << 10) | 1, 0] + [0] * 62
    words[-1] = 0x4A000006
    with app_module.app.test_client() as client:
        response = client.post("/api/lumps/save-plan", json={
            "binary": words,
            "metadata": {
                "abstraction": "CapabilityTest", "ns_slot": 10,
                "namespace_sequence": 1, "token": "4a00000a",
                "content_type": "code", "enforce_bootstrap_identity": True,
                "capabilities": [{"name": "__SELF__", "rights": ["E"]}],
                "grants": ["E"],
            },
        })
    assert response.status_code == 422
    assert "IDE refused" in response.get_json()["error"]
    assert _repository_snapshot(isolated_bootstrap_repository) == before


def test_bootstrap_token_mismatch_is_rejected_without_mutation(
        isolated_bootstrap_repository):
    before = _repository_snapshot(isolated_bootstrap_repository)
    words = [(0x1F << 27) | (1 << 10) | 1, 0] + [0] * 62
    words[-1] = 0x4A000006
    with app_module.app.test_client() as client:
        response = client.post("/api/lumps/save-plan", json={
            "binary": words,
            "metadata": {
                "abstraction": "CapabilityTest", "ns_slot": 10,
                "namespace_sequence": 0, "token": "4a000006",
                "content_type": "code", "enforce_bootstrap_identity": True,
                "capabilities": [{"name": "__SELF__", "rights": ["E"]}],
                "grants": ["E"],
            },
        })
    assert response.status_code == 422
    assert "canonical token differs" in response.get_json()["error"]
    assert _repository_snapshot(isolated_bootstrap_repository) == before


def test_bootstrap_namespace_bind_failure_never_enters_commit(
        isolated_bootstrap_repository, monkeypatch):
    with app_module.app.test_client() as client:
        payload = _bootstrap_save_payload(client)
        before = _repository_snapshot(isolated_bootstrap_repository)
        commit_called = {"value": False}

        def fail_prepare(*_args, **_kwargs):
            raise ValueError("injected Namespace bind validation failure")

        def observe_commit(*_args, **_kwargs):
            commit_called["value"] = True
            raise AssertionError("commit must not run")

        monkeypatch.setattr(
            app_module, "_prepare_saved_lump_ns_state", fail_prepare)
        monkeypatch.setattr(
            app_module, "_commit_lump_history_transition", observe_commit)
        response = client.post("/api/lumps/save", json=payload)

    assert response.status_code == 422
    assert "Namespace binding is invalid" in response.get_json()["error"]
    assert commit_called["value"] is False
    assert _repository_snapshot(isolated_bootstrap_repository) == before


def test_namespace_change_before_final_lock_preserves_repository_and_authorization(
        isolated_bootstrap_repository):
    with app_module.app.test_client() as client:
        payload = _bootstrap_save_payload(client)
        state_path = isolated_bootstrap_repository / "ns-state.json"
        state = json.loads(state_path.read_text())
        row = next(item for item in state["abstractions"]
                   if item.get("slot") == 10)
        row["seq"] = 1
        row["token"] = "4a01000a"
        state_path.write_text(json.dumps(state))
        before = _repository_snapshot(isolated_bootstrap_repository)
        plan_id = payload["metadata"]["save_plan_id"]
        intent_id = payload["metadata"]["approval_intent"]

        response = client.post("/api/lumps/save", json=payload)

        assert plan_id in app_module._LUMP_SAVE_PLANS
        assert intent_id in app_module._LUMP_APPROVAL_INTENTS

    assert response.status_code == 422
    assert "IDE refused" in response.get_json()["error"]
    assert _repository_snapshot(isolated_bootstrap_repository) == before


def test_selftest_source_identity_change_between_reads_is_rejected(
        isolated_bootstrap_repository, monkeypatch):
    state_path = isolated_bootstrap_repository / "ns-state.json"
    state = json.loads(state_path.read_text())
    selftest = next(row for row in state["abstractions"]
                    if row.get("name") == "SelfTest")
    selftest["token"] = "4a000006"
    state_path.write_text(json.dumps(state))
    words = [(0x1F << 27) | (1 << 10) | 2, 0] + [0] * 62
    words[-2] = 0x4A000006
    words[-1] = 0x4A00000A
    metadata = {
        "abstraction": "SelfTest", "ns_slot": 6,
        "token": "4a000006", "content_type": "code",
        "enforce_bootstrap_identity": True,
        "capabilities": [
            {"name": "__SELF__", "rights": ["E"]},
            {"name": "Next", "rights": ["E"], "nsIndex": 10},
        ],
        "grants": ["E"],
    }
    changed = {"done": False}

    def mutate_between_reads():
        if changed["done"]:
            return
        changed["done"] = True
        current = json.loads(state_path.read_text())
        row = next(item for item in current["abstractions"]
                   if item.get("name") == "SelfTest")
        row["slot"] = 11
        row["token"] = "4a00000b"
        state_path.write_text(json.dumps(current))

    monkeypatch.setattr(app_module, "_bootstrap_pre_lock_hook", mutate_between_reads)
    with app_module.app.test_client() as client:
        before = _repository_snapshot(isolated_bootstrap_repository)
        response = client.post(
            "/api/lumps/save-plan", json={"binary": words, "metadata": metadata})

    assert response.status_code == 409, response.get_data(as_text=True)
    assert "SelfTest Namespace slot changed" in response.get_json()["error"]
    after = _repository_snapshot(isolated_bootstrap_repository)
    # The hook's simulated concurrent Namespace commit is the only change.
    assert set(after) == set(before)
    for name in after:
        if name != "ns-state.json":
            assert after[name] == before[name]
