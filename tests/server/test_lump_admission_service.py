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
    validate_active_manifest_selections,
)
from server.lump_approvals import read_approvals


def _portable_lump():
    words = [((0x1F << 27) | (1 << 10) | 1)] + [0] * 62
    words[1] = 0x1F000000
    words.append(0x4A000006)
    return struct.pack(">64I", *words)


def _authorization(raw):
    return {"grants": ["E"], "capabilities": derive_capability_targets(raw)}


def test_archived_only_namespace_selector_is_rejected_before_state_changes(
        tmp_path):
    digest = "a" * 64
    rows = [{
        "slot": 14,
        "filename": "Example_v1.lump",
        "binary_hash": digest,
    }]
    manifest = [{
        "token": digest[:8],
        "filename": "Example_v1.lump",
        "binary_hash": digest,
        "archived": True,
    }]
    (tmp_path / "Example_v1.lump").write_bytes(b"archived")
    committed = tmp_path / "ns-state.json"
    original = {"revision": 7, "abstractions": []}
    committed.write_text(json.dumps(original))

    with pytest.raises(AdmissionError, match="exactly one active manifest row"):
        validate_active_manifest_selections(rows, manifest, str(tmp_path))

    assert json.loads(committed.read_text()) == original


def test_duplicate_active_namespace_selectors_are_rejected(tmp_path):
    raw = b"active"
    digest = hashlib.sha256(raw).hexdigest()
    filename = "Example.1.12345678.lump"
    (tmp_path / filename).write_bytes(raw)
    row = {"slot": 14, "filename": filename, "binary_hash": digest}
    active = {"token": digest[:8], "filename": filename}

    with pytest.raises(AdmissionError, match="exactly one active manifest row"):
        validate_active_manifest_selections(
            [row], [active, dict(active)], str(tmp_path))


def test_real_admission_atomically_publishes_derivative_and_evidence(tmp_path):
    raw = _portable_lump()
    token = hashlib.sha256(raw).hexdigest()[:8]
    quarantine = tmp_path / "quarantine"
    quarantine.mkdir()
    quarantine_path = quarantine / f"{token}.lump"
    quarantine_path.write_bytes(raw)
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text("[]")
    state_path = tmp_path / "ns-state.json"
    state_path.write_text(json.dumps({"revision": 0, "abstractions": []}))

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


def test_boot_resident_admission_builds_an_image(tmp_path):
    import shutil
    from pathlib import Path

    from server.boot_image import generate_boot_image

    root = tmp_path / "lumps"
    repository_root = Path(__file__).resolve().parents[2]
    shutil.copytree(repository_root / "server" / "lumps", root)
    # Admission intentionally retains the stricter catalog-publication gate.
    # Make this private fixture internally current instead of inheriting stale
    # archived flags from the repository's catalog-history test data.
    state_fixture = json.loads((root / "ns-state.json").read_text())
    manifest_fixture = json.loads((root / "manifest.json").read_text())
    for binding in state_fixture.get("abstractions", []):
        filename = binding.get("filename") if isinstance(binding, dict) else None
        matches = [
            row for row in manifest_fixture
            if isinstance(row, dict) and row.get("filename") == filename
        ]
        if filename and len(matches) == 1:
            matches[0].pop("archived", None)
    (root / "manifest.json").write_text(json.dumps(manifest_fixture))
    raw = _portable_lump()
    portable_token = hashlib.sha256(raw).hexdigest()[:8]
    quarantine = root / "quarantine"
    quarantine.mkdir(exist_ok=True)
    quarantine_path = quarantine / f"{portable_token}.lump"
    quarantine_path.write_bytes(raw)

    result = admit(
        quarantine_path=str(quarantine_path),
        lumps_dir=str(root),
        state_path=str(root / "ns-state.json"),
        manifest_path=str(root / "manifest.json"),
        token=portable_token,
        expected_digest=hashlib.sha256(raw).hexdigest(),
        name="UploadedBoot",
        revision=1,
        destination_slot=15,
        replace=False,
        resident=True,
        boot=True,
        authorization=_authorization(raw),
        requested=["E"],
        granted=["E"],
        lock=threading.RLock(),
    )
    assert result["token"] == "4a01000f"
    state = json.loads((root / "ns-state.json").read_text())
    row = next(entry for entry in state["abstractions"]
               if entry["slot"] == 15)
    assert row["boot"] is True
    assert row["resident"] is True
    assert row["boot_resident"] is True
    assert row["ns_slot_policy"] == "static"
    assert sum(entry.get("boot") is True for entry in state["abstractions"]) == 1

    config = json.loads(
        (repository_root / "server" / "boot-config.json").read_text())
    image = generate_boot_image(config, str(root))
    assert image