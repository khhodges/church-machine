import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess

import pytest

from scripts.migrate_bootstrap_residents import (
    CURRENT_CAPABILITY, SOURCE_CAPABILITY, _validate_stage, migrate,
)
from bootstrap_test_support import select_bootstrap_residents


def _historical_migration_fixture(catalog):
    """Reconstruct the reviewed migration inputs, retaining immutable bodies."""
    select_bootstrap_residents(catalog)
    manifest_path = catalog / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    for artifact in (SOURCE_CAPABILITY, CURRENT_CAPABILITY):
        body = (catalog / artifact["filename"]).read_bytes()
        assert hashlib.sha256(body).hexdigest() == artifact["sha256"]
        matches = [row for row in manifest
                   if row.get("filename") == artifact["filename"]
                   and row.get("token") == artifact["token"]]
        assert len(matches) == 1
        matches[0].pop("archived", None)
    # The repository now has a later CapabilityTest publication. Recreate the
    # exact reviewed pre-migration manifest in this disposable copy only.
    for row in manifest:
        if (row.get("abstraction") == "CapabilityTest"
                and row["filename"] not in {
                    SOURCE_CAPABILITY["filename"], CURRENT_CAPABILITY["filename"],
                }):
            row["archived"] = True
    manifest_path.write_text(json.dumps(manifest))
    state_path = catalog / "ns-state.json"
    state = json.loads(state_path.read_text())
    resident = next(row for row in state["abstractions"]
                    if row.get("name") == "CapabilityTest")
    resident.update({key: SOURCE_CAPABILITY[key]
                     for key in ("slot", "filename", "token")})
    resident["binary_hash"] = SOURCE_CAPABILITY["sha256"]
    resident["boot"] = True
    state["abstractions"] = [row for row in state["abstractions"]
                             if row.get("name") != "UART_DEV"]
    state_path.write_text(json.dumps(state))


def _snapshot(root):
    return {str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in root.rglob("*") if path.is_file() and not path.is_symlink()}


@pytest.fixture(scope="module")
def migrated_retention_catalog(tmp_path_factory):
    catalog = tmp_path_factory.mktemp("bootstrap-retention") / "lumps"
    source = Path(__file__).resolve().parents[2] / "server" / "lumps"
    shutil.copytree(source, catalog, symlinks=True)
    _historical_migration_fixture(catalog)
    approvals = (catalog / "approvals.json").read_bytes()
    ledger = (catalog / "history-retention.json").read_bytes()
    migrate(catalog)
    assert (catalog / "approvals.json").read_bytes() == approvals
    assert (catalog / "history-retention.json").read_bytes() == ledger
    return catalog


@pytest.mark.parametrize("case", [
    "completed", "legacy_completed", "missing_ledger", "wrong_filename",
    "wrong_digest", "wrong_token", "pending", "journal", "malformed",
    "manifest", "namespace", "config", "provenance", "bad_approval_hash",
    "bad_approval_key", "bad_approval_record", "bad_approval_map",
    "missing_resident",
])
def test_stage_retention_evidence_is_exact_and_read_only(
        tmp_path, migrated_retention_catalog, case):
    catalog = tmp_path / "lumps"
    shutil.copytree(migrated_retention_catalog, catalog, symlinks=True)
    digest = hashlib.sha256(b"deleted historical test artifact").hexdigest()
    filename = "DeletedHistory.1.12345678.lump"
    approval_path = catalog / "approvals.json"
    envelope = json.loads(approval_path.read_text())
    record = {"filename": filename, "binary_hash": digest, "token": "12345678"}
    envelope["approvals"][digest] = record
    ledger_path = catalog / "history-retention.json"
    ledger = json.loads(ledger_path.read_text())
    evidence = {
        "filename": filename, "binary_hash": digest, "version": 1,
        "status": "deleted", "deleted_at": 1700000000,
    }
    ledger["12345678"] = [evidence]
    if case == "legacy_completed":
        evidence.pop("status")
    elif case == "wrong_filename":
        evidence["filename"] = "Other.1.12345678.lump"
    elif case == "wrong_digest":
        evidence["binary_hash"] = "a" * 64
    elif case == "wrong_token":
        record["token"] = "87654321"
    elif case == "pending":
        evidence["status"] = "pending"
    elif case == "journal":
        (catalog / ".history-retention-pending.json").write_text("{}")
    elif case == "malformed":
        evidence.pop("deleted_at")
    elif case == "bad_approval_hash":
        record["binary_hash"] = "a" * 64
    elif case == "bad_approval_key":
        envelope["approvals"]["not-a-sha256"] = envelope["approvals"].pop(digest)
    elif case == "bad_approval_record":
        envelope["approvals"][digest] = []
    elif case == "bad_approval_map":
        envelope["approvals"] = []
    elif case == "manifest":
        path = catalog / "manifest.json"
        manifest = json.loads(path.read_text())
        manifest.append({"filename": filename, "archived": True})
        path.write_text(json.dumps(manifest))
    elif case in ("namespace", "config", "provenance"):
        name = {"namespace": "ns-state.json", "config": "boot-config.json",
                "provenance": "boot-image.provenance.json"}[case]
        path = catalog / name
        document = json.loads(path.read_text()) if path.exists() else {}
        document["artifactBindings"] = [{"filename": filename}]
        path.write_text(json.dumps(document))
    elif case == "missing_resident":
        state = json.loads((catalog / "ns-state.json").read_text())
        resident = next(row for row in state["abstractions"]
                        if row.get("name") == "SelfTest")
        body = catalog / resident["filename"]
        resident_digest = hashlib.sha256(body.read_bytes()).hexdigest()
        resident_record = envelope["approvals"][resident_digest]
        ledger.setdefault(resident_record["bootstrap_t"], []).append({
            **evidence, "filename": body.name, "binary_hash": resident_digest,
        })
        body.unlink()
    approval_path.write_text(json.dumps(envelope))
    ledger_path.write_text(json.dumps(ledger))
    if case == "missing_ledger":
        ledger_path.unlink()
    before = _snapshot(catalog)
    if case in ("completed", "legacy_completed"):
        _validate_stage(catalog)
    else:
        with pytest.raises(ValueError):
            _validate_stage(catalog)
    assert _snapshot(catalog) == before


def test_fault_before_swap_leaves_complete_catalog_unchanged(tmp_path):
    source = Path(__file__).resolve().parents[2] / "server" / "lumps"
    catalog = tmp_path / "lumps"
    shutil.copytree(source, catalog, symlinks=True)
    _historical_migration_fixture(catalog)
    before = _snapshot(catalog)
    with pytest.raises(RuntimeError, match="injected"):
        migrate(catalog, fault_after_stage=True)
    assert _snapshot(catalog) == before


def test_fault_during_atomic_exchange_rolls_back_without_missing_target(tmp_path):
    source = Path(__file__).resolve().parents[2] / "server" / "lumps"
    catalog = tmp_path / "lumps"
    shutil.copytree(source, catalog, symlinks=True)
    _historical_migration_fixture(catalog)
    before = _snapshot(catalog)
    with pytest.raises(RuntimeError, match="publication"):
        migrate(catalog, fault_during_publication=True)
    assert catalog.is_dir()
    assert _snapshot(catalog) == before


def test_duplicate_resident_row_is_rejected_before_atomic_exchange(tmp_path):
    source = Path(__file__).resolve().parents[2] / "server" / "lumps"
    catalog = tmp_path / "lumps"
    shutil.copytree(source, catalog, symlinks=True)
    _historical_migration_fixture(catalog)
    state_path = catalog / "ns-state.json"
    state = json.loads(state_path.read_text())
    original = next(row for row in state["abstractions"]
                    if row.get("name") == "WukongCallHome")
    state["abstractions"].append(dict(original))
    state_path.write_text(json.dumps(state))
    before = _snapshot(catalog)
    with pytest.raises(subprocess.CalledProcessError):
        migrate(catalog)
    # The caller's invalid catalog remains intact; staging never published.
    assert _snapshot(catalog) == before
    assert len([row for row in json.loads(state_path.read_text())["abstractions"]
                if row.get("name") == "WukongCallHome"]) == 2


def test_wukong_rebuild_archives_displaced_bytes_without_deleting_them(tmp_path):
    root = Path(__file__).resolve().parents[2]
    catalog = tmp_path / "lumps"
    shutil.copytree(root / "server" / "lumps", catalog, symlinks=True)
    manifest = json.loads((catalog / "manifest.json").read_text())
    displaced = [row for row in manifest if row.get("abstraction") == "WukongCallHome"
                 and (catalog / row.get("filename", "")).is_file()]
    before = {row["filename"]: (catalog / row["filename"]).read_bytes()
              for row in displaced}
    subprocess.run(["node", str(root / "scripts" / "build_wukong_callhome_lump.js"),
                    "--out-dir", str(catalog)], cwd=root, check=True)
    after = json.loads((catalog / "manifest.json").read_text())
    assert all((catalog / filename).read_bytes() == raw for filename, raw in before.items())
    active = [row for row in after if row.get("abstraction") == "WukongCallHome"
              and not row.get("archived", False)]
    assert len(active) == 1
    assert all(row.get("archived", False) for row in after
               if row.get("abstraction") == "WukongCallHome"
               and row["filename"] != active[0]["filename"])


def test_capability_rebuild_archives_displaced_bytes_and_approvals(tmp_path):
    root = Path(__file__).resolve().parents[2]
    catalog = tmp_path / "lumps"
    shutil.copytree(root / "server" / "lumps", catalog, symlinks=True)
    manifest = json.loads((catalog / "manifest.json").read_text())
    displaced = [
        row for row in manifest
        if row.get("abstraction") == "CapabilityTest"
        and (catalog / row.get("filename", "")).is_file()
        and not (catalog / row.get("filename", "")).is_symlink()
    ]
    before_bodies = {row["filename"]: (catalog / row["filename"]).read_bytes()
                     for row in displaced}
    before_approvals = json.loads((catalog / "approvals.json").read_text())["approvals"]
    historical_digests = {
        hashlib.sha256(raw).hexdigest() for raw in before_bodies.values()
        if hashlib.sha256(raw).hexdigest() in before_approvals
    }
    # Success-path fixture excludes compatibility aliases, not immutable
    # bodies. A separate test below constructs an exact content-ID collision
    # and requires the builder to refuse it without any repository mutation.
    for alias in catalog.glob("CapabilityTest.*.lump"):
        if alias.is_symlink():
            alias.unlink()
    subprocess.run(["node", str(root / "scripts" / "build_capability_test_lump.js"),
                    "--out-dir", str(catalog)], cwd=root, check=True)
    after = json.loads((catalog / "manifest.json").read_text())
    after_approvals = json.loads((catalog / "approvals.json").read_text())["approvals"]
    assert all((catalog / filename).read_bytes() == raw
               for filename, raw in before_bodies.items())
    assert historical_digests <= set(after_approvals)
    active = [row for row in after if row.get("abstraction") == "CapabilityTest"
              and not row.get("archived", False)]
    assert len(active) == 1
    raw = (catalog / active[0]["filename"]).read_bytes()
    words = [int.from_bytes(raw[i:i + 4], "big") for i in range(0, len(raw), 4)]
    cw = (words[0] >> 10) & 0x1FFF
    code = words[1:1 + cw]
    assert not any(word >> 27 in (8, 9) for word in code)
    # SELF insertion moves WukongCallHome from declaration row 6 to row 7.
    # Method zero encodes as selector one in imm[14:5]; row is imm[4:0].
    assert any(word >> 27 == 2 and (word >> 15) & 15 == 6
               and (word >> 19) & 15 == 0 and word & 0x7FFF == (1 << 5) | 7
               for word in code)
    assert all(row.get("archived", False) for row in after
               if row.get("abstraction") == "CapabilityTest"
               and row["filename"] != active[0]["filename"])


def test_capability_rebuild_refuses_content_id_collision_without_data_loss(tmp_path):
    root = Path(__file__).resolve().parents[2]
    catalog = tmp_path / "lumps"
    shutil.copytree(root / "server/lumps", catalog, symlinks=True)
    # Determine the builder's exact intended name from a separate disposable
    # build, then occupy that content ID with different immutable bytes.
    probe = tmp_path / "probe"
    shutil.copytree(catalog, probe, symlinks=True)
    subprocess.run(
        ["node", str(root / "scripts/build_capability_test_lump.js"),
         "--out-dir", str(probe)], cwd=root, check=True, capture_output=True)
    built = json.loads((probe / "manifest.json").read_text())
    active = [row for row in built if row.get("abstraction") == "CapabilityTest"
              and row.get("archived") is not True]
    assert len(active) == 1
    collision = catalog / active[0]["filename"]
    if collision.exists():
        assert collision.read_bytes() == (probe / collision.name).read_bytes()
    collision.write_bytes(b"immutable historical collision")
    before = _snapshot(catalog)
    links = {path.name: path.readlink() for path in catalog.iterdir()
             if path.is_symlink()}
    result = subprocess.run(
        ["node", str(root / "scripts/build_capability_test_lump.js"),
         "--out-dir", str(catalog)], cwd=root, capture_output=True, text=True)
    assert result.returncode != 0
    assert "content-id collision" in result.stderr
    assert _snapshot(catalog) == before
    assert {path.name: path.readlink() for path in catalog.iterdir()
            if path.is_symlink()} == links


def test_wukong_rebuild_refuses_content_id_collision_without_data_loss(tmp_path):
    root = Path(__file__).resolve().parents[2]
    catalog = tmp_path / "lumps"
    shutil.copytree(root / "server" / "lumps", catalog, symlinks=True)
    state = json.loads((catalog / "ns-state.json").read_text())
    row = next(entry for entry in state["abstractions"]
               if entry.get("name") == "WukongCallHome")
    body = catalog / row["filename"]
    collision_bytes = b"immutable historical collision"
    body.write_bytes(collision_bytes)
    result = subprocess.run(
        ["node", str(root / "scripts" / "build_wukong_callhome_lump.js"),
         "--out-dir", str(catalog)],
        cwd=root, capture_output=True, text=True)
    assert result.returncode != 0
    assert "content-id collision" in result.stderr
    assert body.read_bytes() == collision_bytes


@pytest.mark.parametrize("target", ["code", "row0", "dependency"])
def test_loaded_capability_body_drift_is_rejected_before_publication(tmp_path, target):
    source = Path(__file__).resolve().parents[2] / "server" / "lumps"
    catalog = tmp_path / "lumps"
    shutil.copytree(source, catalog, symlinks=True)
    _historical_migration_fixture(catalog)
    migrate(catalog)
    state = json.loads((catalog / "ns-state.json").read_text())
    row = next(entry for entry in state["abstractions"]
               if entry.get("name") == "CapabilityTest")
    image_path = catalog / "boot-image.bin"
    image = bytearray(image_path.read_bytes())
    words = list(struct.unpack(f"<{len(image) // 4}I", image))
    ns_base = len(words) - (row["slot"] + 1) * 4
    location = words[ns_base]
    header = words[location]
    allocation = 1 << (((header >> 23) & 0xF) + 6)
    cc = header & 0xFF
    offsets = {
        "code": location + 1,
        "row0": location + allocation - cc,
        "dependency": location + allocation - 1,
    }
    words[offsets[target]] ^= 1
    image_path.write_bytes(struct.pack(f"<{len(words)}I", *words))
    with pytest.raises(ValueError, match="loaded resident body drift"):
        _validate_stage(catalog)