"""
tests/server/test_identity_seal_guard.py

Runtime guard: /api/lumps/save must reject a LUMP whose c-list[0] cannot
receive the identity self-GT, and must not touch any file on disk when it
does so.

The guard runs as pure computation BEFORE any filesystem mutation (archive,
prune, or write), so existing LUMP binaries, sidecars, and archives must be
byte-for-byte identical after a rejected save.

Trigger
-------
Set cc == lump_size in the header.  This makes:

    _clist_row0_idx = lump_size - cc = 0

The injection code requires `0 < idx < len(words)`, so the write is skipped,
`_actual_seal` stays 0, and the guard fires 422 before touching any file.
"""

import json
import os
import struct
import sys

import pytest

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import server.app as _app_module

LUMPS_DIR = os.path.join(os.path.dirname(_app_module.__file__), "lumps")

# ── Lump helpers ──────────────────────────────────────────────────────────────

# Canonical lump: 64 words, n_m6=0 (lump_size=64), cw=1, cc=1 (valid).
_LUMP_SIZE  = 64          # words
_N_M6       = 0           # encodes lump_size = 64
_CW_VALID   = 1
_CC_VALID   = 1

# Header with cc == lump_size → _clist_row0_idx = 0 → injection skipped → 422.
_CC_BAD     = _LUMP_SIZE  # makes row0_idx = 0, out of valid range

_MAGIC      = 0x1F << 27


def _make_header(cw, cc, n_m6=_N_M6):
    return _MAGIC | (n_m6 << 23) | (cw << 10) | cc


def _make_binary(cw, cc, n_m6=_N_M6):
    """Return a list of `lump_size` words with the given header."""
    lump_size = 1 << (n_m6 + 6)
    hdr = _make_header(cw, cc, n_m6)
    return [hdr] + [0] * (lump_size - 1)


# A valid binary — used to pre-seed existing lumps.
_BINARY_VALID = _make_binary(_CW_VALID, _CC_VALID)
# A binary with cc == lump_size — triggers the identity-seal rejection.
_BINARY_BAD   = _make_binary(_CW_VALID, _CC_BAD)


def _meta(token, abstraction="SealGuardTest"):
    return {
        "token":           token,
        "abstraction":     abstraction,
        "ns_slot":         None,
        "cw":              _CW_VALID,
        "cc":              _CC_VALID,
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


def _cleanup(token, abstraction="SealGuardTest"):
    manifest_path = os.path.join(LUMPS_DIR, "manifest.json")
    for fn in os.listdir(LUMPS_DIR):
        if fn.startswith(token) or fn.startswith(abstraction):
            try:
                os.remove(os.path.join(LUMPS_DIR, fn))
            except OSError:
                pass
    try:
        man = json.load(open(manifest_path))
        json.dump(
            [e for e in man if e.get("token") != token],
            open(manifest_path, "w"),
            indent=2,
        )
    except Exception:
        pass


@pytest.fixture()
def client():
    _app_module.app.config["TESTING"] = True
    with _app_module.app.test_client() as c:
        yield c


# ── Tests ─────────────────────────────────────────────────────────────────────

class TestIdentitySealGuard:
    """Guard: corrupt-header LUMP is rejected with 422 and no files are touched."""

    def test_bad_clist_index_returns_422(self, client):
        """A header with cc == lump_size makes clist_row0_idx = 0 → 422."""
        token = "5ea10001"
        try:
            resp = client.post(
                "/api/lumps/save",
                json={"binary": _BINARY_BAD, "metadata": _meta(token)},
            )
            assert resp.status_code == 422, (
                f"Expected 422 for unwritable c-list index, got {resp.status_code}. "
                f"Body: {resp.get_data(as_text=True)}"
            )
        finally:
            _cleanup(token)

    def test_rejection_body_has_identity_seal_mismatch(self, client):
        """422 body must set identity_seal_mismatch=True and name expected vs actual."""
        token = "5ea10002"
        try:
            resp = client.post(
                "/api/lumps/save",
                json={"binary": _BINARY_BAD, "metadata": _meta(token)},
            )
            assert resp.status_code == 422
            data = resp.get_json()
            assert data.get("identity_seal_mismatch") is True, (
                f"Expected identity_seal_mismatch=True in 422 body, got: {data}"
            )
            assert "expected_self_gt" in data, (
                f"422 body must include expected_self_gt; got: {data}"
            )
            assert "actual_clist0" in data, (
                f"422 body must include actual_clist0; got: {data}"
            )
            assert "identity_string" in data, (
                f"422 body must include identity_string; got: {data}"
            )
            # actual_clist0 must be 0 (the injection was skipped entirely)
            assert data["actual_clist0"] == 0, (
                f"actual_clist0 must be 0 (injection skipped), got {data['actual_clist0']}"
            )
        finally:
            _cleanup(token)

    def test_rejection_names_expected_self_gt(self, client):
        """The expected_self_gt in the 422 body must match the formula from identity_string."""
        import hashlib
        token = "5ea10003"
        abstraction = "SealGuardTestNamed"
        try:
            resp = client.post(
                "/api/lumps/save",
                json={"binary": _BINARY_BAD, "metadata": _meta(token, abstraction)},
            )
            assert resp.status_code == 422
            data = resp.get_json()
            identity_string = data["identity_string"]
            # Recompute expected GT from the identity_string the server reported
            h32 = int(hashlib.sha256(identity_string.encode()).hexdigest()[:8], 16)
            expected_gt = (0x0A000000 | (h32 & 0x1FFFFFF)) & 0xFFFFFFFF
            assert data["expected_self_gt"] == expected_gt, (
                f"expected_self_gt {data['expected_self_gt']:#010x} does not match "
                f"sha256({identity_string!r}) → {expected_gt:#010x}"
            )
        finally:
            _cleanup(token, abstraction)

    def test_no_lump_file_written_on_rejection(self, client):
        """When a save is rejected, the new lump path must not appear on disk."""
        token = "5ea10004"
        try:
            before = set(os.listdir(LUMPS_DIR))
            resp = client.post(
                "/api/lumps/save",
                json={"binary": _BINARY_BAD, "metadata": _meta(token)},
            )
            assert resp.status_code == 422
            after = set(os.listdir(LUMPS_DIR))
            new_files = after - before
            lump_files = [f for f in new_files if f.endswith(".lump")]
            assert not lump_files, (
                f"Identity-seal rejection must not write any .lump file to disk; "
                f"found new files: {sorted(new_files)}"
            )
        finally:
            _cleanup(token)

    def test_existing_lump_untouched_on_rejection(self, client):
        """When an existing LUMP is present, its bytes must be identical after rejection."""
        token = "5ea10005"
        try:
            # First save a valid LUMP to establish an existing file.
            resp1 = client.post(
                "/api/lumps/save",
                json={"binary": _BINARY_VALID, "metadata": _meta(token)},
            )
            assert resp1.status_code == 200, (
                f"Setup save failed: {resp1.get_data(as_text=True)}"
            )

            # Locate the saved lump on disk.
            existing_lumps = [
                f for f in os.listdir(LUMPS_DIR)
                if f.endswith(".lump") and not f.endswith(("-v0.lump",))
                and (token in f or "SealGuardTest" in f)
            ]
            assert existing_lumps, "Setup: no lump file found after first save"

            # Snapshot all current lump bytes.
            snapshots = {}
            for fn in existing_lumps:
                path = os.path.join(LUMPS_DIR, fn)
                with open(path, "rb") as fh:
                    snapshots[fn] = fh.read()

            # Now attempt a bad save — must be rejected.
            resp2 = client.post(
                "/api/lumps/save",
                json={"binary": _BINARY_BAD, "metadata": _meta(token)},
            )
            assert resp2.status_code == 422, (
                f"Expected 422, got {resp2.status_code}: {resp2.get_data(as_text=True)}"
            )

            # Every lump that existed before must still have identical bytes.
            for fn, original_bytes in snapshots.items():
                path = os.path.join(LUMPS_DIR, fn)
                assert os.path.isfile(path), (
                    f"Rejection must not delete existing lump {fn}"
                )
                with open(path, "rb") as fh:
                    current_bytes = fh.read()
                assert current_bytes == original_bytes, (
                    f"Rejection must not modify existing lump {fn} — "
                    f"bytes changed ({len(original_bytes)} → {len(current_bytes)} bytes)"
                )
        finally:
            _cleanup(token)

    def test_valid_binary_saves_successfully(self, client):
        """Control: a properly-formed binary with a valid c-list index must still save."""
        token = "5ea10006"
        try:
            resp = client.post(
                "/api/lumps/save",
                json={"binary": _BINARY_VALID, "metadata": _meta(token)},
            )
            assert resp.status_code == 200, (
                f"Valid binary should save successfully, got {resp.status_code}. "
                f"Body: {resp.get_data(as_text=True)}"
            )
            data = resp.get_json()
            assert data.get("ok"), f"Expected ok=True, got: {data}"
        finally:
            _cleanup(token)

    def test_valid_save_self_gt_correct_in_binary(self, client):
        """After a successful save, c-list[0] on disk must equal the expected self-GT."""
        import hashlib
        token = "5ea10007"
        try:
            resp = client.post(
                "/api/lumps/save",
                json={"binary": _BINARY_VALID, "metadata": _meta(token)},
            )
            assert resp.status_code == 200
            data = resp.get_json()
            identity_string = data.get("identity_string", "")
            assert identity_string, f"Response missing identity_string: {data}"

            # Find the saved lump file (response key is "lump").
            filename = data.get("lump", f"{token}.lump")
            lump_path = os.path.join(LUMPS_DIR, filename)
            assert os.path.isfile(lump_path), f"Saved lump not found at {lump_path}"

            with open(lump_path, "rb") as fh:
                raw = fh.read()
            words = struct.unpack(f">{len(raw) // 4}I", raw)

            # Parse header to locate c-list[0].
            hdr   = words[0]
            lsz   = 1 << (((hdr >> 23) & 0xF) + 6)
            cc    = hdr & 0xFF
            idx   = lsz - cc
            assert 0 < idx < len(words), (
                f"c-list row0 index {idx} out of range for saved lump of {len(words)} words"
            )
            actual_gt = words[idx]

            # Recompute expected GT from the identity_string the server reported.
            h32 = int(hashlib.sha256(identity_string.encode()).hexdigest()[:8], 16)
            expected_gt = (0x0A000000 | (h32 & 0x1FFFFFF)) & 0xFFFFFFFF

            assert actual_gt == expected_gt, (
                f"c-list[0] on disk = {actual_gt:#010x} but expected self-GT "
                f"{expected_gt:#010x} for identity_string={identity_string!r}"
            )
        finally:
            _cleanup(token)
