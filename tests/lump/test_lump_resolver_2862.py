"""Adversarial coverage for Task 2862 — fail-closed GET /api/lump/<token>.

The server resolver (server.lump_integrity.resolve_canonical_lump, wired into
GET /api/lump/<token> in server.app.get_lump) must:

  * validate token format exactly 8 or 24 hex; reject anything else (HTTP 400);
  * for a 24-hex Outform token use its FINAL 8 hex as the 32-bit cache index
    T (Words1-3 protocol carries T in W3);
  * require exactly one canonical manifest record per token, cross-check
    canonical filename, dot_name, positive issue_n, binary_hash, identity_hash
    and sidecar consistency, and reject ambiguous collisions / mismatches;
  * NOT mutate or backfill metadata on GET;
  * bind the response to canonical dot_name / issue_n / identity_hash /
    binary_hash / cache token via X-Lump-* headers;
  * preserve legacy 8-hex entries but mark them untrusted so secure simulator
    promotion can reject them.

These are unit-level tests of the pure resolver plus a handful of endpoint
tests through the Flask test client.  The endpoint tests borrow the
module-scoped snapshot/restore fixture from test_lump_endpoints.py so a
mid-suite failure cannot corrupt server/lumps/.
"""

import hashlib
import json
import os
import sys
import struct

import pytest

# Make server/lump_integrity importable without triggering Flask startup.
_SERVER_DIR = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "server")
)
if _SERVER_DIR not in sys.path:
    sys.path.insert(0, _SERVER_DIR)

import lump_integrity as L
from lump_integrity import (
    normalize_lump_token,
    resolve_canonical_lump,
    canonical_binding_headers,
    compute_number,
    LumpTokenError,
)

LUMPS_DIR = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "server", "lumps")
)
MANIFEST_PATH = os.path.join(LUMPS_DIR, "manifest.json")


# ---------------------------------------------------------------------------
# Token-format validation (fail-closed)
# ---------------------------------------------------------------------------

class TestTokenNormalization:
    def test_8_hex_is_cache_token(self):
        tok = normalize_lump_token("00001200")
        assert tok["kind"] == "cache"
        assert tok["key8"] == "00001200"
        assert tok["ide_token"] is None

    def test_24_hex_uses_final_8_hex_as_T(self):
        # W0||W1||W2 style rendering; the cache index T lives in W3 = final 8 hex.
        w0 = "aabbccdd"
        w1 = "11223344"
        t  = "00001200"
        tok = normalize_lump_token(w0 + w1 + t)
        assert tok["kind"] == "outform"
        assert tok["key8"] == t, "24-hex token must resolve T from the FINAL 8 hex"
        assert tok["ide_token"] == (w0 + w1 + t)

    def test_uppercase_is_lowered(self):
        assert normalize_lump_token("00ABCDEF")["key8"] == "00abcdef"

    @pytest.mark.parametrize("bad", [
        "", "1", "123", "1234567",            # too short
        "123456789",                          # 9 — between 8 and 24
        "0123456789abcdef0123456",            # 23 — one short of 24
        "0123456789abcdef012345678",          # 25 — one over 24
        "zzzzzzzz",                           # non-hex, right length
        "gggggggggggggggggggggggg",           # non-hex, 24 chars
    ])
    def test_invalid_lengths_and_chars_rejected(self, bad):
        with pytest.raises(LumpTokenError):
            normalize_lump_token(bad)

    def test_non_string_rejected(self):
        with pytest.raises(LumpTokenError):
            normalize_lump_token(12345678)


# ---------------------------------------------------------------------------
# Resolver — synthetic manifest built in a temp dir (no server/lumps churn)
# ---------------------------------------------------------------------------

def _mk_lump_bytes(nwords=64):
    hdr   = (0x1F << 27) | (0 << 23) | (1 << 10) | (0 << 8) | 0x00
    ret_w = 0x90000000
    words = [hdr, ret_w] + [0] * (nwords - 2)
    return struct.pack(f">{nwords}I", *words)


def _write_manifest(dirpath, records):
    with open(os.path.join(dirpath, "manifest.json"), "w") as fh:
        json.dump(records, fh, indent=2)


class TestResolverCanonical:
    def _canonical_entry(self, tmp_path, token, dot_name, issue_n, lump_bytes,
                         sidecar=None):
        number = compute_number(dot_name, lump_bytes)
        filename = f"{dot_name}.{issue_n}.{number}.lump"
        sc_name = f"{dot_name}.{issue_n}.{number}.json"
        entry = {
            "token": token, "dot_name": dot_name, "issue_n": issue_n,
            "filename": filename, "sidecar_file": sc_name,
        }
        if sidecar is not None:
            with open(os.path.join(str(tmp_path), sc_name), "w") as fh:
                json.dump(sidecar, fh)
        return entry

    def test_trusted_when_all_checks_pass(self, tmp_path):
        raw = _mk_lump_bytes()
        token = compute_number("MyThing", raw)
        identity_hash = hashlib.sha256(b"MyThing#1").hexdigest()
        entry = self._canonical_entry(
            tmp_path, token, "MyThing", 1, raw,
            sidecar={
                "binary_hash": hashlib.sha256(raw).hexdigest(),
                "identity_hash": identity_hash,
            },
        )
        _write_manifest(str(tmp_path), [entry])
        r = resolve_canonical_lump(str(tmp_path), token, raw)
        assert r["ok"] and r["trusted"]
        assert r["dot_name"] == "MyThing" and r["issue_n"] == 1
        assert r["binary_hash"] == hashlib.sha256(raw).hexdigest()

    def test_tampered_bytes_number_mismatch(self, tmp_path):
        raw = _mk_lump_bytes()
        entry = self._canonical_entry(tmp_path, "00abcdef", "MyThing", 1, raw)
        _write_manifest(str(tmp_path), [entry])
        r = resolve_canonical_lump(str(tmp_path), "00abcdef", raw + b"\x00\x00\x00\x00")
        assert not r["ok"] and r["reason"] == "number-mismatch"

    def test_ambiguous_canonical_collision_rejected(self, tmp_path):
        raw = _mk_lump_bytes()
        e1 = self._canonical_entry(tmp_path, "00abcdef", "AlphaThing", 1, raw)
        e2 = self._canonical_entry(tmp_path, "00abcdef", "BetaThing", 1, raw)
        _write_manifest(str(tmp_path), [e1, e2])
        r = resolve_canonical_lump(str(tmp_path), "00abcdef", raw)
        assert not r["ok"] and r["reason"] == "ambiguous-canonical-collision"

    def test_missing_issue_n_rejected(self, tmp_path):
        raw = _mk_lump_bytes()
        number = compute_number("MyThing", raw)
        _write_manifest(str(tmp_path), [{
            "token": "00abcdef", "dot_name": "MyThing",
            "filename": f"MyThing.1.{number}.lump",
        }])
        r = resolve_canonical_lump(str(tmp_path), "00abcdef", raw)
        assert not r["ok"] and r["reason"] == "missing-issue-n"

    def test_zero_issue_n_rejected(self, tmp_path):
        raw = _mk_lump_bytes()
        number = compute_number("MyThing", raw)
        _write_manifest(str(tmp_path), [{
            "token": "00abcdef", "dot_name": "MyThing", "issue_n": 0,
            "filename": f"MyThing.0.{number}.lump",
        }])
        r = resolve_canonical_lump(str(tmp_path), "00abcdef", raw)
        assert not r["ok"] and r["reason"] == "invalid-issue-n"

    def test_filename_dotname_mismatch_rejected(self, tmp_path):
        raw = _mk_lump_bytes()
        number = compute_number("Wrong", raw)
        _write_manifest(str(tmp_path), [{
            "token": "00abcdef", "dot_name": "MyThing", "issue_n": 1,
            "filename": f"Wrong.1.{number}.lump",
        }])
        r = resolve_canonical_lump(str(tmp_path), "00abcdef", raw)
        assert not r["ok"] and r["reason"] == "filename-dotname-mismatch"

    def test_binary_hash_mismatch_rejected(self, tmp_path):
        raw = _mk_lump_bytes()
        entry = self._canonical_entry(
            tmp_path, "00abcdef", "MyThing", 1, raw,
            sidecar={"binary_hash": "deadbeef" * 8},
        )
        _write_manifest(str(tmp_path), [entry])
        r = resolve_canonical_lump(str(tmp_path), "00abcdef", raw)
        assert not r["ok"] and r["reason"] == "binary-hash-mismatch"

    def test_identity_hash_mismatch_rejected(self, tmp_path):
        raw = _mk_lump_bytes()
        entry = self._canonical_entry(
            tmp_path, "00abcdef", "MyThing", 1, raw,
            sidecar={
                "binary_hash": hashlib.sha256(raw).hexdigest(),
                "identity_string": "MyThing#1",
                "identity_hash": "cafebabe" * 8,  # does not match sha256(string)
            },
        )
        _write_manifest(str(tmp_path), [entry])
        r = resolve_canonical_lump(str(tmp_path), "00abcdef", raw)
        assert not r["ok"] and r["reason"] == "identity-hash-mismatch"

    def test_valid_identity_hash_binds_header(self, tmp_path):
        raw = _mk_lump_bytes()
        token = compute_number("MyThing", raw)
        id_string = "MyThing#1"
        id_hash = hashlib.sha256(id_string.encode()).hexdigest()
        entry = self._canonical_entry(
            tmp_path, token, "MyThing", 1, raw,
            sidecar={
                "binary_hash": hashlib.sha256(raw).hexdigest(),
                "identity_string": id_string,
                "identity_hash": id_hash,
            },
        )
        _write_manifest(str(tmp_path), [entry])
        r = resolve_canonical_lump(str(tmp_path), token, raw)
        assert r["ok"] and r["trusted"]
        h = canonical_binding_headers(r)
        assert h["X-Lump-Trust"] == "canonical"
        assert h["X-Lump-Dot-Name"] == "MyThing"
        assert h["X-Lump-Issue-N"] == "1"
        assert h["X-Lump-Identity-Hash"] == f"sha256:{id_hash}"
        assert h["X-Lump-Cache-Token"] == token

    def test_historical_lookup_alias_never_becomes_trusted_T(self, tmp_path):
        raw = _mk_lump_bytes()
        canonical_t = compute_number("MyThing", raw)
        alias = "00abcdef"
        assert alias != canonical_t
        identity_hash = hashlib.sha256(b"MyThing#1").hexdigest()
        entry = self._canonical_entry(
            tmp_path, alias, "MyThing", 1, raw,
            sidecar={
                "binary_hash": hashlib.sha256(raw).hexdigest(),
                "identity_hash": identity_hash,
            },
        )
        _write_manifest(str(tmp_path), [entry])
        r = resolve_canonical_lump(str(tmp_path), alias, raw)
        assert r["ok"] and not r["trusted"]
        assert r["reason"] == "lookup-alias-untrusted"
        assert r["cache_token"] == canonical_t
        h = canonical_binding_headers(r)
        assert h["X-Lump-Trust"] == "untrusted"
        assert h["X-Lump-Cache-Token"] == canonical_t

    def test_missing_identity_hash_is_explicitly_untrusted(self, tmp_path):
        raw = _mk_lump_bytes()
        entry = self._canonical_entry(
            tmp_path, "00abcdef", "MyThing", 1, raw,
            sidecar={"binary_hash": hashlib.sha256(raw).hexdigest()},
        )
        _write_manifest(str(tmp_path), [entry])
        r = resolve_canonical_lump(str(tmp_path), "00abcdef", raw)
        assert r["ok"] and not r["trusted"]
        assert r["reason"] == "incomplete-identity-untrusted"
        assert canonical_binding_headers(r)["X-Lump-Trust"] == "untrusted"

    def test_manifest_and_sidecar_identity_conflict_rejected(self, tmp_path):
        raw = _mk_lump_bytes()
        expected = hashlib.sha256(b"MyThing#1").hexdigest()
        entry = self._canonical_entry(
            tmp_path, "00abcdef", "MyThing", 1, raw,
            sidecar={
                "binary_hash": hashlib.sha256(raw).hexdigest(),
                "identity_hash": expected,
            },
        )
        entry["identity_hash"] = "ab" * 32
        _write_manifest(str(tmp_path), [entry])
        r = resolve_canonical_lump(str(tmp_path), "00abcdef", raw)
        assert not r["ok"]
        assert r["reason"] == "identity-hash-metadata-conflict"

    def test_sidecar_dotname_contradiction_rejected(self, tmp_path):
        raw = _mk_lump_bytes()
        entry = self._canonical_entry(
            tmp_path, "00abcdef", "MyThing", 1, raw,
            sidecar={"dot_name": "Impostor",
                     "binary_hash": hashlib.sha256(raw).hexdigest()},
        )
        _write_manifest(str(tmp_path), [entry])
        r = resolve_canonical_lump(str(tmp_path), "00abcdef", raw)
        assert not r["ok"] and r["reason"] == "sidecar-dotname-mismatch"

    def test_malformed_sidecar_fails_closed(self, tmp_path):
        raw = _mk_lump_bytes()
        number = compute_number("MyThing", raw)
        sc_name = f"MyThing.1.{number}.json"
        with open(os.path.join(str(tmp_path), sc_name), "w") as fh:
            fh.write("{ this is not json ")
        _write_manifest(str(tmp_path), [{
            "token": "00abcdef", "dot_name": "MyThing", "issue_n": 1,
            "filename": f"MyThing.1.{number}.lump", "sidecar_file": sc_name,
        }])
        r = resolve_canonical_lump(str(tmp_path), "00abcdef", raw)
        assert not r["ok"] and r["reason"] == "sidecar-unreadable"


class TestResolverLegacy:
    def test_legacy_entry_untrusted(self, tmp_path):
        raw = _mk_lump_bytes()
        _write_manifest(str(tmp_path), [{
            "token": "059dc47f", "abstraction": "Legacy",
            # no dot_name — legacy 8-hex entry
        }])
        r = resolve_canonical_lump(str(tmp_path), "059dc47f", raw)
        assert r["ok"] and not r["trusted"]
        assert r["reason"] == "legacy-untrusted"
        h = canonical_binding_headers(r)
        assert h["X-Lump-Trust"] == "untrusted"
        assert "X-Lump-Dot-Name" not in h  # nothing to bind — promotion must reject

    def test_unknown_token_untrusted(self, tmp_path):
        raw = _mk_lump_bytes()
        _write_manifest(str(tmp_path), [])
        r = resolve_canonical_lump(str(tmp_path), "12345678", raw)
        assert r["ok"] and not r["trusted"]
        assert r["reason"] == "not-in-manifest-untrusted"

    def test_missing_manifest_fails_closed(self, tmp_path):
        raw = _mk_lump_bytes()
        r = resolve_canonical_lump(str(tmp_path), "12345678", raw)
        assert not r["ok"] and r["reason"] == "manifest-unreadable"

    def test_bad_cache_token_fails_closed(self, tmp_path):
        _write_manifest(str(tmp_path), [])
        r = resolve_canonical_lump(str(tmp_path), "nothex", _mk_lump_bytes())
        assert not r["ok"] and r["reason"] == "bad-cache-token"


# ---------------------------------------------------------------------------
# No-mutation guarantee on GET
# ---------------------------------------------------------------------------

class TestNoMutationOnGet:
    def test_resolver_does_not_write_manifest_or_sidecar(self, tmp_path):
        raw = _mk_lump_bytes()
        number = compute_number("MyThing", raw)
        sc_name = f"MyThing.1.{number}.json"
        sc = {"binary_hash": hashlib.sha256(raw).hexdigest()}  # no identity_hash
        with open(os.path.join(str(tmp_path), sc_name), "w") as fh:
            json.dump(sc, fh)
        entry = {
            "token": "00abcdef", "dot_name": "MyThing", "issue_n": 1,
            "filename": f"MyThing.1.{number}.lump", "sidecar_file": sc_name,
        }
        _write_manifest(str(tmp_path), [entry])

        before_mf = open(os.path.join(str(tmp_path), "manifest.json")).read()
        before_sc = open(os.path.join(str(tmp_path), sc_name)).read()

        resolve_canonical_lump(str(tmp_path), "00abcdef", raw)

        after_mf = open(os.path.join(str(tmp_path), "manifest.json")).read()
        after_sc = open(os.path.join(str(tmp_path), sc_name)).read()
        assert before_mf == after_mf, "resolver must not mutate manifest on GET"
        assert before_sc == after_sc, "resolver must not backfill sidecar on GET"


# ---------------------------------------------------------------------------
# Endpoint-level adversarial tests (through Flask test client)
# ---------------------------------------------------------------------------

# Reuse the destructive-module snapshot/restore fixture so a failure here can
# never corrupt the real server/lumps directory.
from tests.lump.test_lump_endpoints import lumps_dir_snapshot  # noqa: F401,E402


class TestEndpointTokenFormat:
    @pytest.mark.parametrize("bad", [
        "123", "123456789", "zzzzzzzz",
        "0123456789abcdef0123456",     # 23
        "0123456789abcdef012345678",   # 25
    ])
    def test_bad_token_format_yields_400(self, bad):
        from server.app import app as _flask_app
        with _flask_app.test_client() as client:
            resp = client.get(f"/api/lump/{bad}")
        assert resp.status_code == 400, (
            f"Expected 400 for malformed token {bad!r}, got {resp.status_code}"
        )
        body = resp.get_json()
        assert body and "error" in body

    def test_24hex_token_resolves_via_final_8_hex(self):
        """A 24-hex Outform token whose final 8 hex are a known cache token must
        resolve to the same lump as the bare 8-hex token."""
        from server.app import app as _flask_app, LAZY_LUMPS

        # Find any loaded cache token.
        cache_tok = None
        for k in LAZY_LUMPS:
            if len(k) == 8 and all(c in "0123456789abcdef" for c in k):
                cache_tok = k
                break
        if cache_tok is None:
            pytest.skip("No 8-hex cache token loaded in LAZY_LUMPS.")

        ide_token = "aabbccdd11223344" + cache_tok
        with _flask_app.test_client() as client:
            r8 = client.get(f"/api/lump/{cache_tok}")
            r24 = client.get(f"/api/lump/{ide_token}")
        assert r24.status_code == r8.status_code
        if r8.status_code == 200:
            assert r24.data == r8.data, (
                "24-hex token must resolve T from its FINAL 8 hex (W3)"
            )


class TestEndpointTrustHeaders:
    def test_canonical_entry_serves_trusted_headers(self):
        """A valid canonical entry loaded at startup returns 200 with
        X-Lump-Trust: canonical plus the identity-binding headers."""
        from server.app import app as _flask_app, LAZY_LUMPS

        # Locate a canonical manifest entry whose bytes are in LAZY_LUMPS.
        with open(MANIFEST_PATH) as fh:
            manifest = json.load(fh)
        target = None
        for e in manifest:
            tok = e.get("token", "")
            filename_number = os.path.basename(e.get("filename", "")).rsplit(".", 2)
            is_canonical_t = (
                len(filename_number) == 3
                and filename_number[1].lower() == str(tok).lower()
            )
            if (e.get("dot_name") and e.get("identity_hash")
                    and is_canonical_t and tok in LAZY_LUMPS):
                target = e
                break
        if target is None:
            pytest.skip("No canonical entry with loaded bytes available.")

        with _flask_app.test_client() as client:
            resp = client.get(f"/api/lump/{target['token']}")
        assert resp.status_code == 200
        assert resp.headers.get("X-Lump-Trust") == "canonical"
        assert resp.headers.get("X-Lump-Dot-Name") == target["dot_name"]
        assert resp.headers.get("X-Lump-Issue-N") == str(target["issue_n"])
        assert resp.headers.get("X-Lump-Binary-Hash", "").startswith("sha256:")
        assert resp.headers.get("X-Lump-Cache-Token") == target["token"]
