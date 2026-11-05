import json
import subprocess
import sys
from types import SimpleNamespace

import pytest
import hardware.wukong_bridge as bridge


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(bridge.sys, "platform", "win32")
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    monkeypatch.delenv("REPORT_TOKEN", raising=False)
    # Simulate the OS boundary, never call Windows APIs or use real credentials.
    def protect(raw, decrypt=False):
        if decrypt:
            assert raw.startswith(b"protected:")
            return bytes(v ^ 91 for v in raw[10:])
        return b"protected:" + bytes(v ^ 91 for v in raw)
    monkeypatch.setattr(bridge, "_windows_protect", protect)
    return tmp_path


def test_restart_reuses_saved_grant_not_consumed_code(store, monkeypatch):
    calls = []
    token = "bridge-session-offline-test"
    def post(url, **kw):
        calls.append(url)
        return SimpleNamespace(status_code=200, json=lambda: (
            dict(token=token, expires_in=3600) if url.endswith("redeem") else dict(ok=True)))
    monkeypatch.setattr(bridge.requests, "post", post)
    assert bridge._connect_pairing("https://ide.test", "board", "single-use")
    path = bridge._credential_file("https://ide.test", "board")
    original = path.read_bytes()
    assert token.encode() not in original
    monkeypatch.delenv("REPORT_TOKEN")
    assert bridge._connect_pairing("https://ide.test", "board", "consumed-code")
    assert calls == ["https://ide.test/api/bridge-pairing/redeem",
                     "https://ide.test/api/bridge-pairing/validate"]
    assert path.read_bytes() == original  # no expiry extension
    assert bridge._load_pairing("https://other.test", "board") is None
    assert bridge._load_pairing("https://ide.test", "other-board") is None


def test_transient_validation_preserves_saved_grant(store, monkeypatch):
    bridge._save_pairing("https://ide.test", "board", "bridge-session-test",
                        bridge.time.time() + 3600)
    path = bridge._credential_file("https://ide.test", "board")
    before = path.read_bytes()
    monkeypatch.setattr(bridge.requests, "post", lambda *a, **k:
                        SimpleNamespace(status_code=503))
    with pytest.raises(ValueError, match="retained"):
        bridge._connect_pairing("https://ide.test", "board", "unused")
    assert path.read_bytes() == before


def test_revocation_does_not_redeem_old_code(store, monkeypatch):
    bridge._save_pairing("https://ide.test", "board", "bridge-session-test",
                        bridge.time.time() + 3600)
    calls = []
    def reject(url, **kwargs):
        calls.append(url)
        return SimpleNamespace(status_code=401)
    monkeypatch.setattr(bridge.requests, "post", reject)
    with pytest.raises(ValueError, match="revoked"):
        bridge._connect_pairing("https://ide.test", "board", "consumed")
    assert len(calls) == 1
    assert not bridge._credential_file("https://ide.test", "board").exists()


def test_expiry_and_corrupt_storage_fail_closed(store, monkeypatch):
    bridge._save_pairing("https://ide.test", "board", "bridge-session-test", 1)
    assert bridge._load_pairing("https://ide.test", "board") is None
    path = bridge._credential_file("https://ide.test", "board")
    path.write_bytes(b"broken")
    monkeypatch.setattr(bridge.requests, "post", lambda *a, **k: pytest.fail("network used"))
    with pytest.raises(AssertionError):
        bridge._connect_pairing("https://ide.test", "board", "code")


def test_saved_grant_survives_a_fresh_process(store, monkeypatch):
    bridge._save_pairing("https://ide.test", "board", "bridge-session-test",
                        bridge.time.time() + 3600)
    # A new interpreter has no bridge module state or in-memory token.
    program = """
import hardware.wukong_bridge as bridge
bridge._windows_protect = lambda raw, decrypt=False: bytes(v ^ 91 for v in raw[10:])
record = bridge._load_pairing('https://ide.test', 'board')
assert record['token'] == 'bridge-session-test'
assert bridge._load_pairing('https://ide.test', 'different-board') is None
print('saved authorization recovered')
"""
    result = subprocess.run([sys.executable, "-c", program],
                            capture_output=True, text=True, timeout=15)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "saved authorization recovered"


@pytest.mark.skipif(sys.platform != "win32", reason="Native Windows DPAPI required")
def test_native_windows_protection():
    raw = b"offline-test-material"
    protected = bridge._windows_protect(raw)
    assert raw not in protected
    assert bridge._windows_protect(protected, decrypt=True) == raw
