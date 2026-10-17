import hashlib
import json
import struct
import threading

import pytest

from server.lump_admission_service import (
    AdmissionError,
    NavanaService,
    admit,
    derive_capability_targets,
    validate_namespace_artifact_selections,
)
from server.lump_approvals import read_approvals
from server.namespace_authority import namespace_fingerprint


def _portable_lump():
    words = [((0x1F << 27) | (1 << 10) | 1)] + [0] * 62
    words[1] = 0x1F000000
    words.append(0x4A000006)
    return struct.pack(">64I", *words)


def _authorization(raw):
    return {"grants": ["E"], "capabilities": derive_capability_targets(raw)}


def test_changed_namespace_bytes_are_rejected_before_state_changes(
        tmp_path):
    digest = "a" * 64
    rows = [{
        "slot": 14,
        "filename": "Example_v1.lump",
        "binary_hash": digest,
    }]
    (tmp_path / "Example_v1.lump").write_bytes(b"archived")
    committed = tmp_path / "ns-state.json"
    original = {"revision": 7, "abstractions": []}
    committed.write_text(json.dumps(original))

    with pytest.raises(AdmissionError, match="differs from the approved bytes"):
        validate_namespace_artifact_selections(rows, str(tmp_path))

    assert json.loads(committed.read_text()) == original


@pytest.mark.parametrize("catalog", [[], [{"archived": True}], [{}, {}]])
def test_catalog_status_cannot_veto_exact_namespace_selection(tmp_path, catalog):
    raw = b"active"
    digest = hashlib.sha256(raw).hexdigest()
    filename = "Example.1.12345678.lump"
    (tmp_path / filename).write_bytes(raw)
    row = {"slot": 14, "filename": filename, "binary_hash": digest}
    manifest = [{"token": digest[:8], "filename": filename, **entry}
                for entry in catalog]
    (tmp_path / "manifest.json").write_text(json.dumps(manifest))
    validate_namespace_artifact_selections([row], str(tmp_path))
    assert json.loads((tmp_path / "manifest.json").read_text()) == manifest


def test_pending_bytes_are_authoritative_before_publication(tmp_path):
    raw = b"new approved bytes"
    row = {"slot": 14, "filename": "pending.lump",
           "binary_hash": hashlib.sha256(raw).hexdigest()}
    (tmp_path / row["filename"]).write_bytes(b"old bytes")
    validate_namespace_artifact_selections(
        [row], str(tmp_path), {row["filename"]: raw})
    with pytest.raises(AdmissionError, match="differs from the approved bytes"):
        validate_namespace_artifact_selections(
            [row], str(tmp_path), {row["filename"]: b"wrong"})
    assert (tmp_path / row["filename"]).read_bytes() == b"old bytes"


def test_missing_selected_bytes_are_not_replaced_from_catalog(tmp_path):
    with pytest.raises(AdmissionError, match="cannot be read"):
        validate_namespace_artifact_selections(
            [{"slot": 14, "filename": "missing.lump", "binary_hash": "a" * 64}],
            str(tmp_path))


@pytest.mark.parametrize("filename", ["../outside.lump", ".", "..", "a\\b", "a\0b"])
def test_selected_filename_must_be_local(tmp_path, filename):
    with pytest.raises(AdmissionError, match="exact LUMP filename"):
        validate_namespace_artifact_selections(
            [{"slot": 14, "filename": filename, "binary_hash": "a" * 64}],
            str(tmp_path))


@pytest.mark.parametrize("catalog", [[], [{"archived": True}], [{}, {}]])
def test_real_admission_atomically_publishes_derivative_and_evidence(tmp_path, catalog):
    raw = _portable_lump()
    token = hashlib.sha256(raw).hexdigest()[:8]
    quarantine = tmp_path / "quarantine"
    quarantine.mkdir()
    quarantine_path = quarantine / f"{token}.lump"
    quarantine_path.write_bytes(raw)
    manifest_path = tmp_path / "manifest.json"
    selected_raw = _portable_lump()
    selected_filename = "PreviouslyApproved.lump"
    selected_hash = hashlib.sha256(selected_raw).hexdigest()
    (tmp_path / selected_filename).write_bytes(selected_raw)
    prior_rows = [{"slot": 15, "filename": selected_filename,
                   "binary_hash": selected_hash, "resident": False}]
    manifest_path.write_text(json.dumps([
        {"filename": selected_filename, "token": "previous", **entry}
        for entry in catalog]))
    state_path = tmp_path / "ns-state.json"
    state_path.write_text(json.dumps({"revision": 0, "abstractions": prior_rows}))

    result = admit(
        quarantine_path=str(quarantine_path),
        lumps_dir=str(tmp_path),
        state_path=str(state_path),
        manifest_path=str(manifest_path),
        token=token,
        expected_digest=hashlib.sha256(raw).hexdigest(),
        name="UploadedFixture",
        revision=1,
        destination_slot=14,
        replace=False,
        resident=False,
        boot=False,
        authorization=_authorization(raw),
        requested=["E"],
        granted=["E"],
        lock=threading.RLock(),
        expected_namespace_fingerprint=namespace_fingerprint(prior_rows),
    )

    derivative = (tmp_path / result["filename"]).read_bytes()
    derivative_hash = hashlib.sha256(derivative).hexdigest()
    assert result["mint_egt"] == "4a01000e"
    assert int.from_bytes(derivative[-4:], "big") == 0x4A01000E
    assert derivative != raw
    assert result["portable_original_sha256"] == hashlib.sha256(raw).hexdigest()
    assert result["derivative_sha256"] == derivative_hash
    assert result["token"] == derivative_hash[:8]
    assert result["portable_token"] == token
    assert (tmp_path / "portable-original" / f"{token}.lump").read_bytes() == raw

    manifest = json.loads(manifest_path.read_text())
    assert manifest[-1]["token"] == derivative_hash[:8]
    assert manifest[-1]["filename"] == result["filename"]
    state = json.loads(state_path.read_text())
    assert next(entry for entry in state["abstractions"] if entry["slot"] == 15) == prior_rows[0]
    row = next(entry for entry in state["abstractions"]
               if entry["slot"] == 14)
    assert row["binary_hash"] == derivative_hash
    assert row["token"] == derivative_hash[:8]

    evidence_dir = tmp_path / ("admission" + "-evidence")
    evidence_path = next(evidence_dir.iterdir())
    evidence = json.loads(evidence_path.read_text())
    assert evidence["binary_hash"] == derivative_hash
    assert evidence["portable_original_sha256"] == hashlib.sha256(raw).hexdigest()
    approvals = read_approvals(str(tmp_path / "approvals.json"))
    assert approvals[derivative_hash]["binary_hash"] == derivative_hash


def test_admission_rejects_quarantine_bytes_outside_the_approved_full_digest(
        tmp_path):
    approved = _portable_lump()
    tampered = bytearray(approved)
    tampered[4:8] = (0x1F000001).to_bytes(4, "big")
    token = hashlib.sha256(approved).hexdigest()[:8]
    quarantine_path = tmp_path / "quarantine.lump"
    quarantine_path.write_bytes(bytes(tampered))
    (tmp_path / "manifest.json").write_text("[]")
    (tmp_path / "ns-state.json").write_text(json.dumps({
        "revision": 0, "abstractions": [],
    }))

    with pytest.raises(AdmissionError, match="tampered"):
        admit(
            quarantine_path=str(quarantine_path),
            lumps_dir=str(tmp_path),
            state_path=str(tmp_path / "ns-state.json"),
            manifest_path=str(tmp_path / "manifest.json"),
            token=token,
            expected_digest=hashlib.sha256(approved).hexdigest(),
            name="Substituted",
            revision=1,
            destination_slot=14,
            replace=False,
            resident=False,
            boot=False,
            authorization=_authorization(approved),
            requested=["E"],
            granted=["E"],
            lock=threading.RLock(),
        )


def test_interrupted_publication_recovers_at_every_replace_boundary(tmp_path):
    raw = _portable_lump()
    token = hashlib.sha256(raw).hexdigest()[:8]
    for boundary in range(1, 9):
        root = tmp_path / str(boundary)
        quarantine = root / "quarantine"
        quarantine.mkdir(parents=True)
        quarantine_path = quarantine / f"{token}.lump"
        quarantine_path.write_bytes(raw)
        manifest_path = root / "manifest.json"
        manifest_path.write_text("[]")
        state_path = root / "ns-state.json"
        original_state = {"revision": 0, "abstractions": []}
        state_path.write_text(json.dumps(original_state))
        replacements = 0

        def crash_after_replace(source, target):
            nonlocal replacements
            replacements += 1
            __import__("os").replace(source, target)
            if replacements == boundary:
                raise SystemExit("simulated process death")

        service = NavanaService(replace_func=crash_after_replace)
        try:
            admit(
                quarantine_path=str(quarantine_path),
                lumps_dir=str(root),
                state_path=str(state_path),
                manifest_path=str(manifest_path),
                token=token,
                expected_digest=hashlib.sha256(raw).hexdigest(),
                name="Interrupted",
                revision=1,
                destination_slot=14,
                replace=False,
                resident=False,
                boot=False,
                authorization=_authorization(raw),
                requested=["E"],
                granted=["E"],
                lock=threading.RLock(),
                navana=service,
                expected_namespace_fingerprint=namespace_fingerprint(
                    json.loads(state_path.read_text())["abstractions"]),
            )
        except SystemExit:
            pass
        else:
            raise AssertionError(f"boundary {boundary} did not interrupt")

        # A previous process's transaction must remain pending, not mutate
        # on startup. Current-request exception rollback is tested separately.
        before = {str(p.relative_to(root)): p.read_bytes()
                  for p in root.rglob("*") if p.is_file()}
        try:
            NavanaService().recover(str(root))
        except AdmissionError as exc:
            assert exc.status == 503
            assert "reviewed offline recovery" in str(exc)
        else:
            raise AssertionError("startup recovery bypassed review")
        after = {str(p.relative_to(root)): p.read_bytes()
                 for p in root.rglob("*") if p.is_file()}
        assert after == before
        assert (root / NavanaService.JOURNAL_NAME).exists()


def test_repeat_admission_uses_immutable_destination_local_derivatives(tmp_path):
    raw = _portable_lump()
    portable_token = hashlib.sha256(raw).hexdigest()[:8]
    quarantine = tmp_path / "quarantine"
    quarantine.mkdir()
    quarantine_path = quarantine / f"{portable_token}.lump"
    quarantine_path.write_bytes(raw)
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text("[]")
    state_path = tmp_path / "ns-state.json"
    state_path.write_text(json.dumps({"revision": 0, "abstractions": []}))

    def admit_to(slot, *, replace=False):
        return admit(
            quarantine_path=str(quarantine_path),
            lumps_dir=str(tmp_path),
            state_path=str(state_path),
            manifest_path=str(manifest_path),
            token=portable_token,
            expected_digest=hashlib.sha256(raw).hexdigest(),
            name="PortableFixture",
            revision=1,
            destination_slot=slot,
            replace=replace,
            resident=False,
            boot=False,
            authorization=_authorization(raw),
            requested=["E"],
            granted=["E"],
            lock=threading.RLock(),
            expected_namespace_fingerprint=namespace_fingerprint(
                json.loads(state_path.read_text())["abstractions"]),
        )

    first = admit_to(14)
    second = admit_to(15)
    assert first["token"] != second["token"]
    assert first["filename"] != second["filename"]
    first_bytes = (tmp_path / first["filename"]).read_bytes()
    second_bytes = (tmp_path / second["filename"]).read_bytes()
    assert int.from_bytes(first_bytes[-4:], "big") == 0x4A01000E
    assert int.from_bytes(second_bytes[-4:], "big") == 0x4A01000F

    state = json.loads(state_path.read_text())
    for row in state["abstractions"]:
        artifact = (tmp_path / row["filename"]).read_bytes()
        assert hashlib.sha256(artifact).hexdigest() == row["binary_hash"]
        assert row["token"] == row["binary_hash"][:8]
    active = [entry for entry in json.loads(manifest_path.read_text())
              if entry.get("archived") is not True]
    assert len({entry["token"] for entry in active}) == len(active)

    replaced = admit_to(14, replace=True)
    assert replaced["filename"] != first["filename"]
    assert (tmp_path / first["filename"]).read_bytes() == first_bytes
    manifest = json.loads(manifest_path.read_text())
    old = next(entry for entry in manifest
               if entry["filename"] == first["filename"])
    assert old["archived"] is True
    state = json.loads(state_path.read_text())
    row14 = next(row for row in state["abstractions"] if row["slot"] == 14)
    replacement_bytes = (tmp_path / row14["filename"]).read_bytes()
    assert int.from_bytes(replacement_bytes[-4:], "big") == 0x4A02000E
    assert hashlib.sha256(replacement_bytes).hexdigest() == row14["binary_hash"]


@pytest.fixture(params=["parent-config", "explicit-config"])
def resident_inputs(tmp_path, monkeypatch, request):
    """Complete private inputs; neither catalog nor geometry comes from live state."""
    from server.boot_image import architecture_device_catalog

    root = tmp_path / "lumps"
    root.mkdir()
    config = {"step1": {
        "totalNamespaceWords": 8192, "namespaceLumpWords": 8192,
        "nsSlotsMax": 64, "threadLumpWords": 256,
        "threadStackWords": 32, "threadCount": 1,
    }}
    config_path = tmp_path / "boot-config.json"
    config_path.write_text(json.dumps(config))
    # The suite runner supplies its own copied config. Override it so admission
    # and generation always consume this test's same deterministic geometry.
    if request.param == "explicit-config":
        config_path = tmp_path / "private-config.json"
        config_path.write_text(json.dumps(config))
        # An implementation that incorrectly ignores the explicit config must
        # fail, rather than succeed by using the identical parent config.
        (tmp_path / "boot-config.json").write_text("{}")
        monkeypatch.setenv("CHURCH_TEST_BOOT_CONFIG_PATH", str(config_path))
    else:
        monkeypatch.delenv("CHURCH_TEST_BOOT_CONFIG_PATH", raising=False)
    monkeypatch.setenv("CHURCH_TEST_LUMPS_DIR", str(root))

    # Locations below are a compact valid layout for the admission under test:
    # Thread [16,272), CapabilityTest [272,336), upload [336,400),
    # SelfTest [400,464). Noncompact generation is tested separately below.
    # This synthetic bootstrap fixture has exactly one SELF capability. Its
    # approval binds these bytes, not a rewritten copy of a live compiler LUMP.
    raw = _portable_lump()
    digest = hashlib.sha256(raw).hexdigest()
    filename = f"SelfTest.1.{digest[:8]}.lump"
    (root / filename).write_bytes(raw)
    rows = [
        {"slot": 0, "name": "Boot.NS", "type": "Namespace", "location": 0, "seq": 0},
        {"slot": 1, "name": "Boot.Thread", "type": "Thread", "location": 16, "seq": 0},
        {"slot": 6, "name": "SelfTest", "type": "Inform", "location": 400,
         "seq": 0, "filename": filename, "binary_hash": digest, "token": "4a000006",
         "resident": True, "boot_resident": True, "load_policy": "Resident",
         "ns_slot_policy": "static", "boot": True},
    ]
    # Preserve the current hardware-image profile rather than bypassing its
    # mandatory devices/CapabilityTest checks with simulation-only validation.
    for device in architecture_device_catalog().values():
        rows.append({"slot": device["slot"], "name": device["name"], "type": "Device",
                     "location": device["address"], "limit": device["limit"], "seq": 0})
    capability_raw = raw[:-4] + (0x4A00000A).to_bytes(4, "big")
    capability_hash = hashlib.sha256(capability_raw).hexdigest()
    capability_filename = f"CapabilityTest.1.{capability_hash[:8]}.lump"
    (root / capability_filename).write_bytes(capability_raw)
    rows.append({**rows[2], "slot": 10, "name": "CapabilityTest", "location": 272,
                 "filename": capability_filename, "binary_hash": capability_hash,
                 "token": "4a00000a", "boot": False})
    (root / "ns-state.json").write_text(json.dumps({"revision": 7, "abstractions": rows}))
    (root / "manifest.json").write_text("[]")
    (root / "approvals.json").write_text(json.dumps({
        "version": 1, "algorithm": "sha256", "approvals": {
            digest: {"binary_hash": digest, "filename": filename,
                     "dot_name": "SelfTest", "issue_n": 1, "token": "4a000006",
                     "bootstrap_t": "4a000006", "bootstrap_runtime_gt": 0x4A000006},
            capability_hash: {
                "binary_hash": capability_hash, "filename": capability_filename,
                "dot_name": "CapabilityTest", "issue_n": 1, "token": "4a00000a",
                "bootstrap_t": "4a00000a", "bootstrap_runtime_gt": 0x4A00000A},
        },
    }))
    portable_token = hashlib.sha256(raw).hexdigest()[:8]
    quarantine = root / "quarantine"
    quarantine.mkdir()
    quarantine_path = quarantine / f"{portable_token}.lump"
    quarantine_path.write_bytes(raw)
    return root, config_path


def _admit_resident(root, *, location=336):
    raw = _portable_lump()
    digest = hashlib.sha256(raw).hexdigest()
    rows = json.loads((root / "ns-state.json").read_text())["abstractions"]
    return admit(
        quarantine_path=str(root / "quarantine" / f"{digest[:8]}.lump"),
        lumps_dir=str(root),
        state_path=str(root / "ns-state.json"),
        manifest_path=str(root / "manifest.json"),
        token=digest[:8],
        expected_digest=digest,
        name="UploadedBoot",
        revision=1,
        destination_slot=15,
        location=location,
        replace=False,
        resident=True,
        boot=True,
        authorization=_authorization(raw),
        requested=["E"],
        granted=["E"],
        lock=threading.RLock(),
        expected_namespace_fingerprint=namespace_fingerprint(rows),
    )


def _private_files(root):
    return {str(path.relative_to(root)): path.read_bytes()
            for path in root.rglob("*")
            if path.is_file() and path.name != ".namespace-commit.lock"}


@pytest.mark.parametrize("catalog_status", ["missing", "archived", "duplicate"])
def test_boot_resident_admission_builds_an_image(resident_inputs, catalog_status):
    from server.boot_image import (
        generate_boot_image, read_namespace_header_info, validate_boot_image,
    )

    root, config_path = resident_inputs
    prior_state = json.loads((root / "ns-state.json").read_text())
    selected = next(row for row in prior_state["abstractions"] if row["slot"] == 6)
    catalog_row = {key: selected[key] for key in ("filename", "token", "binary_hash")}
    catalog = {
        "missing": [],
        "archived": [{**catalog_row, "archived": True}],
        "duplicate": [catalog_row, catalog_row],
    }[catalog_status]
    # A dormant missing file must not be consulted either.
    catalog.append({"filename": "Absent.1.00000000.lump", "token": "00000000"})
    (root / "manifest.json").write_text(json.dumps(catalog))
    result = _admit_resident(root)
    assert result["mint_egt"] == "4a01000f"
    state = json.loads((root / "ns-state.json").read_text())
    row = next(entry for entry in state["abstractions"]
               if entry["slot"] == 15)
    assert row["boot"] is True
    assert row["resident"] is True
    assert row["boot_resident"] is True
    assert row["ns_slot_policy"] == "static"
    assert sum(entry.get("boot") is True for entry in state["abstractions"]) == 1
    assert state["revision"] == prior_state["revision"] + 1
    assert json.loads((root / "manifest.json").read_text())[:-1] == catalog
    assert state["abstractions"][:-1] == [
        {key: value for key, value in entry.items() if key != "boot"}
        for entry in prior_state["abstractions"]
    ]
    # The freshly admitted body is also selected by exact Namespace bytes,
    # even when catalog bookkeeping subsequently archives or omits its row.
    manifest = json.loads((root / "manifest.json").read_text())
    if catalog_status == "missing":
        manifest.pop()
    elif catalog_status == "archived":
        manifest[-1]["archived"] = True
    else:
        manifest.append(dict(manifest[-1]))
    (root / "manifest.json").write_text(json.dumps(manifest))
    before_image = _private_files(root.parent)
    config = json.loads(config_path.read_text())
    image = generate_boot_image(config, str(root), require_entry_resident=True)
    assert len(image) == config["step1"]["totalNamespaceWords"] * 4
    validate_boot_image(image)
    header = read_namespace_header_info(image)
    assert header["boot_entry_slot"] == row["slot"]
    assert header["boot_entry_word"] == row["location"]
    words = struct.unpack(f"<{len(image) // 4}I", image)
    approvals = read_approvals(str(root / "approvals.json"))
    for resident in (entry for entry in state["abstractions"] if entry.get("filename")):
        raw = (root / resident["filename"]).read_bytes()
        digest = hashlib.sha256(raw).hexdigest()
        assert digest == resident["binary_hash"]
        assert approvals[digest]["filename"] == resident["filename"]
        base = len(words) - (resident["slot"] + 1) * 4
        location = words[base]
        assert location == resident["location"]
        expected_words = struct.unpack(f">{len(raw) // 4}I", raw)
        assert words[location:location + len(expected_words)] == expected_words
        assert words[base + 3] == int(resident["token"], 16) == expected_words[-1]
    assert _private_files(root.parent) == before_image


@pytest.mark.parametrize("location", [1024, 7872])
@pytest.mark.parametrize("step2_size", [None, 64, 1])
def test_boot_generator_preserves_noncompact_admitted_location(
        resident_inputs, location, step2_size):
    """Preserve every approved body, including holes and reverse physical order."""
    from server.boot_image import (
        generate_boot_image, read_namespace_header_info, validate_boot_image,
    )

    root, config_path = resident_inputs
    _admit_resident(root, location=location)
    state = json.loads((root / "ns-state.json").read_text())
    selected = next(row for row in state["abstractions"] if row.get("boot") is True)
    config = json.loads(config_path.read_text())
    if step2_size is not None:
        config["step2"] = {"lumps": [{
            "nsSlot": selected["slot"], "resident": True,
            "physAddr": location, "lumpSize": step2_size,
        }]}
        config_path.write_text(json.dumps(config))
    before = _private_files(root.parent)
    image = generate_boot_image(config, str(root), require_entry_resident=True)
    validate_boot_image(image)  # Hardware profile, not simulation-only validation.
    header = read_namespace_header_info(image)
    assert header["boot_entry_word"] == selected["location"] == location
    assert header["boot_entry_slot"] == selected["slot"]
    words = struct.unpack(f"<{len(image) // 4}I", image)
    for resident in (row for row in state["abstractions"] if row.get("filename")):
        raw = (root / resident["filename"]).read_bytes()
        expected = struct.unpack(f">{len(raw) // 4}I", raw)
        base = len(words) - (resident["slot"] + 1) * 4
        assert words[base] == resident["location"]
        assert words[resident["location"]:resident["location"] + len(expected)] == expected
        assert words[base + 3] == int(resident["token"], 16) == expected[-1]
    assert words[336:400] == (0,) * 64  # No copy at the old compact destination.
    assert _private_files(root.parent) == before


@pytest.mark.parametrize("damage", ["none", "mismatched-step2", "overlap"])
def test_boot_generator_step2_resident_in_gap(resident_inputs, damage):
    """A repeated Step-2 placement below SelfTest is not a competing claim."""
    from server.boot_image import generate_boot_image

    root, config_path = resident_inputs
    _admit_resident(root)
    state_path = root / "ns-state.json"
    state = json.loads(state_path.read_text())
    selected = next(row for row in state["abstractions"] if row["slot"] == 15)
    selected["location"] = 384 if damage == "overlap" else 336
    state_path.write_text(json.dumps(state))
    config = json.loads(config_path.read_text())
    config["step2"] = {"lumps": [{
        "nsSlot": 15, "resident": True, "lumpSize": 1,
        "physAddr": 1024 if damage == "mismatched-step2" else selected["location"],
    }]}
    config_path.write_text(json.dumps(config))
    before = _private_files(root.parent)
    if damage == "none":
        image = generate_boot_image(config, str(root), require_entry_resident=True)
        words = struct.unpack(f"<{len(image) // 4}I", image)
        assert words[-16 * 4] == 336
        raw = (root / selected["filename"]).read_bytes()
        assert words[336:400] == struct.unpack(">64I", raw)
    else:
        match = ("disagrees with Namespace state" if damage == "mismatched-step2"
                 else r"overlaps NS\[15\]")
        with pytest.raises(ValueError, match=match):
            generate_boot_image(config, str(root), require_entry_resident=True)
    assert _private_files(root.parent) == before


@pytest.mark.parametrize("location,match", [
    (256, r"overlaps NS\[1\]"),
    (300, r"overlaps NS\[10\]"),
    (384, r"overlaps NS\[15\]"),  # SelfTest is claimed after the uploaded body.
    (0, r"reserved header/table"),
    (7904, r"reserved header/table"),
    (8192, r"exceeds image bounds"),
    (-1, r"nonnegative word address"),
    (True, r"nonnegative word address"),
    ("invalid", r"nonnegative word address"),
    (None, r"no saved Namespace location"),
])
def test_boot_generator_rejects_invalid_saved_placement(resident_inputs, location, match):
    """Generation independently rejects damaged layouts without repairing inputs."""
    from server.boot_image import generate_boot_image

    root, config_path = resident_inputs
    _admit_resident(root, location=1024)
    state_path = root / "ns-state.json"
    state = json.loads(state_path.read_text())
    selected = next(row for row in state["abstractions"] if row["slot"] == 15)
    if location is None:
        selected.pop("location")
    else:
        selected["location"] = location
    state_path.write_text(json.dumps(state))
    before = _private_files(root.parent)
    with pytest.raises(ValueError, match=match):
        generate_boot_image(json.loads(config_path.read_text()), str(root),
                            require_entry_resident=True)
    assert _private_files(root.parent) == before


@pytest.mark.parametrize("secondary_location", [None, 1536, 1056])
def test_boot_generator_keeps_threads_clear_of_noncompact_residents(
        resident_inputs, secondary_location):
    from server.boot_image import generate_boot_image

    root, config_path = resident_inputs
    _admit_resident(root, location=1024)
    state_path = root / "ns-state.json"
    state = json.loads(state_path.read_text())
    next(row for row in state["abstractions"] if row["slot"] == 1)["location"] = 512
    if secondary_location is not None:
        state["abstractions"].append({
            "slot": 11, "name": "Thread.2", "type": "Thread",
            "location": secondary_location, "seq": 0,
        })
    state_path.write_text(json.dumps(state))
    config = json.loads(config_path.read_text())
    config["step1"]["threadCount"] = 2
    config_path.write_text(json.dumps(config))
    before = _private_files(root.parent)
    if secondary_location == 1056:
        with pytest.raises(ValueError, match=r"NS\[11\].*overlaps NS\[15\]"):
            generate_boot_image(config, str(root), require_entry_resident=True)
    else:
        image = generate_boot_image(config, str(root), require_entry_resident=True)
        words = struct.unpack(f"<{len(image) // 4}I", image)
        assert words[-2 * 4] == 512
        assert words[-12 * 4] == (
            secondary_location if secondary_location is not None else 1088)
        raw = (root / next(row["filename"] for row in state["abstractions"]
                          if row["slot"] == 15)).read_bytes()
        assert words[1024:1088] == struct.unpack(">64I", raw)
    assert _private_files(root.parent) == before


@pytest.mark.parametrize("damage,match", [
    ("missing-config", r"NS\[1\] allocation cannot be established"),
    ("missing-location", r"NS\[15\] allocation cannot be established"),
    ("thread-overlap", r"overlaps NS\[1\]"),
    ("resident-overlap", r"overlaps NS\[6\]"),
    ("header-overlap", r"reserved Namespace header"),
    ("table-overlap", r"reserved Namespace table"),
    ("outside-ram", r"exceeds Namespace RAM"),
])
def test_invalid_resident_allocation_publishes_nothing(resident_inputs, damage, match):
    root, config_path = resident_inputs
    location = {"missing-location": None, "thread-overlap": 256,
                "resident-overlap": 384, "header-overlap": 0,
                "table-overlap": 7920, "outside-ram": 8192}.get(damage, 336)
    if damage == "missing-config":
        config_path.unlink()
    if damage == "header-overlap":
        state_path = root / "ns-state.json"
        state = json.loads(state_path.read_text())
        state["abstractions"][1]["location"] = 128
        state_path.write_text(json.dumps(state))
    before = _private_files(root.parent)
    with pytest.raises(AdmissionError, match=match) as error:
        _admit_resident(root, location=location)
    assert error.value.status == 409
    assert _private_files(root.parent) == before
    assert not (root / NavanaService.JOURNAL_NAME).exists()
    assert not list(root.glob(".navana-*"))