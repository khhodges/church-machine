import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess

import pytest

from scripts.migrate_bootstrap_residents import _validate_stage, migrate


def _snapshot(root):
    return {str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest()
            for path in root.rglob("*") if path.is_file() and not path.is_symlink()}


def test_fault_before_swap_leaves_complete_catalog_unchanged(tmp_path):
    source = Path(__file__).resolve().parents[2] / "server" / "lumps"
    catalog = tmp_path / "lumps"
    shutil.copytree(source, catalog, symlinks=True)
    before = _snapshot(catalog)
    with pytest.raises(RuntimeError, match="injected"):
        migrate(catalog, fault_after_stage=True)
    assert _snapshot(catalog) == before


def test_fault_during_atomic_exchange_rolls_back_without_missing_target(tmp_path):
    source = Path(__file__).resolve().parents[2] / "server" / "lumps"
    catalog = tmp_path / "lumps"
    shutil.copytree(source, catalog, symlinks=True)
    before = _snapshot(catalog)
    with pytest.raises(RuntimeError, match="publication"):
        migrate(catalog, fault_during_publication=True)
    assert catalog.is_dir()
    assert _snapshot(catalog) == before


def test_duplicate_resident_row_is_rejected_before_atomic_exchange(tmp_path):
    source = Path(__file__).resolve().parents[2] / "server" / "lumps"
    catalog = tmp_path / "lumps"
    shutil.copytree(source, catalog, symlinks=True)
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
    displaced = [row for row in manifest if row.get("abstraction") == "CapabilityTest"
                 and (catalog / row.get("filename", "")).is_file()]
    before_bodies = {row["filename"]: (catalog / row["filename"]).read_bytes()
                     for row in displaced}
    before_approvals = json.loads((catalog / "approvals.json").read_text())["approvals"]
    historical_digests = {
        hashlib.sha256(raw).hexdigest() for raw in before_bodies.values()
        if hashlib.sha256(raw).hexdigest() in before_approvals
    }
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
def test_loaded_capability_body_drift_is_rejected_before_publication(tmp_path, target):
    source = Path(__file__).resolve().parents[2] / "server" / "lumps"
    catalog = tmp_path / "lumps"
    shutil.copytree(source, catalog, symlinks=True)
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