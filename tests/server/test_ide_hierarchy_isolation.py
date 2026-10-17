"""The test override must never fall back to real project ownership."""
import hashlib
import json
from pathlib import Path

import pytest

from server import ide_leaf_policy as policy


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    live = Path(policy.__file__).with_name("ide-hierarchy.json")
    live_hash = lambda: hashlib.sha256(live.read_bytes()).hexdigest() if live.exists() else None
    before = live_hash()
    for key in ("CHURCH_TEST_IDE_HIERARCHY_PATH", "CHURCH_TEST_ISOLATED_MODE",
                "CHURCH_TEST_ISOLATED"):
        monkeypatch.delenv(key, raising=False)
    yield
    assert live_hash() == before


@pytest.mark.parametrize("flag", ["CHURCH_TEST_ISOLATED_MODE", "CHURCH_TEST_ISOLATED"])
@pytest.mark.parametrize("value", ["1", "true", "YES", " on "])
def test_missing_override_fails_before_read_or_write(monkeypatch, flag, value):
    monkeypatch.setenv(flag, value)
    for operation in (policy.configuration, lambda: policy.save_node(
            {"node": "testnode", "expected": None, "confirmed": True})):
        with pytest.raises(ValueError, match="requires CHURCH_TEST_IDE_HIERARCHY_PATH"):
            operation()


@pytest.mark.parametrize("kind", ["direct", "relative", "symlink", "hardlink", "server-child",
                                  "missing", "directory", "lock-symlink", "lock-hardlink"])
def test_unsafe_override_rejected(tmp_path, monkeypatch, kind):
    live = Path(policy.__file__).resolve().with_name("ide-hierarchy.json")
    if kind in ("hardlink", "lock-hardlink"):
        # /tmp and the workspace may be different mounts. Exercise real hard
        # links on one filesystem without linking the operator's actual inode.
        live = tmp_path / "server/ide-hierarchy.json"
        live.parent.mkdir()
        live.write_text('{"node":"live"}')
        monkeypatch.setattr(policy, "__file__", str(live.with_name("ide_leaf_policy.py")))
    candidate = tmp_path / "private.json"
    candidate.write_text('{"node":"private","aliases":{},"definitions":{}}')
    if kind == "direct":
        candidate = live
    elif kind == "relative":
        monkeypatch.chdir(live.parent.parent)
        candidate = Path("server/../server/ide-hierarchy.json")
    elif kind in ("symlink", "hardlink"):
        candidate.unlink()
        if kind == "symlink":
            candidate.symlink_to(live)
        else:
            candidate.hardlink_to(live)
    elif kind == "server-child":
        candidate = live.parent / "not-a-private-config.json"
    elif kind == "missing":
        candidate.unlink()
    elif kind == "directory":
        candidate = tmp_path
    elif kind == "lock-symlink":
        Path(str(candidate) + ".lock").symlink_to(live)
    elif kind == "lock-hardlink":
        Path(str(candidate) + ".lock").hardlink_to(live)
    monkeypatch.setenv("CHURCH_TEST_IDE_HIERARCHY_PATH", str(candidate))
    for operation in (policy.configuration, lambda: policy.save_node(
            {"node": "testnode", "expected": None, "confirmed": True})):
        with pytest.raises(ValueError):
            operation()


def test_private_file_is_selected_after_import_and_reloaded(tmp_path, monkeypatch):
    original = {"node": "private", "aliases": {"Thread.2": "private.Thread2",
                "Remote": "foreign.UART"}, "definitions": {"foreign.UART": ["W"]}}
    candidate = tmp_path / "ide-hierarchy.json"
    candidate.write_text(json.dumps(original))
    monkeypatch.setenv("CHURCH_TEST_ISOLATED_MODE", "1")
    monkeypatch.setenv("CHURCH_TEST_IDE_HIERARCHY_PATH", str(candidate))
    assert policy.configuration() == original
    before = candidate.read_bytes()
    with pytest.raises(ValueError, match="Confirm"):
        policy.save_node({"node": "testnode", "expected": original, "confirmed": False})
    assert candidate.read_bytes() == before
    saved = policy.save_node({"node": "testnode", "expected": original, "confirmed": True})
    assert saved == policy.configuration() == json.loads(candidate.read_bytes())
    assert saved["aliases"] == {"Thread.2": "testnode.Thread2", "Remote": "foreign.UART"}
    assert saved["definitions"] == original["definitions"]
    with pytest.raises(ValueError, match="another session"):
        policy.save_node({"node": "stale", "expected": original, "confirmed": True})
    assert policy.configuration() == saved
    monkeypatch.delenv("CHURCH_TEST_IDE_HIERARCHY_PATH")
    with pytest.raises(ValueError, match="requires"):
        policy.configuration()


def test_ordinary_access_retains_default(monkeypatch, tmp_path):
    # Do not depend on, or change, the operator's chosen node.
    candidate = tmp_path / "normal.json"
    candidate.write_text('{"node":"normal"}')
    monkeypatch.setattr(policy, "CONFIG_PATH", str(candidate))
    assert policy.configuration() == {"node": "normal"}
    candidate.unlink()
    assert policy.configuration() is None
