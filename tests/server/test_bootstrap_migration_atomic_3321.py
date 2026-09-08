import hashlib
from pathlib import Path
import shutil

import pytest

from scripts.migrate_bootstrap_residents import migrate


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