import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile

import pytest

from server.build_staging import staging_archive, verified_source_archive


def _archive(files, links=None):
    result = io.BytesIO()
    with tarfile.open(fileobj=result, mode="w") as archive:
        for name, data in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            archive.addfile(info, io.BytesIO(data))
        for name, target in (links or {}).items():
            info = tarfile.TarInfo(name)
            info.type = tarfile.SYMTYPE
            info.linkname = target
            archive.addfile(info)
    return result.getvalue()


def test_real_git_archive_keeps_safe_links_and_hardware_relative_preflight(tmp_path):
    root = Path(__file__).resolve().parents[2]
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
    source = verified_source_archive(str(root), commit)
    with tarfile.open(fileobj=io.BytesIO(source)) as archive:
        tcl = archive.extractfile("hardware/wukong_xc7a100t.tcl").read()
        links = [member.name for member in archive if member.issym()]
    assert links, "Real source archive must exercise its tracked symlinks"
    overlay = _archive({"hardware/wukong_xc7a100t.tcl": tcl,
                        "build/frozen-input.marker": b"exact frozen input"})
    staged = staging_archive(source, overlay, commit)
    with tarfile.open(fileobj=io.BytesIO(staged)) as archive:
        archive.extractall(tmp_path, filter="data")
    assert all((tmp_path / name).is_symlink() for name in links)
    assert (tmp_path / "hardware/wukong_xc7a100t.tcl").read_bytes() == tcl
    assert json.loads((tmp_path / ".source-provenance.json").read_text())["source_commit"] == commit
    subprocess.run(["sha256sum", "-c", ".staged-inputs.sha256"], cwd=tmp_path,
                   check=True, capture_output=True)
    # Exactly the paths derived by [file dirname [info script]] in frozen Tcl.
    completed = subprocess.run([
        sys.executable, str(tmp_path / "scripts/check_ila_probe_names.py"),
        "--tcl", str(tmp_path / "hardware/wukong_xc7a100t.tcl"),
        "--gen", str(tmp_path / "hardware/gen_rtlil.py"),
        "--top", str(tmp_path / "hardware/wukong_top.py"),
    ], cwd=tmp_path / "build", capture_output=True, text=True)
    assert completed.returncode == 0, completed.stdout + completed.stderr


def test_overlay_cannot_traverse_even_safe_source_directory_symlink():
    source = _archive({"hardware/original": b"source"}, {"build": "hardware"})
    with pytest.raises(ValueError, match="parent is a symlink"):
        staging_archive(source, _archive({"build/new": b"overlay"}), "a" * 40)


def test_overlay_replaces_file_symlink_without_writing_its_target(tmp_path):
    source = _archive({"hardware/original": b"original"},
                      {"hardware/frozen": "original"})
    staged = staging_archive(source, _archive({"hardware/frozen": b"new frozen"}), "a" * 40)
    with tarfile.open(fileobj=io.BytesIO(staged)) as archive:
        archive.extractall(tmp_path, filter="data")
    assert not (tmp_path / "hardware/frozen").is_symlink()
    assert (tmp_path / "hardware/frozen").read_bytes() == b"new frozen"
    assert (tmp_path / "hardware/original").read_bytes() == b"original"


@pytest.mark.parametrize("target", ["/etc/passwd", "../../escape"])
def test_source_archive_rejects_escaping_symlinks(target):
    with pytest.raises(ValueError):
        staging_archive(_archive({}, {"hardware/link": target}), _archive({}), "a" * 40)