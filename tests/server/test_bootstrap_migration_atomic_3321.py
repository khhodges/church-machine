import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess

import pytest

from scripts.migrate_bootstrap_residents import _validate_stage, migrate


@pytest.fixture
def historical_catalog(tmp_path):
    """A private, explicitly pre-migration Namespace with reviewed historical bodies.

    The repository catalog is already migrated; its active bindings must not
    determine the source state of this historical transition test.
    """
    root = Path(__file__).resolve().parents[2]
    catalog = tmp_path / "lumps"
    shutil.copytree(root / "server" / "lumps", catalog, symlinks=True)
    shutil.copyfile(root / "server" / "boot-config.json", tmp_path / "boot-config.json")
    state_path = catalog / "ns-state.json"
    state = json.loads(state_path.read_text())
    current = next(row for row in state["abstractions"]
                   if row.get("name") == "CapabilityTest" and row.get("slot") == 10)
    state["abstractions"].remove(current)
    state["abstractions"] = [
        row for row in state["abstractions"] if row.get("slot") != 2
    ]
    source = dict(current)
    source.update(slot=2, token="4a000002",
                  filename="CapabilityTest.2.6fd9df21.lump",
                  binary_hash="1ec3fd949e040d4ea851f8d93f1bd54230679f2e8b7fca07e6d586c4335d475c",
                  issue_n=2, lump_version=27, boot=True)
    state["abstractions"].append(source)
    state_path.write_text(json.dumps(state, indent=2))
    manifest_path = catalog / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    for row in manifest:
        if row.get("filename") in ("CapabilityTest.2.6fd9df21.lump",
                                    "CapabilityTest.1.e2b69e5b.lump"):
            row.pop("archived", None)
    manifest_path.write_text(json.dumps(manifest, indent=2))
    config_path = tmp_path / "boot-config.json"
    config = json.loads(config_path.read_text())
    config["bootEntrySlot"] = 2
    config_path.write_text(json.dumps(config, indent=2))
    return catalog


def _snapshot(root):
    return {str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in root.rglob("*") if path.is_file() and not path.is_symlink()}


def test_fault_before_swap_leaves_complete_catalog_unchanged(historical_catalog):
    catalog = historical_catalog
    before = _snapshot(catalog)
    with pytest.raises(RuntimeError, match="injected"):
        migrate(catalog, fault_after_stage=True)
    assert _snapshot(catalog) == before


def test_fault_during_atomic_exchange_rolls_back_without_missing_target(historical_catalog):
    catalog = historical_catalog
    before = _snapshot(catalog)
    with pytest.raises(RuntimeError, match="publication"):
        migrate(catalog, fault_during_publication=True)
    assert catalog.is_dir()
    assert _snapshot(catalog) == before


def test_duplicate_resident_row_is_rejected_before_atomic_exchange(historical_catalog):
    catalog = historical_catalog
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
    # Simulate a stale alias only in this private catalog. A production rebuild
    # must reject it rather than overwrite the conflicting historical locator.
    colliding_alias = catalog / "CapabilityTest.2.35647a26.lump"
    approved_bytes = colliding_alias.read_bytes()
    assert hashlib.sha256(approved_bytes).hexdigest() == (
        "bda0d44f551a4b5b55a04e1b630fe2889ed024ab4a7dd42d7381c4334f9c92fc"
    )
    colliding_alias.unlink()
    colliding_alias.symlink_to("CapabilityTest.1.3f7e1c54.lump")
    before_collision = _snapshot(catalog)
    result = subprocess.run(
        ["node", str(root / "scripts" / "build_capability_test_lump.js"),
         "--out-dir", str(catalog)],
        cwd=root, capture_output=True, text=True)
    assert result.returncode != 0
    assert "content-id collision" in result.stderr
    assert _snapshot(catalog) == before_collision
    colliding_alias.unlink()
    colliding_alias.write_bytes(approved_bytes)
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
    assert all(row.get("archived", False) for row in after
               if row.get("abstraction") == "CapabilityTest"
               and row["filename"] != active[0]["filename"])


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
def test_loaded_capability_body_drift_is_rejected_before_publication(
        historical_catalog, target):
    catalog = historical_catalog
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