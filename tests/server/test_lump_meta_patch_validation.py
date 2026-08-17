"""
tests/server/test_lump_meta_patch_validation.py

Server-side regression tests for PATCH /api/lump/<token>/meta, focusing on
the input-validation of the ns_slot_policy and ns_slot fields added when
slot-policy persistence was introduced.

Coverage
--------
  T1  — valid ns_slot_policy='static'  is accepted (HTTP 200)
  T2  — valid ns_slot_policy='dynamic' is accepted (HTTP 200)
  T3  — invalid ns_slot_policy value (string) is rejected (HTTP 400)
  T4  — invalid ns_slot_policy value (empty string) is rejected (HTTP 400)
  T5  — invalid ns_slot_policy value (None/null) is rejected (HTTP 400)
  T6  — valid ns_slot integer value is accepted (HTTP 200)
  T7  — ns_slot=null (None) is accepted — dynamic lumps clear the slot (HTTP 200)
  T8  — ns_slot as string is rejected (HTTP 400)
  T9  — ns_slot as float-encoded string is rejected (HTTP 400)
  T10 — ns_slot as boolean True is rejected (HTTP 400, booleans are int subtypes)
  T11 — ns_slot negative integer is rejected (HTTP 400)
  T12 — round-trip: stored values survive a subsequent GET /api/lumps/<token>/detail
  T13 — both ns_slot_policy and ns_slot updated together in one PATCH
  T14 — PATCH updates are written to manifest.json as well as the sidecar
  T15 — partial write failure: manifest write fails → server returns 5xx and both
        sidecar and manifest retain their pre-PATCH values (rollback verified)
  T16 — concurrent PATCH: a failed PATCH does not clobber a previously-committed
        successful PATCH (sidecar + manifest agree on the committed values)
"""

import json
import os
import sys

import pytest

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import server.app as _app_module

# ---------------------------------------------------------------------------
# LUMP binary construction helpers (matches save endpoint expectations)
# ---------------------------------------------------------------------------

_MAGIC   = 0x1F << 27
_N_M6    = 0                       # lump_size = 1 << (0 + 6) = 64 words
_LUMP_SZ = 1 << (_N_M6 + 6)       # 64


def _make_binary(cw: int = 1, cc: int = 1) -> list:
    hdr = _MAGIC | (_N_M6 << 23) | (cw << 10) | cc
    return [hdr] + [0] * (_LUMP_SZ - 1)


def _meta(token: str, abstraction: str) -> dict:
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


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def isolated_lumps(tmp_path, monkeypatch):
    """Redirect the server's lumps directory to a fresh temp directory.

    patch_lump_meta() builds paths via os.path.dirname(__file__), where
    __file__ is server/app.py.  Monkeypatching _app_module.__file__ to a path
    inside tmp_path makes all lumps-dir derivations resolve there instead of
    touching the live server/lumps/ directory.
    """
    fake_app_py = tmp_path / "app.py"
    monkeypatch.setattr(_app_module, "__file__", str(fake_app_py))
    lumps_dir = tmp_path / "lumps"
    lumps_dir.mkdir()
    (lumps_dir / "manifest.json").write_text("[]")
    return lumps_dir


@pytest.fixture()
def client(isolated_lumps):
    _app_module.app.config["TESTING"] = True
    with _app_module.app.test_client() as c:
        yield c


@pytest.fixture()
def saved_token(isolated_lumps):
    """Seed a minimal LUMP entry directly in the isolated lumps dir.

    Rather than going through /api/lumps/save (which writes a human-readable
    sidecar filename like TestSlotPolicy.1.b9da0d32.json), we write the sidecar
    as {token8}.json and point sidecar_file at it in the manifest.  That way
    patch_lump_meta (which always writes to {key8}.json) and get_lump_detail
    (which reads sidecar_file from the manifest) both access the same file,
    making PATCH → GET /detail round-trip assertions valid.
    """
    token = "ab123456"
    sidecar = {
        "token":       token,
        "abstraction": "TestSlotPolicy",
        "ns_slot":     None,
        "cw":          1,
        "cc":          1,
        "profile":     "IoT",
        "language":    "assembly",
        "author":      "",
        "version":     "",
        "methods":     [],
        "capabilities": [],
        "grants":      ["E"],
        "content_type": "code",
    }
    sidecar_file = f"{token}.json"
    (isolated_lumps / sidecar_file).write_text(json.dumps(sidecar, indent=2))
    manifest = [{
        "token":        token,
        "abstraction":  "TestSlotPolicy",
        "sidecar_file": sidecar_file,
        "filename":     f"{token}.lump",
    }]
    (isolated_lumps / "manifest.json").write_text(json.dumps(manifest))
    return token


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _patch(client, token, payload):
    return client.patch(
        f"/api/lump/{token}/meta",
        data=json.dumps(payload),
        content_type="application/json",
    )


# ---------------------------------------------------------------------------
# Tests — ns_slot_policy validation
# ---------------------------------------------------------------------------

class TestNsSlotPolicyValidation:

    def test_t1_static_accepted(self, client, saved_token):
        """T1 — ns_slot_policy='static' is a valid value and is accepted."""
        resp = _patch(client, saved_token, {"ns_slot_policy": "static"})
        assert resp.status_code == 200, resp.data
        assert resp.get_json().get("ok")

    def test_t2_dynamic_accepted(self, client, saved_token):
        """T2 — ns_slot_policy='dynamic' is a valid value and is accepted."""
        resp = _patch(client, saved_token, {"ns_slot_policy": "dynamic"})
        assert resp.status_code == 200, resp.data
        assert resp.get_json().get("ok")

    def test_t3_invalid_string_rejected(self, client, saved_token):
        """T3 — A non-enum string for ns_slot_policy must be rejected with 400."""
        resp = _patch(client, saved_token, {"ns_slot_policy": "fixed"})
        assert resp.status_code == 400, resp.data
        body = resp.get_json()
        assert "error" in body
        assert "ns_slot_policy" in body["error"].lower()

    def test_t4_empty_string_rejected(self, client, saved_token):
        """T4 — An empty string is not a valid policy and must be rejected with 400."""
        resp = _patch(client, saved_token, {"ns_slot_policy": ""})
        assert resp.status_code == 400, resp.data
        body = resp.get_json()
        assert "ns_slot_policy" in body["error"].lower()

    def test_t5_null_rejected(self, client, saved_token):
        """T5 — null/None is not a valid policy string; must be rejected with 400."""
        resp = _patch(client, saved_token, {"ns_slot_policy": None})
        assert resp.status_code == 400, resp.data
        body = resp.get_json()
        assert "ns_slot_policy" in body["error"].lower()


# ---------------------------------------------------------------------------
# Tests — ns_slot validation
# ---------------------------------------------------------------------------

class TestNsSlotValidation:

    def test_t6_integer_accepted(self, client, saved_token):
        """T6 — A non-negative integer for ns_slot is accepted."""
        resp = _patch(client, saved_token, {"ns_slot": 9})
        assert resp.status_code == 200, resp.data
        assert resp.get_json().get("ok")

    def test_t7_null_accepted(self, client, saved_token):
        """T7 — null clears the slot assignment (dynamic lump); must be accepted."""
        # First set a slot, then clear it
        _patch(client, saved_token, {"ns_slot": 9})
        resp = _patch(client, saved_token, {"ns_slot": None})
        assert resp.status_code == 200, resp.data
        assert resp.get_json().get("ok")

    def test_t8_string_rejected(self, client, saved_token):
        """T8 — A string value for ns_slot must be rejected with 400."""
        resp = _patch(client, saved_token, {"ns_slot": "9"})
        assert resp.status_code == 400, resp.data
        body = resp.get_json()
        assert "ns_slot" in body["error"].lower()

    def test_t9_float_string_rejected(self, client, saved_token):
        """T9 — A float-as-string for ns_slot must be rejected with 400."""
        resp = _patch(client, saved_token, {"ns_slot": "9.5"})
        assert resp.status_code == 400, resp.data
        body = resp.get_json()
        assert "ns_slot" in body["error"].lower()

    def test_t10_boolean_rejected(self, client, saved_token):
        """T10 — Boolean True is an int subtype in Python; API must reject it with 400.

        The server explicitly guards against booleans because Python's isinstance()
        check would otherwise accept True/False as valid integers.
        """
        resp = _patch(client, saved_token, {"ns_slot": True})
        assert resp.status_code == 400, resp.data
        body = resp.get_json()
        assert "ns_slot" in body["error"].lower()

    def test_t11_negative_integer_rejected(self, client, saved_token):
        """T11 — A negative integer for ns_slot must be rejected with 400."""
        resp = _patch(client, saved_token, {"ns_slot": -1})
        assert resp.status_code == 400, resp.data
        body = resp.get_json()
        assert "ns_slot" in body["error"].lower()


# ---------------------------------------------------------------------------
# Tests — round-trip and combined update
# ---------------------------------------------------------------------------

class TestNsSlotPolicyRoundTrip:

    def test_t12_round_trip_via_detail(self, client, saved_token):
        """T12 — Values written by PATCH survive a subsequent GET /api/lumps/<token>/detail.

        This is the critical invariant for re-add: the ADD modal reads from
        /api/lumps/<token>/detail; if PATCH does not persist to the sidecar
        the values will be lost after a restart and the modal will not
        pre-select the correct policy and slot.
        """
        # Write known values
        patch_resp = _patch(client, saved_token, {"ns_slot_policy": "static", "ns_slot": 9})
        assert patch_resp.status_code == 200, patch_resp.data

        # Read them back via the detail endpoint
        detail_resp = client.get(f"/api/lumps/{saved_token}/detail")
        assert detail_resp.status_code == 200, detail_resp.data
        detail = detail_resp.get_json()

        assert detail.get("ns_slot_policy") == "static", \
            f"Expected ns_slot_policy='static', got {detail.get('ns_slot_policy')!r}"
        assert detail.get("ns_slot") == 9, \
            f"Expected ns_slot=9, got {detail.get('ns_slot')!r}"

    def test_t13_combined_patch(self, client, saved_token):
        """T13 — Both ns_slot_policy and ns_slot can be updated in a single PATCH."""
        resp = _patch(client, saved_token, {"ns_slot_policy": "static", "ns_slot": 12})
        assert resp.status_code == 200, resp.data
        assert resp.get_json().get("ok")

        detail = client.get(f"/api/lumps/{saved_token}/detail").get_json()
        assert detail.get("ns_slot_policy") == "static"
        assert detail.get("ns_slot") == 12

    def test_t14_policy_persists_to_manifest(self, client, saved_token, isolated_lumps):
        """T14 — PATCH updates are written to manifest.json as well as the sidecar.

        boot_image.py reads ns_slot_policy from the manifest; if PATCH only
        updated the sidecar the boot sequence would use stale values.
        """
        _patch(client, saved_token, {"ns_slot_policy": "static", "ns_slot": 11})

        manifest_path = isolated_lumps / "manifest.json"
        manifest = json.loads(manifest_path.read_text())
        entry = next((e for e in manifest if e.get("token") == saved_token), None)

        assert entry is not None, "Token not found in manifest.json"
        assert entry.get("ns_slot_policy") == "static", \
            f"manifest entry ns_slot_policy={entry.get('ns_slot_policy')!r}"
        assert entry.get("ns_slot") == 11, \
            f"manifest entry ns_slot={entry.get('ns_slot')!r}"

    def test_t15_partial_write_failure_returns_error_and_leaves_both_stores_intact(
        self, client, saved_token, isolated_lumps, monkeypatch
    ):
        """T15 — Partial write failure: manifest write fails → server returns 5xx
        and BOTH the manifest and the sidecar retain their pre-PATCH values.

        Scenario: _atomic_write_json raises an IOError when writing manifest.json
        (the second of two writes in patch_lump_meta).  The server must:
          a) Roll back the sidecar to its original content so the sidecar and
             manifest stay in agreement.
          b) Return a 5xx status so the caller knows the PATCH did not succeed.

        Without rollback the server would return 500 while the sidecar held the
        new ns_slot/ns_slot_policy values and the manifest held the old ones.
        The GET /detail path (which reads the sidecar) would then show a
        different slot than boot_image.py (which reads the manifest), causing
        the wrong NS slot to be used at boot with no visible error.

        This test verifies:
          1. The server responds with a 5xx status (not 200/OK).
          2. manifest.json still contains the original ns_slot_policy and
             ns_slot values.
          3. The sidecar JSON file also still contains the original values
             (i.e. the rollback was applied successfully).
        """
        manifest_path = isolated_lumps / "manifest.json"
        sidecar_path  = isolated_lumps / f"{saved_token}.json"

        # Capture the original values from both stores before the PATCH.
        original_manifest = json.loads(manifest_path.read_text())
        original_entry = next(
            (e for e in original_manifest if e.get("token") == saved_token), None
        )
        assert original_entry is not None, "Pre-condition: token must exist in manifest"
        original_ns_slot_policy = original_entry.get("ns_slot_policy")
        original_ns_slot        = original_entry.get("ns_slot")

        original_sidecar = json.loads(sidecar_path.read_text())
        original_sc_policy = original_sidecar.get("ns_slot_policy")
        original_sc_slot   = original_sidecar.get("ns_slot")

        # Inject a fault: _atomic_write_json succeeds for the sidecar write
        # (1st call) and the rollback (3rd call), but raises IOError on the
        # manifest write (2nd call).
        _write_call_count = [0]
        _real_atomic_write = _app_module._atomic_write_json

        def _fail_on_manifest_write(path, data):
            _write_call_count[0] += 1
            if _write_call_count[0] == 2:
                # Second call is the manifest write — simulate a disk error.
                raise IOError("Simulated disk full — manifest write failed")
            # All other calls (sidecar write, sidecar rollback) use the real impl.
            _real_atomic_write(path, data)

        monkeypatch.setattr(_app_module, "_atomic_write_json", _fail_on_manifest_write)

        # Issue the PATCH with new values distinct from the originals.
        resp = _patch(client, saved_token, {"ns_slot_policy": "static", "ns_slot": 7})

        # 1. Server must NOT return success.
        assert resp.status_code >= 500, (
            f"Expected 5xx when manifest write fails, got {resp.status_code}: {resp.data}"
        )

        # 2. manifest.json must still hold the original values — no partial update.
        post_manifest = json.loads(manifest_path.read_text())
        post_entry = next(
            (e for e in post_manifest if e.get("token") == saved_token), None
        )
        assert post_entry is not None, "Token disappeared from manifest after failed PATCH"
        assert post_entry.get("ns_slot_policy") == original_ns_slot_policy, (
            f"manifest ns_slot_policy changed despite write failure: "
            f"{original_ns_slot_policy!r} → {post_entry.get('ns_slot_policy')!r}"
        )
        assert post_entry.get("ns_slot") == original_ns_slot, (
            f"manifest ns_slot changed despite write failure: "
            f"{original_ns_slot!r} → {post_entry.get('ns_slot')!r}"
        )

        # 3. The sidecar must have been rolled back — it must also hold the
        #    original values so both stores remain in agreement.
        post_sidecar = json.loads(sidecar_path.read_text())
        assert post_sidecar.get("ns_slot_policy") == original_sc_policy, (
            f"sidecar ns_slot_policy was NOT rolled back after manifest failure: "
            f"{original_sc_policy!r} → {post_sidecar.get('ns_slot_policy')!r}"
        )
        assert post_sidecar.get("ns_slot") == original_sc_slot, (
            f"sidecar ns_slot was NOT rolled back after manifest failure: "
            f"{original_sc_slot!r} → {post_sidecar.get('ns_slot')!r}"
        )

    def test_t16_concurrent_disjoint_patches_both_committed(
        self, isolated_lumps
    ):
        """T16 — Two concurrent PATCHes for disjoint fields on the same token
        must both be committed; sidecar and manifest must agree on both updates.

        Root cause being guarded: without holding _lumps_manifest_lock from the
        moment the sidecar is read, two concurrent requests can both snapshot
        the same stale sidecar, then each commit their own update while
        overwriting the other's — only one field survives in the final state.

        With the lock held across fresh-read → apply → write, requests are
        serialised: the second to enter the lock reads the first's committed
        sidecar and therefore carries both updates forward.

        Scenario (concurrent):
          Thread A  — PATCH ns_slot=5 / ns_slot_policy='static'
          Thread B  — PATCH author='concurrent_author'
        Both threads are released from a Barrier simultaneously so they race
        for _lumps_manifest_lock.  After both join, the final sidecar and
        manifest must contain all three field values.
        """
        import threading

        # Seed a fresh token in the isolated lumps dir used by this test.
        token = "cc000002"
        sidecar_data = {
            "token": token, "abstraction": "ConcurrentTest",
            "ns_slot": None, "ns_slot_policy": None,
            "author": "", "version": "", "cw": 1, "cc": 1,
            "profile": "IoT", "language": "assembly",
            "methods": [], "capabilities": [], "grants": ["E"],
            "content_type": "code",
        }
        sidecar_file = f"{token}.json"
        (isolated_lumps / sidecar_file).write_text(json.dumps(sidecar_data, indent=2))
        manifest_seed = [{
            "token": token, "abstraction": "ConcurrentTest",
            "sidecar_file": sidecar_file, "filename": f"{token}.lump",
        }]
        (isolated_lumps / "manifest.json").write_text(json.dumps(manifest_seed))

        results   = {}
        errors    = {}
        barrier   = threading.Barrier(2)

        def _do_patch(label, payload_dict):
            """Issue a PATCH inside a fresh test client; record status."""
            try:
                barrier.wait(timeout=10)   # synchronise both threads at the gate
                with _app_module.app.test_client() as tc:
                    resp = tc.patch(
                        f"/api/lump/{token}/meta",
                        data=json.dumps(payload_dict),
                        content_type="application/json",
                    )
                    results[label] = resp.status_code
            except Exception as exc:
                errors[label] = exc

        thread_a = threading.Thread(
            target=_do_patch,
            args=("a", {"ns_slot": 5, "ns_slot_policy": "static"}),
        )
        thread_b = threading.Thread(
            target=_do_patch,
            args=("b", {"author": "concurrent_author"}),
        )

        thread_a.start()
        thread_b.start()
        thread_a.join(timeout=15)
        thread_b.join(timeout=15)

        assert not errors, f"Thread exception(s): {errors}"
        assert results.get("a") == 200, f"Thread A (ns_slot) returned {results.get('a')!r}"
        assert results.get("b") == 200, f"Thread B (author) returned {results.get('b')!r}"

        # ── Both updates must be present in the final sidecar and manifest ──
        final_sidecar = json.loads((isolated_lumps / sidecar_file).read_text())
        final_manifest = json.loads((isolated_lumps / "manifest.json").read_text())
        final_entry = next(
            (e for e in final_manifest if e.get("token") == token), None
        )
        assert final_entry is not None, "Token missing from manifest after concurrent PATCHes"

        assert final_sidecar.get("ns_slot") == 5, (
            f"sidecar ns_slot lost: {final_sidecar.get('ns_slot')!r}"
        )
        assert final_sidecar.get("ns_slot_policy") == "static", (
            f"sidecar ns_slot_policy lost: {final_sidecar.get('ns_slot_policy')!r}"
        )
        assert final_sidecar.get("author") == "concurrent_author", (
            f"sidecar author lost: {final_sidecar.get('author')!r}"
        )

        # Sidecar and manifest must agree on the ns_slot-family fields.
        assert final_entry.get("ns_slot") == final_sidecar.get("ns_slot"), (
            f"manifest/sidecar ns_slot disagree: "
            f"manifest={final_entry.get('ns_slot')!r} sidecar={final_sidecar.get('ns_slot')!r}"
        )
        assert final_entry.get("ns_slot_policy") == final_sidecar.get("ns_slot_policy"), (
            f"manifest/sidecar ns_slot_policy disagree: "
            f"manifest={final_entry.get('ns_slot_policy')!r} "
            f"sidecar={final_sidecar.get('ns_slot_policy')!r}"
        )
