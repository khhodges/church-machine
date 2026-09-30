"""Read-only Namespace/image revision admission, using private fixture storage."""
import hashlib
import json
import struct
import subprocess
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
from server import boot_image as bi
from scripts.check_namespace_authority import audit
from test_full_body_ranges import fixture_words, move


def snapshot(root):
    return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in root.rglob("*") if p.is_file()}


def fixture(root):
    rows = [{"slot": 0, "name": "Boot.NS", "type": "Inform"},
            {"slot": 1, "name": "Boot.Thread", "type": "Inform"}]
    (root / "ns-state.json").write_text(json.dumps({"abstractions": rows}))
    words = fixture_words()
    image = struct.pack(f"<{len(words)}I", *words)
    (root / "boot-image.bin").write_bytes(image)
    provenance = bi.build_boot_image_provenance(image, str(root))
    (root / "boot-image.provenance.json").write_text(json.dumps(provenance))
    return rows, image, provenance


def test_valid_revision_is_read_only(tmp_path):
    fixture(tmp_path)
    before = snapshot(tmp_path)
    assert audit(tmp_path)["ok"]
    assert snapshot(tmp_path) == before


def test_artifact_allocation_is_not_capability_access_limit(tmp_path):
    rows, image, _ = fixture(tmp_path)
    words = struct.unpack(f"<{len(image) // 4}I", image)
    raw = struct.pack(">256I", *words[1408:1664])
    (tmp_path / "sample.lump").write_bytes(raw)
    rows.append({"slot": 6, "name": "Example", "type": "Inform",
                 "resident": True, "filename": "sample.lump", "seq": 0,
                 "binary_hash": hashlib.sha256(raw).hexdigest()})
    (tmp_path / "ns-state.json").write_text(json.dumps({"abstractions": rows}))
    provenance = bi.build_boot_image_provenance(image, str(tmp_path))
    (tmp_path / "boot-image.provenance.json").write_text(json.dumps(provenance))
    before = snapshot(tmp_path)
    assert audit(tmp_path)["ok"]
    assert snapshot(tmp_path) == before


def test_pet_name_revision_change_invalidates_image(tmp_path):
    rows, _, _ = fixture(tmp_path)
    rows[1]["name"] = "renamed.Thread"
    (tmp_path / "ns-state.json").write_text(json.dumps({"abstractions": rows}))
    before = snapshot(tmp_path)
    result = audit(tmp_path)
    assert not result["ok"]
    assert "Namespace revision" in " ".join(result["errors"])
    assert snapshot(tmp_path) == before


def test_missing_revision_provenance_is_not_silently_upgraded(tmp_path):
    _, _, provenance = fixture(tmp_path)
    provenance.pop("namespace_fingerprint")
    (tmp_path / "boot-image.provenance.json").write_text(json.dumps(provenance))
    before = snapshot(tmp_path)
    assert not audit(tmp_path)["ok"]
    assert snapshot(tmp_path) == before


def test_mixed_design_and_executable_state_rejected_without_writes(tmp_path):
    rows, _, _ = fixture(tmp_path)
    rows.append({"slot": 15, "name": "ide.Mallory", "symbolic": True,
                 "implementationMissing": True, "resident": True,
                 "token": "04b2913d", "filename": "ide.Mallory.lump"})
    (tmp_path / "ns-state.json").write_text(json.dumps({"abstractions": rows}))
    before = snapshot(tmp_path)
    result = audit(tmp_path)
    assert not result["ok"]
    assert any(error.startswith("Namespace state:") for error in result["errors"])
    assert snapshot(tmp_path) == before


def test_full_body_overlap_cannot_be_published(tmp_path):
    fixture(tmp_path)
    words = fixture_words()
    move(words, 7, 0x110, 1024, 3)
    move(words, 14, 0x400, 256, 0)
    (tmp_path / "boot-image.bin").write_bytes(struct.pack(f"<{len(words)}I", *words))
    before = snapshot(tmp_path)
    result = audit(tmp_path)
    assert not result["ok"]
    assert "overlaps" in " ".join(result["errors"])
    assert snapshot(tmp_path) == before


def test_unavailable_inputs_fail_closed(tmp_path):
    result = audit(tmp_path)
    assert not result["ok"]
    assert len(result["errors"]) == 2
    assert not list(tmp_path.iterdir())


def test_post_merge_stops_before_sync_on_invalid_bundle(tmp_path):
    """Mock external commands; never run real GitHub sync or touch live data."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for name, body in {
        "git": "printf 'server/lumps/ns-state.json\\n'\n",
        "python3": "echo gate-called; exit 1\n",
        "flock": "echo SHOULD-NOT-SYNC; exit 99\n",
    }.items():
        executable = bin_dir / name
        executable.write_text("#!/bin/sh\n" + body)
        executable.chmod(0o755)
    script = Path(__file__).resolve().parents[2] / "scripts/post-merge.sh"
    result = subprocess.run(["bash", str(script)], cwd=tmp_path,
                            env={**os.environ, "PATH": str(bin_dir) + ":" + os.environ["PATH"]},
                            text=True, capture_output=True)
    assert result.returncode == 1
    assert "gate-called" in result.stdout
    assert "publication blocked" in result.stderr
    assert "SHOULD-NOT-SYNC" not in result.stdout