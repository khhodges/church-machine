"""Focused regression coverage for Task #3321 bootstrap T == GT."""
import atexit
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

import pytest


_ROOT = Path(__file__).resolve().parents[2]


def _tracked_boot_artifact_snapshot():
    tracked = subprocess.run(
        ["git", "ls-files", "server/boot-config.json", "server/lumps/boot-image*",
         "server/lumps/ns-state.json", "server/lumps/manifest.json",
         "server/lumps/approvals.json"],
        cwd=_ROOT, check=True, capture_output=True, text=True,
    ).stdout.splitlines()
    return {
        name: hashlib.sha256((_ROOT / name).read_bytes()).hexdigest()
        for name in tracked
    }


_TRACKED_BOOT_ARTIFACTS_BEFORE = _tracked_boot_artifact_snapshot()
_BOOTSTRAP_TEST_ROOT = None


def _select_fixture_boot_marker(lumps: Path, *, slot: int) -> None:
    """Make the test fixture's Lightning Bolt choice explicit and durable."""
    state_path = lumps / "ns-state.json"
    state = json.loads(state_path.read_text(encoding="utf-8"))
    rows = state.get("abstractions")
    assert isinstance(rows, list)
    selected = [
        row for row in rows
        if isinstance(row, dict) and row.get("slot") == slot
    ]
    assert len(selected) == 1
    state["revision"] = int(state.get("revision", 0))
    for row in rows:
        if isinstance(row, dict):
            row.pop("boot", None)
    selected[0]["boot"] = True
    state_path.write_text(json.dumps(state, indent=2), encoding="utf-8")


if not os.environ.get("CHURCH_TEST_LUMPS_DIR"):
    _BOOTSTRAP_TEST_ROOT = Path(tempfile.mkdtemp(prefix="bootstrap-identity-"))
    isolated_lumps = _BOOTSTRAP_TEST_ROOT / "lumps"
    shutil.copytree(_ROOT / "server" / "lumps", isolated_lumps, symlinks=True)
    _select_fixture_boot_marker(isolated_lumps, slot=10)
    isolated_config = _BOOTSTRAP_TEST_ROOT / "boot-config.json"
    shutil.copy2(_ROOT / "server" / "boot-config.json", isolated_config)
    os.environ["CHURCH_TEST_LUMPS_DIR"] = str(isolated_lumps)
    os.environ["CHURCH_TEST_BOOT_CONFIG_PATH"] = str(isolated_config)
    atexit.register(shutil.rmtree, _BOOTSTRAP_TEST_ROOT, ignore_errors=True)

from server import app as app_module
from server.bootstrap_identity import (
    bootstrap_identity_record,
    bootstrap_t_from_self_gt,
    publication_uses_bootstrap_authority,
    validate_bootstrap_candidate,
    verify_bootstrap_self_gt,
)
from server.lump_approvals import read_approvals
from server.lump_integrity import resolve_canonical_lump, canonical_binding_headers
from server.boot_image import generate_boot_image


@pytest.fixture(scope="module", autouse=True)
def bootstrap_suite_preserves_tracked_boot_artifacts():
    assert Path(app_module.LUMPS_DIR) != _ROOT / "server" / "lumps"
    assert Path(app_module.BOOT_IMAGE_PATH).parent == Path(app_module.LUMPS_DIR)
    assert Path(app_module.BOOT_IMAGE_PROVENANCE_PATH).parent == Path(app_module.LUMPS_DIR)
    assert Path(app_module.BOOT_CONFIG_PATH) != _ROOT / "server" / "boot-config.json"
    yield
    assert _tracked_boot_artifact_snapshot() == _TRACKED_BOOT_ARTIFACTS_BEFORE


@pytest.fixture(autouse=True)
def bootstrap_suite_isolates_save_authorization_state():
    with app_module._LUMP_SAVE_PLANS_LOCK:
        stale_plans = list(app_module._LUMP_SAVE_PLANS.values())
        app_module._LUMP_SAVE_PLANS.clear()
    for plan in stale_plans:
        app_module._lump_lease_for_plan(plan)
    with app_module._LUMP_APPROVAL_INTENTS_LOCK:
        app_module._LUMP_APPROVAL_INTENTS.clear()
    yield
    with app_module._LUMP_SAVE_PLANS_LOCK:
        created_plans = list(app_module._LUMP_SAVE_PLANS.values())
        app_module._LUMP_SAVE_PLANS.clear()
    for plan in created_plans:
        app_module._lump_lease_for_plan(plan)
    with app_module._LUMP_APPROVAL_INTENTS_LOCK:
        app_module._LUMP_APPROVAL_INTENTS.clear()


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
    lumps = Path(app_module.LUMPS_DIR)
    state = json.loads((lumps / "ns-state.json").read_text())
    image = generate_boot_image({
        "step1": {
            "totalNamespaceWords": 16384,
            "namespaceLumpWords": 64,
            "threadLumpWords": 256,
        },
    }, str(lumps))
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


def test_archived_capabilitytest_hash_token_is_classified_legacy_incompatible():
    lumps = Path(app_module.LUMPS_DIR)
    manifest = json.loads((lumps / "manifest.json").read_text())
    archived = next(
        row for row in manifest
            if row.get("token") == "7ccff26f"
        and row.get("abstraction") == "CapabilityTest")
    inspected = app_module._inspect_lump_binary(lumps / archived["filename"])

    identity = app_module._bootstrap_snapshot_identity(
        str(lumps), archived, inspected)

    assert identity == {
        "applies": True,
        "valid": False,
        "archived": True,
        "record_token": "7ccff26f",
        "row0_gt": "4a00000a",
        "expected_gt": "4a00000a",
        "active_namespace_gt": "4a00000a",
        "slot": 10,
        "sequence": 0,
        "errors": [
            "record Token 0x7ccff26f != expected GT 0x4a00000a",
            "record Token 0x7ccff26f != sealed row-zero GT 0x4a00000a",
        ],
        "data_changed": False,
    }


def test_current_capabilitytest_snapshot_proves_t_equals_row0_equals_destination():
    lumps = Path(app_module.LUMPS_DIR)
    manifest = json.loads((lumps / "manifest.json").read_text())
    current = next(
        row for row in manifest
        if row.get("token") == "4a00000a"
        and row.get("abstraction") == "CapabilityTest"
        and not row.get("archived"))
    inspected = app_module._inspect_lump_binary(lumps / current["filename"])

    identity = app_module._bootstrap_snapshot_identity(
        str(lumps), current, inspected)

    assert identity["valid"] is True
    assert identity["record_token"] == "4a00000a"
    assert identity["row0_gt"] == "4a00000a"
    assert identity["expected_gt"] == "4a00000a"
    assert identity["errors"] == []


def test_archived_bootstrap_snapshot_cannot_enable_history_restore():
    lumps = Path(app_module.LUMPS_DIR)
    manifest = json.loads((lumps / "manifest.json").read_text())
    archived = next(
        row for row in manifest
        if row.get("token") == "7ccff26f")
    snapshot = app_module._validate_lump_snapshot(
        lumps / archived["filename"], archived)

    assert snapshot["valid"] is False
    assert snapshot["bootstrap_identity"]["valid"] is False
    assert any("bootstrap T-equals-GT validation failed" in error
               for error in snapshot["errors"])
    assert any("no data was changed" in error for error in snapshot["errors"])


@pytest.mark.parametrize("state_mode", ["missing", "malformed", "duplicate"])
def test_bootstrap_history_fails_closed_when_binding_is_unavailable(
        tmp_path, monkeypatch, state_mode):
    source_lump = (
        Path(app_module.LUMPS_DIR) / "CapabilityTest.1.83320494.lump")
    current_name = "CapabilityTest.1.83320494.lump"
    archive_name = "CapabilityTest.1.83320494_v1.lump"
    binary = source_lump.read_bytes()
    (tmp_path / current_name).write_bytes(binary)
    (tmp_path / archive_name).write_bytes(binary)
    archived_manifest_entry = {
        "token": "7ccff26f",
        "abstraction": "CapabilityTest",
        "filename": archive_name,
        "lump_version": 1,
        "archived": True,
    }
    active_manifest_entry = {
        "token": "7ccff26f",
        "abstraction": "CapabilityTest",
        "filename": current_name,
        "lump_version": 2,
    }
    (tmp_path / "manifest.json").write_text(
        json.dumps([archived_manifest_entry, active_manifest_entry]),
        encoding="utf-8")
    if state_mode == "malformed":
        (tmp_path / "ns-state.json").write_text("{", encoding="utf-8")
    elif state_mode == "duplicate":
        binding = {
            "name": "CapabilityTest",
            "slot": 2,
            "seq": 0,
            "resident": True,
            "boot_resident": True,
            "type": "Inform",
            "load_policy": "Resident",
            "ns_slot_policy": "static",
        }
        (tmp_path / "ns-state.json").write_text(
            json.dumps({"abstractions": [binding, dict(binding)]}),
            encoding="utf-8")

    monkeypatch.setattr(app_module, "LUMPS_DIR", str(tmp_path))
    with app_module.app.test_client() as client:
        response = client.get("/api/lumps/7ccff26f/history")

    assert response.status_code == 200
    history = response.get_json()["history"]
    archived = next(row for row in history if row["version"] == 1)
    assert archived["binary_valid"] is False
    # The immutable bytes remain safe to inspect even when the historical
    # bootstrap binding cannot be audited. Identity failure must only make
    # the record read-only; it must not hide the archive from Preview.
    assert archived["preview_enabled"] is True
    assert archived["restore_enabled"] is False
    assert archived["bootstrap_identity"]["valid"] is False
    assert "authoritative bootstrap identity audit is unavailable" in (
        archived["validation_errors"][0])


def test_lump_list_hides_archived_bootstrap_but_words_expose_identity_comparison():
    with app_module.app.test_client() as client:
        listed_response = client.get("/api/lumps/list")
        words_response = client.get(
            "/api/lump/7ccff26f/words"
            "?archive_filename=CapabilityTest.1.83320494.lump")

    assert listed_response.status_code == 200
    assert not any(
        row.get("token") == "7ccff26f"
        for row in listed_response.get_json())

    assert words_response.status_code == 200
    words_identity = words_response.get_json()["bootstrap_identity"]
    assert words_identity["valid"] is False
    assert words_identity["data_changed"] is False


@pytest.mark.parametrize(
    ("token", "abstraction"),
    [
        ("4a000006", "SelfTest"),
        ("4a000007", "WukongCallHome"),
        ("4a00000a", "CapabilityTest"),
    ],
)
def test_active_bootstrap_history_groups_all_legacy_manifest_records_read_only(
        token, abstraction):
    manifest = json.loads(
        (Path(app_module.LUMPS_DIR) / "manifest.json").read_text())
    archived_rows = [
        row for row in manifest
        if row.get("abstraction") == abstraction and row.get("archived") is True
    ]

    with app_module.app.test_client() as client:
        response = client.get(f"/api/lumps/{token}/history")

    assert response.status_code == 200
    history = response.get_json()["history"]
    current = [row for row in history if row.get("current") is True]
    assert len(current) == 1
    active_manifest = next(
        row for row in manifest
        if row.get("token") == token
        and row.get("abstraction") == abstraction
        and row.get("archived") is not True)
    assert current[0]["version"] == active_manifest["lump_version"]

    historical = [row for row in history if row.get("historical_record")]
    assert len(historical) == len(archived_rows)
    expected_records = {
        (row["token"], row["filename"], row["lump_version"])
        for row in archived_rows
    }
    actual_records = {
        (row["record_token"], row["record_filename"], row["version"])
        for row in historical
    }
    assert actual_records == expected_records
    assert all(row["restore_enabled"] is False for row in historical)
    assert all(row["read_only"] is True for row in historical)


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


def test_programmer_can_replace_frozen_slot2_with_compiler_owned_lump():
    """The selected slot binds SELF; the old resident name does not own it."""
    words = [(0x1F << 27) | (1 << 10) | 1, 0] + [0] * 62
    words[-1] = 0xFEED5E1F
    with app_module.app.test_client() as client:
        response = client.post("/api/lumps/save-plan", json={
            "binary": words,
            "metadata": {
                "abstraction": "ProgrammerChoice",
                "ns_slot": 2,
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
    canonical_words[-1] = 0x4A000002
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
                "ns_slot": 2,
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
    canonical_words[-1] = 0x4A000002
    canonical_bytes = __import__("struct").pack(">64I", *canonical_words)
    assert response.get_json()["digest"] == __import__("hashlib").sha256(
        canonical_bytes).hexdigest()


@pytest.mark.parametrize("mutation", ["slot", "seq", "token"])
def test_resolver_and_boot_reject_descriptor_or_token_mutation(tmp_path, mutation):
    source = Path(app_module.LUMPS_DIR)
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
    lumps = tmp_path / "lumps"
    shutil.copytree(Path(app_module.LUMPS_DIR), lumps, symlinks=True)
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
    with pytest.raises(
            ValueError, match="artifact lacks authenticated compiler or bootstrap provenance"):
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
        if (path.is_file() or path.is_symlink())
        and not (set(path.relative_to(root).parts)
                 & {"save-candidates", "save-operations"})
        and path.name not in {
            ".lump-write-leases.json",
            "save-runtime-diagnostics.jsonl",
            "save-runtime-diagnostics.lock",
        }
    }


@pytest.fixture
def isolated_bootstrap_repository(tmp_path, monkeypatch):
    lumps = tmp_path / "lumps"
    shutil.copytree(Path(app_module.LUMPS_DIR), lumps, symlinks=True)
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


def test_only_fixed_nonportable_publications_receive_bootstrap_authority():
    assert publication_uses_bootstrap_authority(_RESIDENT) is True
    assert publication_uses_bootstrap_authority(
        _RESIDENT, {"owner": "CapabilityTest#1"}) is False
    assert publication_uses_bootstrap_authority(
        dict(_RESIDENT, ns_slot_policy="dynamic")) is False


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
