"""
tests/server/test_concurrent_lump_save.py

Regression guard: two simultaneous POST /api/lumps/save requests (different
tokens, different abstraction names) must BOTH appear in /api/lumps/list after
both complete.

Without the _lumps_manifest_lock introduced in this task, the slower writer
overwrites the faster writer's manifest entry, so one LUMP silently disappears
from the list with no error reported to either client.

Determinism
-----------
The test injects a synchronisation barrier via the module-level
``_lumps_manifest_pre_write_hook`` in server/app.py.  The hook fires inside
save_lump() after all per-token file I/O (Phases 5 & 6) but BEFORE the
manifest lock is acquired (Phase 7).  Placing the barrier here guarantees that
both threads have completed their Phase-1 manifest read before either is
allowed to enter Phase 7 — the exact window that the old implementation
(no lock, stale in-memory manifest) loses data.

Filesystem isolation
--------------------
All tests use the ``isolated_lumps`` fixture, which monkeypatches
``_app_module.__file__`` so the server's lumps directory resolves to a fresh
``tmp_path/lumps`` directory.  The production ``server/lumps/`` directory and
its ``manifest.json`` are never touched.
"""

import json
import os
import sys
import threading

import pytest

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import server.app as _app_module

# ── Lump construction helpers ─────────────────────────────────────────────────

_MAGIC   = 0x1F << 27
_N_M6    = 0                      # lump_size = 1 << (0 + 6) = 64 words
_LUMP_SZ = 1 << (_N_M6 + 6)      # 64


def _make_binary(cw=1, cc=1):
    hdr = _MAGIC | (_N_M6 << 23) | (cw << 10) | cc
    return [hdr] + [0] * (_LUMP_SZ - 1)


def _meta(token, abstraction):
    return {
        "token":           token,
        "abstraction":     abstraction,
        "ns_slot":         None,
        "cw":              1,
        "cc":              1,
        "profile":         "IoT",
        "language":        "assembly",
        "author":          "",
        "version":         "",
        "methods":         [],
        "capabilities":    [],
        "grants":          ["E"],
        "content_type":    "code",
        "pet_names_dr":    {},
        "pet_names_cr":    {},
        "mtbf_clean_runs": 0,
        "mtbf_total_runs": 0,
        "mtbf_status":     "unknown",
    }


# ── Fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture()
def isolated_lumps(tmp_path, monkeypatch):
    """Redirect the server's lumps directory to a fresh temp directory.

    save_lump() builds lumps_dir via:
        os.path.join(os.path.dirname(__file__), 'lumps')
    where __file__ is server/app.py.  Monkeypatching _app_module.__file__ to
    a path inside tmp_path makes os.path.dirname(__file__) return tmp_path,
    so lumps_dir = tmp_path/lumps — fully isolated from the live server/lumps/.
    """
    fake_app_py = tmp_path / "app.py"
    monkeypatch.setattr(_app_module, "__file__", str(fake_app_py))
    lumps_dir = tmp_path / "lumps"
    lumps_dir.mkdir()
    (lumps_dir / "manifest.json").write_text("[]")
    return lumps_dir


# ── Tests ──────────────────────────────────────────────────────────────────────

class TestConcurrentLumpSave:
    """Manifest lock prevents concurrent saves from erasing each other."""

    TOKEN_A = "cccc0a01"
    TOKEN_B = "cccc0b01"
    ABS_A   = "ConcurrentSaveA"
    ABS_B   = "ConcurrentSaveB"

    def setup_method(self):
        # Always clear the hook before each test.
        _app_module._lumps_manifest_pre_write_hook = None

    def teardown_method(self):
        # Restore hook to None so other tests are unaffected.
        _app_module._lumps_manifest_pre_write_hook = None

    def _run_concurrent_saves_with_hook(self):
        """
        Fire two /api/lumps/save POSTs with a deterministic race window.

        A threading.Barrier(2) is installed as _lumps_manifest_pre_write_hook.
        save_lump() calls the hook after writing the per-token .lump / .json
        files (Phases 5 & 6) but BEFORE acquiring _lumps_manifest_lock
        (Phase 7).  Both threads therefore complete their Phase-1 manifest
        read and arrive at the barrier before either is allowed to write the
        manifest — the exact window where the old implementation loses data.

        Each thread creates its own Flask test client because Flask's context
        vars are per-thread; sharing a single client across threads causes
        LookupError on app-context teardown.

        Returns (results_dict, errors_dict).
        """
        results = {}
        errors  = {}
        binary  = _make_binary()

        # Barrier(2): both save threads must reach the hook before either
        # continues into Phase 7.  Main thread does NOT participate.
        barrier = threading.Barrier(2, timeout=10)

        def _hook():
            barrier.wait()

        _app_module._lumps_manifest_pre_write_hook = _hook

        def do_save(token, abstraction):
            try:
                _app_module.app.config["TESTING"] = True
                with _app_module.app.test_client() as c:
                    resp = c.post(
                        "/api/lumps/save",
                        json={"binary": binary, "metadata": _meta(token, abstraction)},
                    )
                    results[token]         = resp.status_code
                    results[f"{token}_ok"] = resp.get_json(silent=True) or {}
            except Exception as exc:
                errors[token] = str(exc)

        t1 = threading.Thread(target=do_save, args=(self.TOKEN_A, self.ABS_A))
        t2 = threading.Thread(target=do_save, args=(self.TOKEN_B, self.ABS_B))
        t1.start()
        t2.start()
        t1.join(timeout=20)
        t2.join(timeout=20)

        return results, errors

    def test_both_tokens_in_list_after_concurrent_saves(self, isolated_lumps):
        """Both tokens must appear in /api/lumps/list after simultaneous saves."""
        results, errors = self._run_concurrent_saves_with_hook()

        assert not errors, f"Save threads raised exceptions: {errors}"

        assert results.get(self.TOKEN_A) == 200, (
            f"Save A returned HTTP {results.get(self.TOKEN_A)}, expected 200; "
            f"body: {results.get(f'{self.TOKEN_A}_ok')}"
        )
        assert results.get(self.TOKEN_B) == 200, (
            f"Save B returned HTTP {results.get(self.TOKEN_B)}, expected 200; "
            f"body: {results.get(f'{self.TOKEN_B}_ok')}"
        )
        assert results.get(f"{self.TOKEN_A}_ok", {}).get("ok"), "Save A reported ok=False"
        assert results.get(f"{self.TOKEN_B}_ok", {}).get("ok"), "Save B reported ok=False"

        _app_module.app.config["TESTING"] = True
        with _app_module.app.test_client() as client:
            list_resp = client.get("/api/lumps/list")
        assert list_resp.status_code == 200
        tokens_in_list = {e.get("token") for e in list_resp.get_json()}

        assert self.TOKEN_A in tokens_in_list, (
            f"Token A ({self.TOKEN_A}) missing from /api/lumps/list — "
            f"manifest race not serialised. Tokens present: {sorted(tokens_in_list)}"
        )
        assert self.TOKEN_B in tokens_in_list, (
            f"Token B ({self.TOKEN_B}) missing from /api/lumps/list — "
            f"manifest race not serialised. Tokens present: {sorted(tokens_in_list)}"
        )

    def test_manifest_on_disk_contains_both_tokens(self, isolated_lumps):
        """manifest.json in the isolated temp dir must contain both entries."""
        results, errors = self._run_concurrent_saves_with_hook()

        assert not errors, f"Save threads raised exceptions: {errors}"
        assert results.get(self.TOKEN_A) == 200
        assert results.get(self.TOKEN_B) == 200

        manifest_path = isolated_lumps / "manifest.json"
        assert manifest_path.is_file(), "manifest.json not found in isolated lumps dir"
        tokens_on_disk = {e.get("token") for e in json.loads(manifest_path.read_text())}

        assert self.TOKEN_A in tokens_on_disk, (
            f"Token A missing from manifest.json on disk. "
            f"Tokens present: {sorted(tokens_on_disk)}"
        )
        assert self.TOKEN_B in tokens_on_disk, (
            f"Token B missing from manifest.json on disk. "
            f"Tokens present: {sorted(tokens_on_disk)}"
        )
