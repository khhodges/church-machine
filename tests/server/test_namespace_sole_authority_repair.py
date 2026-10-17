"""Focused Namespace sole-image-plan repair checks.

Every input is constructed privately, including geometry, selected artifacts,
approvals and history. No test reads or mutates the programmer's saved library.
"""

import hashlib
import builtins
import io
import json
import os
import base64
import subprocess
import struct
from pathlib import Path

import pytest

from server import boot_image
from namespace_image_test_support import artifact, create_namespace_inputs


ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(autouse=True, params=["parent-config", "explicit-config"])
def private_inputs(tmp_path, monkeypatch, request):
    # Fail at the first accidental dependency, including paths inherited from
    # the suite runner. Merely making a private copy is not deterministic.
    forbidden = [
        ROOT / "server" / "lumps", ROOT / "server" / "boot-config.json",
    ]
    for key in ("CHURCH_TEST_LUMPS_DIR", "CHURCH_TEST_BOOT_CONFIG_PATH"):
        if os.environ.get(key):
            forbidden.append(Path(os.environ[key]).resolve())

    def guard(original):
        def checked(path, *args, **kwargs):
            if isinstance(path, (str, bytes, os.PathLike)):
                resolved = Path(os.fsdecode(path)).resolve()
                assert not any(resolved == banned or banned in resolved.parents
                               for banned in forbidden), (
                    f"test tried to access mutable external input: {resolved}")
            return original(path, *args, **kwargs)
        return checked

    for module, name in ((builtins, "open"), (io, "open"),
                         (os, "scandir"), (os, "listdir")):
        monkeypatch.setattr(module, name, guard(getattr(module, name)))
    config = {"targetBoard": "wukong-xc7a100t", "bootEntrySlot": 10, "step1": {
        "totalNamespaceWords": 8192, "namespaceLumpWords": 8192,
        "nsSlotsMax": 64, "threadLumpWords": 256,
        "threadStackWords": 32, "threadCount": 1,
    }}
    parent = tmp_path / "boot-config.json"
    config_path = parent if request.param == "parent-config" else tmp_path / "private-config.json"
    parent.write_text("{}")  # explicit routing must not succeed via this sentinel
    config_path.write_text(json.dumps(config))
    lumps = tmp_path / "lumps"
    monkeypatch.setenv("CHURCH_TEST_ISOLATED_MODE", "1")
    monkeypatch.setenv("CHURCH_TEST_LUMPS_DIR", str(lumps))
    # The optional trace-symbol import has a separate factory-input route.
    monkeypatch.setenv("CHURCH_LUMPS_DIR", str(lumps))
    monkeypatch.setenv("CHURCH_TEST_BOOT_CONFIG_PATH", str(config_path))
    monkeypatch.setenv("CHURCH_TEST_BUILD_SNAPSHOTS_DIR", str(tmp_path / "snapshots"))
    monkeypatch.setenv("CHURCH_TEST_DB_PATH", str(tmp_path / "test.db"))
    monkeypatch.setenv("REPORT_TOKEN", "namespace-fixture-report-token")
    create_namespace_inputs(lumps, config)
    from server import app as app_module

    for attr, path in {
        "LUMPS_DIR": lumps, "LUMPS_MANIFEST_PATH": lumps / "manifest.json",
        "NS_STATE_PATH": lumps / "ns-state.json",
        "BOOT_IMAGE_PATH": lumps / "boot-image.bin",
        "BOOT_IMAGE_PROVENANCE_PATH": lumps / "boot-image.provenance.json",
        "BOOT_CONFIG_PATH": config_path,
        "BOOT_CONFIG_LEGACY_PATH": tmp_path / "no-legacy.json",
    }.items():
        monkeypatch.setattr(app_module, attr, str(path))
    monkeypatch.setitem(app_module.app.config, "TESTING", True)
    monkeypatch.setattr(app_module, "_BOOT_NS_META", {})
    # App import requires all isolated overrides; admission also supports
    # parent discovery. Exercise that route after safe startup.
    if request.param == "parent-config":
        monkeypatch.delenv("CHURCH_TEST_BOOT_CONFIG_PATH")


def _private_fixture(tmp_path):
    """Return freshly constructed private inputs (never copy a live directory)."""
    path = os.environ.get("CHURCH_TEST_BOOT_CONFIG_PATH") or tmp_path / "boot-config.json"
    return tmp_path / "lumps", json.loads(Path(path).read_text())


def test_private_inputs_are_reproducible_and_preserve_config_routing(tmp_path):
    from server import app as app_module
    from server.lump_admission_service import _check_admission_allocation

    lumps, config = _private_fixture(tmp_path)
    # This is the real allocation gate's configuration discovery, rather than
    # just passing our geometry directly to the generator.
    _check_admission_allocation(
        str(lumps / "ns-state.json"), _state(lumps)["abstractions"],
        str(lumps), {})
    assert json.loads(Path(app_module.BOOT_CONFIG_PATH).read_text()) == config
    explicit = os.environ.get("CHURCH_TEST_BOOT_CONFIG_PATH")
    if explicit:
        assert Path(explicit) == Path(app_module.BOOT_CONFIG_PATH)
        assert json.loads((tmp_path / "boot-config.json").read_text()) == {}
    other = tmp_path / "independent-inputs"
    create_namespace_inputs(other, config)
    for path in other.iterdir():
        assert path.read_bytes() == (lumps / path.name).read_bytes(), path.name


def _state(lumps):
    return json.loads((lumps / "ns-state.json").read_text(encoding="utf-8"))


def _write_state(lumps, state):
    (lumps / "ns-state.json").write_text(
        json.dumps(state, indent=2), encoding="utf-8")


def _set_marker(state, slot):
    for row in state["abstractions"]:
        row.pop("boot", None)
    next(row for row in state["abstractions"] if row["slot"] == slot)["boot"] = True


def _endpoint_fixture(tmp_path, monkeypatch):
    from server import app as app_module

    lumps, config = _private_fixture(tmp_path)
    paths = {
        "state": lumps / "ns-state.json",
        "manifest": lumps / "manifest.json",
        "image": lumps / "boot-image.bin",
        "provenance": lumps / "boot-image.provenance.json",
        "config": Path(app_module.BOOT_CONFIG_PATH),
    }
    paths["config"].write_text(json.dumps(config), encoding="utf-8")
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(lumps))
    monkeypatch.setattr(app_module, "LUMPS_MANIFEST_PATH", str(paths["manifest"]))
    monkeypatch.setattr(app_module, "NS_STATE_PATH", str(paths["state"]))
    monkeypatch.setattr(app_module, "BOOT_IMAGE_PATH", str(paths["image"]))
    monkeypatch.setattr(
        app_module, "BOOT_IMAGE_PROVENANCE_PATH", str(paths["provenance"]))
    monkeypatch.setattr(app_module, "BOOT_CONFIG_PATH", str(paths["config"]))
    monkeypatch.setattr(
        app_module, "BOOT_CONFIG_LEGACY_PATH", str(tmp_path / "no-legacy.json"))
    state = _state(lumps)
    image = boot_image.generate_boot_image(config, str(lumps))
    payload = {
        "data_b64": base64.b64encode(image).decode(),
        "ns_state": {"abstractions": state["abstractions"]},
        "boot_config": config,
        "namespaceFingerprint": app_module._namespace_state_fingerprint(
            state["abstractions"]),
    }
    return app_module, lumps, paths, state, payload


def _report_headers():
    token = os.environ.get("REPORT_TOKEN")
    return {"Authorization": f"Bearer {token}"} if token else {}


def _reviewed_save(client, payload, *, path="/api/boot-image/save-ns"):
    from server import app as app_module

    paths = [Path(getattr(app_module, attr)) for attr in (
        "NS_STATE_PATH", "LUMPS_MANIFEST_PATH", "BOOT_IMAGE_PATH",
        "BOOT_IMAGE_PROVENANCE_PATH", "BOOT_CONFIG_PATH",
    )]
    before = {path: path.read_bytes() for path in paths}
    response = client.post(
        path, json=payload, headers=_report_headers())
    if response.status_code == 428:
        assert response.json["error"] == "change_confirmation_required", response.json
        assert response.json["committed"] is False
        assert {path: path.read_bytes() for path in paths} == before
        headers = {**_report_headers(),
                   "X-Change-Confirmation": response.json["change_confirmation"]["id"]}
        response = client.post(
            path, json=payload, headers=headers)
    return response


def _reviewed_table_save(client, payload):
    """Replace the JS transport stub's review with a real server review."""
    payload = json.loads(json.dumps(payload))
    review = client.post("/api/namespace/review-upgrades", json={
        "namespaceFingerprint": payload["namespaceFingerprint"],
        "ns_state": {"abstractions": payload["upgradeReview"]["draft"]},
    }, headers=_report_headers())
    assert review.status_code == 200, review.json
    assert review.json["upgrades"] == []
    payload["upgradeReview"]["reviewFingerprint"] = review.json["reviewFingerprint"]
    return _reviewed_save(client, payload, path="/api/namespace/save-table")


def _assert_preflight_rejected(response, reason):
    assert response.status_code == 409, response.json
    assert response.json["error"] == "change_preflight_failed", response.json
    assert response.json["committed"] is False
    assert reason.lower() in response.json["message"].lower(), response.json


@pytest.mark.parametrize("status", ["unresolved", "invalid", "missing"])
def test_alice_slot14_design_placement_saves_without_binary_approval(
        tmp_path, monkeypatch, status):
    app_module, lumps, paths, state, payload = _endpoint_fixture(
        tmp_path, monkeypatch)
    source = next(row for row in json.loads(
        paths["manifest"].read_text(encoding="utf-8"))
        if row.get("filename", "").startswith("ide.Alice."))
    selected_path = lumps / source["filename"]
    original = selected_path.read_bytes()
    if status == "invalid":
        original = b"\x00\x00\x00\x00" + original[4:]
        selected_path.write_bytes(original)  # private fixture only
    digest = hashlib.sha256(original).hexdigest()
    # A candidate can be selected even when its exact digest is not compiler
    # admitted. The selected fixture bytes are not modified by design placement.
    approvals = json.loads((lumps / "approvals.json").read_text())
    assert digest not in approvals.get("approvals", {})
    selection = {
        "status": status,
        "diagnostic": "No compiler admission record matches this exact SHA-256"
        if status != "missing" else "No saved artifact for this pet name",
    }
    if status != "missing":
        selection.update(token=source["token"], filename=source["filename"],
                         binaryHash=digest)
    name = "ide.Alice" if status != "missing" else "NotYet.Alice"
    row = {"name": name, "slot": 14, "seq": 0, "type": "Inform",
           "location": "0x00000000", "resident": False,
           "symbolic": True, "implementationMissing": True,
           "selection": selection}
    payload["ns_state"]["abstractions"].append(row)
    before = (paths["manifest"].read_bytes(), original)
    with app_module.app.test_client() as client:
        response = _reviewed_save(client, payload)
    assert response.status_code == 200, response.get_data(as_text=True)
    saved = json.loads(paths["state"].read_text())["abstractions"]
    selected = next(item for item in saved if item.get("slot") == 14)
    assert selected["selection"] == selection
    assert selected["symbolic"] is True and selected.get("resident") is False
    assert not any(key in selected for key in ("token", "filename", "binary_hash"))
    assert (paths["manifest"].read_bytes(),
            (lumps / source["filename"]).read_bytes()) == before
    # Reload from canonical state, not a temporary draft table.
    with app_module.app.test_client() as client:
        refreshed = client.get("/api/boot-image/ns-state")
    assert refreshed.status_code == 200
    assert next(item for item in refreshed.json["abstractions"]
                if item.get("slot") == 14)["selection"] == selection


def test_alice_slot14_executable_candidate_remains_approval_blocked(
        tmp_path, monkeypatch):
    app_module, lumps, paths, _state, payload = _endpoint_fixture(
        tmp_path, monkeypatch)
    source = next(row for row in json.loads(
        paths["manifest"].read_text(encoding="utf-8"))
        if row.get("filename", "").startswith("ide.Alice."))
    raw = (lumps / source["filename"]).read_bytes()
    payload["ns_state"]["abstractions"].append({
        "name": "ide.Alice", "slot": 14, "seq": 0, "type": "Inform",
        "location": "0x00000800", "resident": True,
        "boot_resident": True, "load_policy": "Resident",
        "token": source["token"], "filename": source["filename"],
        "binary_hash": hashlib.sha256(raw).hexdigest(),
    })
    before = {name: path.read_bytes() for name, path in paths.items()}
    with app_module.app.test_client() as client:
        response = client.post("/api/boot-image/save-ns", json=payload,
                               headers=_report_headers())
    assert response.status_code == 409
    assert "exact hash-bound approval required" in str(response.json)
    assert {name: path.read_bytes() for name, path in paths.items()} == before


@pytest.mark.parametrize("status", ["unresolved", "invalid", "missing"])
def test_actual_browser_add_save_preflight_commit_reload_alice_slot14(
        tmp_path, monkeypatch, status):
    app_module, lumps, paths, state, initial = _endpoint_fixture(
        tmp_path, monkeypatch)
    source = next(row for row in json.loads(
        paths["manifest"].read_text(encoding="utf-8"))
        if row.get("filename", "").startswith("ide.Alice."))
    selected_path = lumps / source["filename"]
    raw = selected_path.read_bytes()
    if status == "invalid":
        raw = b"\x00\x00\x00\x00" + raw[4:]
        selected_path.write_bytes(raw)  # private fixture only
    record = None if status == "missing" else {
        "token": source["token"], "filename": source["filename"],
        "abstraction": "ide.Alice", "binary_hash": hashlib.sha256(raw).hexdigest(),
        "binary_valid": status != "invalid",
        "validation_errors": ["untrusted saved artifact"] if status == "invalid" else [],
    }
    fixture = {
        "image": initial["data_b64"], "state": state,
        "config": initial["boot_config"],
        "fingerprint": initial["namespaceFingerprint"],
        "aliceWords": (list(struct.unpack(f">{len(raw) // 4}I", raw))
                       if status == "unresolved" else None),
        "selection": {
            "name": "ide.Alice" if record else "Future.Alice",
            "status": status, "record": record,
        },
    }
    browser = subprocess.run(
        ["node", str(ROOT / "simulator" / "test_ns_design_save_payload.js")],
        input=json.dumps(fixture), text=True, capture_output=True, check=False,
        cwd=ROOT, timeout=30)
    assert browser.returncode == 0, browser.stderr
    payload = json.loads(browser.stdout)
    design = next(row for row in payload["ns_state"]["abstractions"]
                  if row["slot"] == 14)
    assert design["selection"]["status"] == status
    assert design["symbolic"] is True
    before = (paths["manifest"].read_bytes(), raw)
    before_image = paths["image"].read_bytes()
    with app_module.app.test_client() as client:
        response = _reviewed_table_save(client, payload)
        assert response.status_code == 200, response.get_data(as_text=True)
        assert response.json["imageRebuilt"] is False
        assert paths["image"].read_bytes() == before_image
        refreshed = client.get("/api/boot-image/ns-state")
    assert refreshed.status_code == 200
    saved = next(row for row in refreshed.json["abstractions"]
                 if row.get("slot") == 14)
    assert saved["selection"] == design["selection"]
    assert saved["symbolic"] is True and saved.get("resident") is False
    assert (paths["manifest"].read_bytes(),
            (lumps / source["filename"]).read_bytes()) == before


def test_rejected_existing_browser_executable_keeps_choice_until_explicit_recovery(
        tmp_path, monkeypatch):
    app_module, lumps, paths, state, initial = _endpoint_fixture(
        tmp_path, monkeypatch)
    source = next(row for row in json.loads(paths["manifest"].read_text())
                  if row.get("filename", "").startswith("ide.Alice."))
    raw = (lumps / source["filename"]).read_bytes()
    record = {
        "token": source["token"], "filename": source["filename"],
        "abstraction": "ide.Alice", "binary_hash": hashlib.sha256(raw).hexdigest(),
        "binary_valid": True,
    }
    fixture = {
        "pending": True, "image": initial["data_b64"],
        "state": state, "config": initial["boot_config"],
        "fingerprint": initial["namespaceFingerprint"],
        "aliceWords": list(struct.unpack(f">{len(raw) // 4}I", raw)),
        "selection": {"name": "ide.Alice", "status": "unresolved", "record": record},
    }
    browser = subprocess.run(
        ["node", str(ROOT / "simulator" / "test_ns_design_save_payload.js")],
        input=json.dumps(fixture), text=True, capture_output=True, check=False,
        cwd=ROOT, timeout=30)
    assert browser.returncode == 0, browser.stderr
    executable, design = json.loads(browser.stdout)
    rejected = next(row for row in executable["ns_state"]["abstractions"]
                    if row["slot"] == 14)
    kept = next(row for row in design["ns_state"]["abstractions"]
                if row["slot"] == 14)
    assert rejected.get("symbolic") is not True
    assert kept["symbolic"] is True
    assert kept["selection"]["filename"] == source["filename"]
    assert kept["selection"]["binaryHash"] == record["binary_hash"]
    before = {name: path.read_bytes() for name, path in paths.items()}
    with app_module.app.test_client() as client:
        # Browser table saves no longer claim to admit executable bytes.
        # Explicit image preparation must still reject this unapproved row.
        image_payload = {
            **executable, "data_b64": initial["data_b64"],
            "boot_config": initial["boot_config"],
        }
        failed = client.post(
            "/api/boot-image/save-ns", json=image_payload, headers=_report_headers())
        assert failed.status_code == 409
        assert "exact hash-bound approval required" in str(failed.json)
        assert {name: path.read_bytes() for name, path in paths.items()} == before
        succeeded = _reviewed_table_save(client, design)
        assert succeeded.status_code == 200, succeeded.get_data(as_text=True)
        refreshed = client.get("/api/boot-image/ns-state")
    assert refreshed.status_code == 200
    assert next(row for row in refreshed.json["abstractions"]
                if row["slot"] == 14)["selection"] == kept["selection"]
    assert (lumps / source["filename"]).read_bytes() == raw


def test_new_resident_derivative_cannot_claim_original_selected_sha(
        tmp_path, monkeypatch):
    app_module, lumps, _paths, _state, initial = _endpoint_fixture(
        tmp_path, monkeypatch)
    saved = next(path for path in lumps.iterdir()
                 if path.name.startswith("ide.Alice.") and path.suffix == ".lump")
    raw = saved.read_bytes()
    original = struct.unpack(f">{len(raw) // 4}I", raw)
    image = bytearray(base64.b64decode(initial["data_b64"]))
    location = 0x0800
    assert location + len(original) < len(image) // 4 - 256
    struct.pack_into("<I", image, (len(image) // 4 - (14 + 1) * 4) * 4,
                     location)
    struct.pack_into(f"<{len(original)}I", image, location * 4, *original)
    row = {"name": "ide.Alice", "slot": 14, "type": "Inform",
           "resident": True, "boot_resident": True,
           "load_policy": "Resident", "filename": saved.name,
           "binary_hash": hashlib.sha256(raw).hexdigest()}
    app_module._validate_new_namespace_resident_bytes([row], {}, bytes(image))
    derivative = list(original)
    derivative[-1] ^= 1  # changed c-list tail; still claims original SHA
    struct.pack_into(f"<{len(derivative)}I", image, location * 4, *derivative)
    with pytest.raises(ValueError, match="resident bytes differ"):
        app_module._validate_new_namespace_resident_bytes([row], {}, bytes(image))


@pytest.mark.parametrize("catalog_variant", [
    "missing",
    "selected-archived",
    "selected-duplicated",
    "different-active-same-token",
])
def test_save_ns_endpoint_uses_exact_namespace_binary_not_stale_catalog(
        tmp_path, monkeypatch, catalog_variant):
    app_module, lumps, paths, state, payload = _endpoint_fixture(
        tmp_path, monkeypatch)
    selected = next(row for row in state["abstractions"]
                    if row.get("name") == "SelfTest")
    selected_bytes = (lumps / selected["filename"]).read_bytes()
    manifest = json.loads(paths["manifest"].read_text(encoding="utf-8"))
    selected_rows = [
        row for row in manifest
        if isinstance(row, dict) and row.get("filename") == selected["filename"]
    ]
    if catalog_variant == "missing":
        manifest = [row for row in manifest if row not in selected_rows]
    elif catalog_variant == "selected-archived":
        for row in selected_rows:
            row["archived"] = True
    elif catalog_variant == "selected-duplicated":
        manifest.extend(json.loads(json.dumps(selected_rows)))
    else:
        for row in selected_rows:
            row["archived"] = True
        other = next(row for row in manifest
                     if isinstance(row, dict)
                     and row.get("filename") != selected["filename"])
        other["token"] = selected["token"]
        other.pop("archived", None)
    paths["manifest"].write_text(json.dumps(manifest), encoding="utf-8")
    # Generation consumes the same exact Namespace-selected files; changing
    # only stale catalog history cannot veto or substitute the resulting image.
    regenerated = boot_image.generate_boot_image(
        payload["boot_config"], str(lumps))
    assert regenerated == base64.b64decode(payload["data_b64"])

    with app_module.app.test_client() as client:
        response = _reviewed_save(client, payload)

    assert response.status_code == 200, response.get_data(as_text=True)
    committed = _state(lumps)
    committed_selected = next(row for row in committed["abstractions"]
                              if row.get("slot") == selected["slot"])
    for field in ("name", "slot", "token", "filename", "binary_hash",
                  "resident", "boot_resident", "load_policy",
                  "ns_slot_policy", "identity_hash"):
        assert committed_selected.get(field) == selected.get(field)
    assert (lumps / selected["filename"]).read_bytes() == selected_bytes


@pytest.mark.parametrize("failure", [
    "missing", "hash", "corrupt", "approval", "token-only", "cache-token-only",
])
def test_save_ns_endpoint_integrity_failures_publish_no_mutation(
        tmp_path, monkeypatch, failure):
    app_module, lumps, paths, state, payload = _endpoint_fixture(
        tmp_path, monkeypatch)
    selected = next(row for row in state["abstractions"]
                    if row.get("name") == "SelfTest")
    selected_path = lumps / selected["filename"]
    if failure == "missing":
        selected_path.unlink()
    elif failure == "hash":
        payload["ns_state"]["abstractions"] = json.loads(json.dumps(
            state["abstractions"]))
        row = next(row for row in payload["ns_state"]["abstractions"]
                   if row.get("slot") == selected["slot"])
        row["binary_hash"] = "0" * 64
    elif failure == "corrupt":
        selected_path.write_bytes(b"corrupt")
    elif failure == "approval":
        approvals_path = lumps / "approvals.json"
        approvals = json.loads(approvals_path.read_text(encoding="utf-8"))
        approvals["approvals"].pop(selected["binary_hash"])
        approvals_path.write_text(json.dumps(approvals), encoding="utf-8")
    else:
        payload["ns_state"]["abstractions"] = json.loads(json.dumps(
            state["abstractions"]))
        payload["ns_state"]["abstractions"].append({
            "name": "LazyMissingBinding",
            "slot": 12,
            "type": "Inform",
            ("token" if failure == "token-only" else "cache_token"): "1234abcd",
            "resident": False,
            "boot_resident": False,
            "load_policy": "Lazy",
        })
    before = {name: path.read_bytes() for name, path in paths.items()}

    with app_module.app.test_client() as client:
        response = client.post(
            "/api/boot-image/save-ns", json=payload, headers=_report_headers())

    reason = {
        "missing": "No such file", "hash": "hash",
        "corrupt": "binary length", "approval": "approval",
        "token-only": "filename", "cache-token-only": "filename",
    }[failure]
    _assert_preflight_rejected(response, reason)
    assert {name: path.read_bytes() for name, path in paths.items()} == before


def test_save_ns_endpoint_accepts_attested_nonbootstrap_resident(
        tmp_path, monkeypatch):
    from server.lump_approvals import (
        configured_compiler_tcb_key, sign_compiler_record)

    monkeypatch.setenv(
        "COMPILER_SIGNING_SECRET", "task3520-compiler-test-secret-" + "x" * 32)
    app_module, lumps, _paths, state, payload = _endpoint_fixture(
        tmp_path, monkeypatch)
    selected = next(row for row in state["abstractions"]
                    if row.get("name") == "SelfTest")
    approvals_path = lumps / "approvals.json"
    envelope = json.loads(approvals_path.read_text(encoding="utf-8"))
    approval = envelope["approvals"][selected["binary_hash"]]
    approval.pop("bootstrap_t", None)
    approval.pop("bootstrap_runtime_gt", None)
    approval.update({
        "trust_origin": "trusted-home-ide",
        "compiler_identity": "CLOOMC",
        "compiler_version": "task3520-test",
        "compiler_record": sign_compiler_record(
            {
                "schema": "church-compiler-output/v1",
                "binary_hash": selected["binary_hash"],
                "compiler": "CLOOMC",
                "compiler_version": "task3520-test",
            },
            signing_key=configured_compiler_tcb_key(),
        ),
    })
    approvals_path.write_text(json.dumps(envelope), encoding="utf-8")

    with app_module.app.test_client() as client:
        response = _reviewed_save(client, payload)

    assert response.status_code == 200, response.get_data(as_text=True)


def test_save_ns_endpoint_stale_cas_publishes_no_mutation(
        tmp_path, monkeypatch):
    app_module, _lumps, paths, _state_doc, payload = _endpoint_fixture(
        tmp_path, monkeypatch)
    payload["namespaceFingerprint"] = "stale-browser-fingerprint"
    before = {name: path.read_bytes() for name, path in paths.items()}

    with app_module.app.test_client() as client:
        response = client.post(
            "/api/boot-image/save-ns", json=payload, headers=_report_headers())

    _assert_preflight_rejected(response, "Namespace changed")
    assert "reload" in response.json["message"].lower()
    assert {name: path.read_bytes() for name, path in paths.items()} == before


def test_alternate_eligible_target_is_authoritative_and_stale_explicit_slot_rejected(
        tmp_path):
    lumps, config = _private_fixture(tmp_path)
    state = _state(lumps)
    _set_marker(state, 7)  # WukongCallHome is an approved resident executable.
    _write_state(lumps, state)

    assert boot_image.namespace_boot_marker_slot(state["abstractions"]) == 7
    image = boot_image.generate_boot_image(config, str(lumps), boot_entry_slot=7)
    assert boot_image.read_boot_entry_info(image)["entry_slot"] == 7

    # A stale UI/config selection cannot override the state marker.
    with pytest.raises(ValueError, match="does not match authoritative"):
        boot_image.generate_boot_image(config, str(lumps), boot_entry_slot=10)


def test_duplicate_marker_fails_closed_without_image_generation(tmp_path):
    lumps, config = _private_fixture(tmp_path)
    state = _state(lumps)
    next(row for row in state["abstractions"] if row["slot"] == 7)["boot"] = True
    before = (lumps / "boot-image.bin").read_bytes()
    _write_state(lumps, state)

    with pytest.raises(ValueError, match="exactly one"):
        boot_image.generate_boot_image(config, str(lumps))
    assert (lumps / "boot-image.bin").read_bytes() == before


def test_mmio_marker_is_rejected_only_by_physical_image_projection(tmp_path):
    lumps, config = _private_fixture(tmp_path)
    state = _state(lumps)
    _set_marker(state, 2)  # UART_DEV remains a valid MMIO descriptor, not code.
    _write_state(lumps, state)

    # Marker parsing itself is Namespace-generic; the physical generator gate
    # rejects attempting to project an MMIO row into Boot.Entry.
    assert boot_image.namespace_boot_marker_slot(state["abstractions"]) == 2
    with pytest.raises(ValueError, match="MMIO device"):
        boot_image.generate_boot_image(config, str(lumps), boot_entry_slot=2)


def test_generator_rejects_competing_step2_and_ignores_legacy_profile(tmp_path):
    lumps, config = _private_fixture(tmp_path)
    conflicting = json.loads(json.dumps(config))
    conflicting["step2"] = {
        "lumps": [{
            "nsSlot": 10,
            "lumpToken": "4a000002",
            "loadPolicy": "Resident",
            "resident": True,
        }]
    }
    with pytest.raises(ValueError, match="Step-2 token"):
        boot_image.generate_boot_image(conflicting, str(lumps))

    conflicting.pop("step2")
    conflicting["residentProfile"] = "core"
    # Legacy profile metadata is no longer an authority over Namespace rows.
    assert boot_image.generate_boot_image(conflicting, str(lumps)) == (
        boot_image.generate_boot_image(config, str(lumps)))


def test_private_image_descriptor_binary_config_and_provenance_parity(tmp_path):
    lumps, config = _private_fixture(tmp_path)
    state = _state(lumps)
    image = (lumps / "boot-image.bin").read_bytes()
    provenance = json.loads(
        (lumps / "boot-image.provenance.json").read_text(encoding="utf-8"))

    marker = boot_image.namespace_boot_marker_slot(state["abstractions"])
    info = boot_image.read_boot_entry_info(image)
    assert marker == 10
    assert info["entry_slot"] == marker
    assert info["resident"] and info["caps0_ok"]
    assert config["bootEntrySlot"] == marker

    raw = boot_image.parse_ns_table_raw(image)
    raw_by_slot = {entry["slot"]: entry for entry in raw["entries"]}
    for row in state["abstractions"]:
        entry = raw_by_slot[row["slot"]]
        assert int(row["location"], 0) == entry["w0"]
        assert int(row["limit"], 0) == entry["w1"] & 0x1FFFF
        assert int(row["seal"], 0) == entry["w2"]
    assert state["abstractions"][2]["name"] == "UART_DEV"
    cap = next(row for row in state["abstractions"]
               if row["name"] == "CapabilityTest")
    assert cap["slot"] == 10
    assert cap["token"] == "4a00000a"
    _, current, _ = artifact("CapabilityTest", 10, continuation=7, issue=3)
    assert cap["filename"] == current["filename"]

    image_digest = hashlib.sha256(image).hexdigest()
    assert provenance["origin"] == "generated"
    assert provenance["image_sha256"] == image_digest
    assert provenance["source_sha256"]["ns_state"] == hashlib.sha256(
        (lumps / "ns-state.json").read_bytes()).hexdigest()
    assert provenance["source_sha256"]["manifest"] == hashlib.sha256(
        (lumps / "manifest.json").read_bytes()).hexdigest()
    cap_binding = next(row for row in provenance["resident_bindings"]
                       if row["slot"] == 10)
    assert cap_binding["filename"] == cap["filename"]
    assert cap_binding["token"] == cap["token"]
    assert cap_binding["artifact_sha256"] == hashlib.sha256(
        (lumps / cap["filename"]).read_bytes()).hexdigest()


def test_capabilitytest_history_uses_exact_approved_current_artifact(tmp_path):
    lumps, _ = _private_fixture(tmp_path)
    _, expected_current, _ = artifact("CapabilityTest", 10, continuation=7, issue=3)
    historical_raw, expected_historical, _ = artifact(
        "CapabilityTest", 2, continuation=7, issue=2)
    approvals = json.loads((lumps / "approvals.json").read_text(encoding="utf-8"))[
        "approvals"]
    manifest = json.loads((lumps / "manifest.json").read_text(encoding="utf-8"))
    current = next(row for row in manifest
                    if row.get("filename") == expected_current["filename"])
    historical = next(row for row in manifest
                       if row.get("filename") == expected_historical["filename"])
    current_hash = hashlib.sha256(
        (lumps / current["filename"]).read_bytes()).hexdigest()
    historical_hash = hashlib.sha256(
        (lumps / historical["filename"]).read_bytes()).hexdigest()
    assert current["token"] == "4a00000a"
    assert approvals[current_hash]["bootstrap_t"] == "4a00000a"
    assert historical["token"] == "4a000002"
    assert approvals[historical_hash]["bootstrap_t"] == "4a000002"
    # The old artifact remains immutable historical evidence; only the exact
    # approved current artifact is bound into the repaired NS[10] row.
    state = _state(lumps)
    cap = next(row for row in state["abstractions"]
               if row["name"] == "CapabilityTest")
    assert cap["filename"] == current["filename"]
    assert cap["token"] == current["token"]
    assert historical_hash == hashlib.sha256(historical_raw).hexdigest()


def test_boot_marker_endpoint_is_atomic_and_accepts_eligible_alternate(tmp_path,
                                                                         monkeypatch):
    # Importing the Flask module is isolated to this test process; all writes
    # are redirected to a temporary artifact directory.
    from server import app as app_module

    lumps, _ = _private_fixture(tmp_path)
    state_path = lumps / "ns-state.json"
    image_path = lumps / "boot-image.bin"
    before_image = image_path.read_bytes()
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(lumps))
    monkeypatch.setattr(app_module, "NS_STATE_PATH", str(state_path))
    monkeypatch.setattr(app_module, "BOOT_IMAGE_PATH", str(image_path))
    headers = {}
    if os.environ.get("REPORT_TOKEN"):
        headers["Authorization"] = f"Bearer {os.environ['REPORT_TOKEN']}"
    fingerprint = app_module._namespace_state_fingerprint(
        _state(lumps)["abstractions"])
    selected = next(row for row in _state(lumps)["abstractions"] if row["slot"] == 7)
    payload = {
        "slot": 7, "namespaceFingerprint": fingerprint,
        "revision": selected["issue_n"], "token": selected["token"],
        "filename": selected["filename"],
    }

    with app_module.app.test_client() as client:
        response = _reviewed_save(client, payload, path="/api/namespace/boot-marker")
        assert response.status_code == 200, response.get_data(as_text=True)
        updated = json.loads(state_path.read_text(encoding="utf-8"))
        assert [row["slot"] for row in updated["abstractions"] if row.get("boot")] == [7]
        assert image_path.read_bytes() == before_image

        # Duplicate markers are rejected before the atomic replacement and
        # therefore cannot partially alter the state file.
        updated["abstractions"][0]["boot"] = True
        duplicate_bytes = json.dumps(updated, indent=2).encode()
        state_path.write_bytes(duplicate_bytes)
        response = _reviewed_save(client, payload, path="/api/namespace/boot-marker")
        assert response.status_code == 409
        assert state_path.read_bytes() == duplicate_bytes


def test_save_ns_commits_submitted_alternate_marker_and_rejects_stale_tab(
        tmp_path, monkeypatch):
    from server import app as app_module

    lumps, config = _private_fixture(tmp_path)
    state_path = lumps / "ns-state.json"
    image_path = lumps / "boot-image.bin"
    provenance_path = lumps / "boot-image.provenance.json"
    config_path = Path(app_module.BOOT_CONFIG_PATH)
    config_path.write_text(json.dumps(config), encoding="utf-8")
    state = _state(lumps)
    expected = app_module._namespace_state_fingerprint(state["abstractions"])
    original_state = json.loads(json.dumps(state))
    _set_marker(state, 7)
    _write_state(lumps, state)
    alternate = boot_image.generate_boot_image(
        config, str(lumps), boot_entry_slot=7)
    _write_state(lumps, original_state)

    monkeypatch.setattr(app_module, "LUMPS_DIR", str(lumps))
    monkeypatch.setattr(app_module, "LUMPS_MANIFEST_PATH", str(lumps / "manifest.json"))
    monkeypatch.setattr(app_module, "NS_STATE_PATH", str(state_path))
    monkeypatch.setattr(app_module, "BOOT_IMAGE_PATH", str(image_path))
    monkeypatch.setattr(app_module, "BOOT_IMAGE_PROVENANCE_PATH", str(provenance_path))
    monkeypatch.setattr(app_module, "BOOT_CONFIG_PATH", str(config_path))
    headers = {}
    if os.environ.get("REPORT_TOKEN"):
        headers["Authorization"] = f"Bearer {os.environ['REPORT_TOKEN']}"
    payload = {
        "data_b64": base64.b64encode(alternate).decode(),
        "ns_state": {"abstractions": state["abstractions"]},
        "boot_config": config,
        "namespaceFingerprint": expected,
    }

    with app_module.app.test_client() as client:
        response = _reviewed_save(client, payload)
        assert response.status_code == 200, response.get_data(as_text=True)
        committed = _state(lumps)
        assert [row["slot"] for row in committed["abstractions"]
                if row.get("boot")] == [7]
        assert json.loads(config_path.read_text())["bootEntrySlot"] == 7
        assert boot_image.read_boot_entry_info(image_path.read_bytes())["entry_slot"] == 7

        # A second writer carrying the original fingerprint cannot replace the
        # newly committed complete Namespace/image/config transaction.
        stale_payload = dict(payload)
        stale_payload["ns_state"] = {"abstractions": committed["abstractions"]}
        stale_payload["data_b64"] = base64.b64encode(image_path.read_bytes()).decode()
        before_stale = {path: path.read_bytes() for path in (
            state_path, image_path, provenance_path, config_path)}
        response = client.post("/api/boot-image/save-ns", json=stale_payload,
                               headers=headers)
        _assert_preflight_rejected(response, "Namespace changed")
        assert {path: path.read_bytes() for path in before_stale} == before_stale


def test_reviewed_migration_tool_recreates_image_state_and_provenance(
        tmp_path, monkeypatch):
    from scripts import migrate_bootstrap_residents as migration

    lumps, config = _private_fixture(tmp_path)
    historical_raw, historical, _ = artifact(
        "CapabilityTest", 2, continuation=7, issue=2)
    _, current, _ = artifact("CapabilityTest", 10, continuation=7, issue=3)
    # Only the reviewed identities are fixture data. All migration digest,
    # approval, profile, graph and atomic-publication checks remain real.
    for attr, record, slot in (
        ("SOURCE_CAPABILITY", historical, 2), ("CURRENT_CAPABILITY", current, 10),
    ):
        monkeypatch.setattr(migration, attr, {
            "slot": slot, "filename": record["filename"], "token": record["token"],
            "sha256": record["binary_hash"],
        })
    manifest_path = lumps / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    next(row for row in manifest
         if row["filename"] == historical["filename"]).pop("archived")
    manifest_path.write_text(json.dumps(manifest))
    config["bootEntrySlot"] = 2
    (tmp_path / "boot-config.json").write_text(
        json.dumps(config), encoding="utf-8")
    state = _state(lumps)
    state["abstractions"] = [
        row for row in state["abstractions"]
        if row.get("slot") not in (2, 10)
    ]
    state["abstractions"].append({
        "name": "CapabilityTest",
        "slot": 2,
        "location": "0x40000014",
        "type": "Inform",
        "f": 0,
        "g": 1,
        "limit": "0x00002",
        "seq": 0,
        "seal": "0xDEADF4CF",
        "token": "4a000002",
        "filename": historical["filename"],
        "binary_hash": historical["binary_hash"],
        "issue_n": 2,
        "lump_version": 27,
        "resident": True,
        "load_policy": "Resident",
        "boot_resident": True,
        "ns_slot_policy": "static",
        "boot": True,
    })
    _write_state(lumps, state)
    migration.migrate(str(lumps))

    migrated = _state(lumps)
    cap = next(row for row in migrated["abstractions"]
               if row["name"] == "CapabilityTest")
    uart = next(row for row in migrated["abstractions"]
                if row["name"] == "UART_DEV")
    image = (lumps / "boot-image.bin").read_bytes()
    provenance = json.loads(
        (lumps / "boot-image.provenance.json").read_text(encoding="utf-8"))
    assert cap["slot"] == 10 and cap["token"] == "4a00000a"
    assert cap["filename"] == current["filename"]
    assert cap["boot"] is True and uart["slot"] == 2
    assert boot_image.read_boot_entry_info(image)["entry_slot"] == 10
    assert provenance["image_sha256"] == hashlib.sha256(image).hexdigest()
    assert provenance["source_sha256"]["ns_state"] == hashlib.sha256(
        (lumps / "ns-state.json").read_bytes()).hexdigest()
    assert (lumps / historical["filename"]).read_bytes() == historical_raw


def test_legacy_or_missing_state_does_not_abort_image_metadata_startup(
        tmp_path, monkeypatch):
    from server import app as app_module

    lumps, _ = _private_fixture(tmp_path)
    image_path = lumps / "boot-image.bin"
    config_path = Path(app_module.BOOT_CONFIG_PATH)
    monkeypatch.setattr(app_module, "BOOT_IMAGE_PATH", str(image_path))
    monkeypatch.setattr(app_module, "BOOT_CONFIG_PATH", str(config_path))
    monkeypatch.setattr(app_module, "NS_STATE_PATH", str(tmp_path / "missing.json"))
    app_module._BOOT_NS_META.clear()
    app_module._load_boot_ns_lump()
    assert "authority_error" in app_module._BOOT_NS_META