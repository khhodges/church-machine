"""Endpoint-level regression tests for LUMP canonical filename integrity.

R21a — GET /api/lump/<token> must return HTTP 409 when the in-memory bytes
        for a canonical manifest entry do not match the Number embedded in
        its filename (tamper test).  Unmodified bytes must still return 200.

R21b — POST /api/lumps/save must write a canonical Dot.Name.n.Number.lump
        filename and set dot_name + issue_n in the manifest entry.  The
        immediately-following GET /api/lump/<token> must return 200, proving
        that check_lump_canonical_integrity passes for a freshly-saved lump.

These tests use the Flask test client (same pattern as tests/boot/).
"""

import hashlib
import json
import os
import re
import struct

import pytest

# ---------------------------------------------------------------------------
# Constants / helpers shared by both test classes
# ---------------------------------------------------------------------------

LUMPS_DIR = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "server", "lumps")
)
MANIFEST_PATH = os.path.join(LUMPS_DIR, "manifest.json")

_CANONICAL_RE = re.compile(r'^(.+)\.(\d+)\.([0-9a-f]{8})\.lump$', re.IGNORECASE)


# ── Module-scoped snapshot/restore ───────────────────────────────────────────

@pytest.fixture(scope="module", autouse=True)
def lumps_dir_snapshot(tmp_path_factory):
    """Full snapshot/restore of server/lumps/ around this destructive module.

    Tests here POST /api/lumps/save and directly modify manifest.json in the
    real server/lumps/ directory.  Per-test cleanup fixtures handle the
    nominal case, but a mid-suite failure could leave stale files or a corrupt
    manifest.  This module-scoped autouse fixture holds the cross-process
    lumps_write_lock for the entire snapshot → tests → restore span and
    guarantees full restoration even on unexpected failures.
    """
    from tests.boot.conftest import lumps_write_lock
    import shutil as _shutil

    with lumps_write_lock():
        snap_dir = str(tmp_path_factory.mktemp("lumps_snapshot"))
        entries = {}
        for name in os.listdir(LUMPS_DIR):
            p = os.path.join(LUMPS_DIR, name)
            if os.path.islink(p):
                entries[name] = ("link", os.readlink(p))
            elif os.path.isfile(p):
                dst = os.path.join(snap_dir, name)
                _shutil.copy2(p, dst)
                entries[name] = ("file", dst)

        yield

        # 1. Remove anything created during the module.
        for name in os.listdir(LUMPS_DIR):
            if name not in entries:
                p = os.path.join(LUMPS_DIR, name)
                if os.path.islink(p) or os.path.isfile(p):
                    os.remove(p)

        # 2. Restore originals (content, symlink targets, deleted files).
        for name, (kind, val) in entries.items():
            p = os.path.join(LUMPS_DIR, name)
            if kind == "link":
                current = os.readlink(p) if os.path.islink(p) else None
                if current != val:
                    if os.path.islink(p) or os.path.exists(p):
                        os.remove(p)
                    os.symlink(val, p)
            else:
                with open(val, "rb") as fh:
                    original = fh.read()
                if os.path.islink(p):
                    os.remove(p)
                needs_write = True
                if os.path.isfile(p):
                    with open(p, "rb") as fh:
                        needs_write = fh.read() != original
                if needs_write:
                    with open(p, "wb") as fh:
                        fh.write(original)


def _load_manifest():
    with open(MANIFEST_PATH) as fh:
        return json.load(fh)


def _first_canonical_token():
    """Return (token8, dot_name, filename) for the first production manifest
    entry that has dot_name AND a canonical filename AND bytes loaded in
    LAZY_LUMPS, so the tamper test has something to work with.
    Prefers tokens whose bytes are definitely loaded at startup.
    """
    from server.app import LAZY_LUMPS
    for entry in _load_manifest():
        token = entry.get("token", "")
        dot_name = entry.get("dot_name", "")
        filename = entry.get("filename", "")
        if token and dot_name and _CANONICAL_RE.match(filename) and token in LAZY_LUMPS:
            return token, dot_name, filename
    return None, None, None


# ---------------------------------------------------------------------------
# R21a — raw delivery refuses tampered canonical bytes
# ---------------------------------------------------------------------------

class TestR21a_RawDeliveryRejectsHashMismatch:
    """GET /api/lump/<token> must call check_lump_canonical_integrity and
    return 409 when the served bytes do not match the Number in the
    manifest filename.

    The test temporarily overwrites LAZY_LUMPS[token8] with tampered bytes,
    makes the request, asserts 409, then restores the original bytes in a
    finally block so no other test is affected.
    """

    def test_tampered_canonical_bytes_yield_409(self):
        from server.app import app as _flask_app, LAZY_LUMPS

        token8, dot_name, filename = _first_canonical_token()
        if token8 is None:
            pytest.skip(
                "No canonical manifest entry with bytes in LAZY_LUMPS "
                "available for the tamper test."
            )

        orig = LAZY_LUMPS[token8]
        alt_key = token8.lstrip('0') or '0'

        # Tamper: flip a byte in word-1 (first code word after the header)
        tampered = bytearray(orig)
        tampered[4] ^= 0xFF
        LAZY_LUMPS[token8] = bytes(tampered)
        LAZY_LUMPS[alt_key]  = bytes(tampered)
        try:
            with _flask_app.test_client() as client:
                resp = client.get(f'/api/lump/{token8}')
        finally:
            LAZY_LUMPS[token8] = orig
            LAZY_LUMPS[alt_key]  = orig

        assert resp.status_code == 409, (
            f"Expected HTTP 409 for tampered canonical bytes of {filename} "
            f"(token {token8}), got {resp.status_code}.\n"
            "check_lump_canonical_integrity must be called in get_lump() "
            "before constructing the response."
        )
        body = resp.get_json()
        assert body and "error" in body, (
            "HTTP 409 response must include a JSON body with an 'error' field."
        )

    def test_unmodified_canonical_bytes_yield_200(self):
        """Sanity guard: the integrity check must not block valid canonical bytes."""
        from server.app import app as _flask_app

        token8, dot_name, filename = _first_canonical_token()
        if token8 is None:
            pytest.skip("No canonical manifest entry available.")

        with _flask_app.test_client() as client:
            resp = client.get(f'/api/lump/{token8}')

        assert resp.status_code == 200, (
            f"Expected HTTP 200 for valid canonical bytes of {filename} "
            f"(token {token8}), got {resp.status_code}."
        )

    # -----------------------------------------------------------------------
    # issue_n invariant enforcement via the manifest
    # -----------------------------------------------------------------------
    # These tests inject synthetic LAZY_LUMPS bytes + a temporary manifest
    # entry that violates the issue_n invariant, then verify that GET returns
    # 409 — proving check_lump_canonical_integrity enforces issue_n for every
    # dot_name entry regardless of how the manifest entry got there.

    _SYNTHETIC_TOKEN = "fe009988"

    @pytest.fixture(autouse=False)
    def _synthetic_lump(self):
        """Inject a synthetic token/bytes into LAZY_LUMPS and yield; clean up after."""
        from server.app import LAZY_LUMPS
        # Minimal 64-word code lump (same as used in R21b save tests)
        hdr   = (0x1F << 27) | (0 << 23) | (1 << 10) | (0 << 8) | 0x01
        ret_w = 0x90000000
        words = [hdr, ret_w] + [0] * 62
        lump_bytes = struct.pack(">64I", *words)
        LAZY_LUMPS[self._SYNTHETIC_TOKEN] = lump_bytes
        yield lump_bytes
        LAZY_LUMPS.pop(self._SYNTHETIC_TOKEN, None)

    @pytest.fixture(autouse=False)
    def _patch_manifest(self):
        """Context manager that temporarily writes a custom manifest entry and
        restores the original manifest after the test completes."""
        original = open(MANIFEST_PATH).read()

        def _inject(extra_entry: dict):
            mf = json.loads(original)
            mf = [e for e in mf if e.get("token") != self._SYNTHETIC_TOKEN]
            mf.append(extra_entry)
            with open(MANIFEST_PATH, "w") as _f:
                json.dump(mf, _f, indent=4)

        yield _inject

        with open(MANIFEST_PATH, "w") as _f:
            _f.write(original)

    def test_missing_issue_n_in_manifest_yields_409(
        self, _synthetic_lump, _patch_manifest
    ):
        """issue_n absent from a dot_name entry must cause HTTP 409."""
        from server.app import app as _flask_app

        dot_name = "SyntheticEndpointTest"
        lump_bytes = _synthetic_lump
        number = hashlib.sha256(
            dot_name.encode("utf-8") + lump_bytes
        ).hexdigest()[:8]
        filename = f"{dot_name}.1.{number}.lump"

        # Manifest entry with dot_name but NO issue_n
        _patch_manifest({
            "token": self._SYNTHETIC_TOKEN,
            "dot_name": dot_name,
            # issue_n intentionally absent
            "filename": filename,
        })

        with _flask_app.test_client() as client:
            resp = client.get(f'/api/lump/{self._SYNTHETIC_TOKEN}')

        assert resp.status_code == 409, (
            f"Expected 409 when manifest entry has dot_name but no issue_n, "
            f"got {resp.status_code}.\n"
            "check_lump_canonical_integrity must treat missing issue_n as an "
            "invariant violation for every dot_name entry."
        )

    def test_zero_issue_n_in_manifest_yields_409(
        self, _synthetic_lump, _patch_manifest
    ):
        """issue_n=0 (non-positive) in a dot_name entry must cause HTTP 409."""
        from server.app import app as _flask_app

        dot_name = "SyntheticEndpointTest"
        lump_bytes = _synthetic_lump
        number = hashlib.sha256(
            dot_name.encode("utf-8") + lump_bytes
        ).hexdigest()[:8]
        # filename uses issue 0 — non-positive, invalid
        filename = f"{dot_name}.0.{number}.lump"

        _patch_manifest({
            "token": self._SYNTHETIC_TOKEN,
            "dot_name": dot_name,
            "issue_n": 0,
            "filename": filename,
        })

        with _flask_app.test_client() as client:
            resp = client.get(f'/api/lump/{self._SYNTHETIC_TOKEN}')

        assert resp.status_code == 409, (
            f"Expected 409 when manifest entry has issue_n=0 (non-positive), "
            f"got {resp.status_code}."
        )


# ---------------------------------------------------------------------------
# R21b — save produces canonical filename; subsequent fetch validates OK
# ---------------------------------------------------------------------------

_TEST_TOKEN   = "fe001234"   # Synthetic token; not present in real manifest
_TEST_ABS     = "EndpointTest"
_TEST_LUMP_WORDS = 64        # n_minus_6=0 → lump_size=64


def _build_test_words():
    """Return a 64-word list that passes save_lump() pre-flight.

    Header: magic=0x1F, n_minus_6=0 (lump_size=64), cw=1 (RETURN), typ=0,
    cc=0 (server will bump to 1 and inject self-GT at word[63]).
    Word[1] = RETURN opcode (op=0x12=18, bits[31:27]=0b10010).
    """
    hdr   = (0x1F << 27) | (0 << 23) | (1 << 10) | (0 << 8) | 0   # 0xF8000400
    ret_w = 0x90000000   # RETURN: op=18 (bits[31:27]=0b10010), everything else 0
    words = [hdr, ret_w] + [0] * (_TEST_LUMP_WORDS - 2)
    return words


class TestR21b_SaveThenFetch:
    """POST /api/lumps/save writes a canonical filename and sets dot_name /
    issue_n in the manifest entry.  Immediately-following GET /api/lump/<token>
    passes check_lump_canonical_integrity and returns 200.
    """

    @pytest.fixture(autouse=True)
    def _cleanup(self):
        """Remove all test artefacts (files + manifest entry) after each test."""
        yield
        # Remove files matching our test token / dot_name
        _pat = re.compile(
            rf'^({re.escape(_TEST_ABS)}\.\d+\.[0-9a-f]{{8}}|{re.escape(_TEST_TOKEN)})'
            r'\.(lump|json)$',
            re.IGNORECASE,
        )
        for fn in (os.listdir(LUMPS_DIR) if os.path.isdir(LUMPS_DIR) else []):
            if _pat.match(fn):
                try:
                    fp = os.path.join(LUMPS_DIR, fn)
                    if os.path.islink(fp) or os.path.isfile(fp):
                        os.remove(fp)
                except OSError:
                    pass
        # Remove test manifest entry
        if os.path.isfile(MANIFEST_PATH):
            try:
                with open(MANIFEST_PATH) as _f:
                    mf = json.load(_f)
                mf = [e for e in mf if e.get("token") != _TEST_TOKEN]
                with open(MANIFEST_PATH, "w") as _f:
                    json.dump(mf, _f, indent=4)
            except Exception:
                pass
        # Evict from LAZY_LUMPS
        try:
            from server.app import LAZY_LUMPS
            LAZY_LUMPS.pop(_TEST_TOKEN, None)
            LAZY_LUMPS.pop(_TEST_TOKEN.lstrip('0') or '0', None)
        except Exception:
            pass

    def _post_save(self, client, abs_name=_TEST_ABS, token=_TEST_TOKEN):
        payload = {
            "binary": _build_test_words(),
            "metadata": {
                "abstraction": abs_name,
                "token":       token,
                "issue_number": 1,
                "cw": 1,
                "cc": 1,
            },
        }
        return client.post(
            "/api/lumps/save",
            data=json.dumps(payload),
            content_type="application/json",
        )

    def test_save_returns_canonical_filename(self):
        """save_lump() response must include a canonical Dot.Name.n.N.lump filename."""
        from server.app import app as _flask_app

        with _flask_app.test_client() as client:
            resp = self._post_save(client)

        assert resp.status_code == 200, (
            f"POST /api/lumps/save returned {resp.status_code}:\n"
            f"{resp.get_data(as_text=True)[:400]}"
        )
        body  = resp.get_json()
        lump_fn = body.get("lump", "")
        assert _CANONICAL_RE.match(lump_fn), (
            f"save_lump() returned non-canonical filename {lump_fn!r}.\n"
            "save_lump() must call to_dot_name() and compute_number() and use\n"
            "Dot.Name.issue_n.Number.lump format."
        )
        m = _CANONICAL_RE.match(lump_fn)
        assert m.group(1) == _TEST_ABS, (
            f"Filename name segment {m.group(1)!r} != {_TEST_ABS!r}.\n"
            "to_dot_name() result must equal the abstraction name when it contains\n"
            "no spaces, underscores, or parentheses."
        )

    def test_save_sets_dot_name_in_manifest(self):
        """Manifest entry written by save_lump() must have dot_name + issue_n."""
        from server.app import app as _flask_app

        with _flask_app.test_client() as client:
            resp = self._post_save(client)

        assert resp.status_code == 200, (
            f"POST /api/lumps/save returned {resp.status_code}"
        )
        mf = _load_manifest()
        entry = next((e for e in mf if e.get("token") == _TEST_TOKEN), None)
        assert entry is not None, (
            f"No manifest entry found for token {_TEST_TOKEN} after save."
        )
        assert entry.get("dot_name") == _TEST_ABS, (
            f"manifest entry dot_name={entry.get('dot_name')!r} != {_TEST_ABS!r}."
        )
        assert entry.get("issue_n") == 1, (
            f"manifest entry issue_n={entry.get('issue_n')!r} != 1."
        )

    def test_save_then_get_yields_200(self):
        """GET /api/lump/<token> immediately after save must return 200.

        This proves that save_lump() wrote bytes whose Number matches the
        filename embedded in the manifest, so check_lump_canonical_integrity
        passes without returning 409.
        """
        from server.app import app as _flask_app

        with _flask_app.test_client() as client:
            save_resp = self._post_save(client)
            assert save_resp.status_code == 200, (
                f"save_lump returned {save_resp.status_code}:\n"
                f"{save_resp.get_data(as_text=True)[:400]}"
            )

            get_resp = client.get(f'/api/lump/{_TEST_TOKEN}')

        assert get_resp.status_code == 200, (
            f"GET /api/lump/{_TEST_TOKEN} returned {get_resp.status_code} after save.\n"
            "check_lump_canonical_integrity failed for a freshly-saved canonical lump.\n"
            f"Response: {get_resp.get_data(as_text=True)[:400]}"
        )
