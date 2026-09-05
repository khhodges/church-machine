"""Fail-closed canonical LUMP resolver coverage."""

import hashlib
import json
import struct
import sys
from pathlib import Path

import pytest

SERVER = Path(__file__).resolve().parents[2] / "server"
sys.path.insert(0, str(SERVER))
from lump_integrity import (  # noqa: E402
    LumpTokenError,
    canonical_binding_headers,
    compute_number,
    normalize_lump_token,
    resolve_canonical_lump,
)


def _binary():
    header = (0x1F << 27) | (1 << 10)
    return struct.pack(">64I", header, 0x90000000, *([0] * 62))


def _fixture(directory, lookup=None, approve=True):
    raw = _binary()
    dot_name = "MyThing"
    issue = 1
    number = compute_number(dot_name, raw)
    token = lookup or number
    filename = f"{dot_name}.{issue}.{number}.lump"
    (directory / "manifest.json").write_text(json.dumps([{
        "token": token, "filename": filename,
    }]))
    (directory / filename).write_bytes(raw)
    digest = hashlib.sha256(raw).hexdigest()
    identity_hash = hashlib.sha256(b"MyThing#1").hexdigest()
    approvals = {}
    if approve:
        approvals[digest] = {
            "binary_hash": digest, "filename": filename,
            "dot_name": dot_name, "issue_n": issue,
            "identity_hash": identity_hash,
        }
    (directory / "approvals.json").write_text(json.dumps({
        "version": 1, "algorithm": "sha256", "approvals": approvals,
    }))
    return raw, token, number


@pytest.mark.parametrize("value,key", [
    ("00ABCDEF", "00abcdef"),
    ("aabbccdd1122334400001200", "00001200"),
])
def test_token_normalization(value, key):
    assert normalize_lump_token(value)["key8"] == key


@pytest.mark.parametrize("bad", ["", "123", "123456789", "z" * 8, 12345678])
def test_invalid_tokens_fail_closed(bad):
    with pytest.raises(LumpTokenError):
        normalize_lump_token(bad)


def test_exact_hash_approval_produces_canonical_binding(tmp_path):
    raw, token, _ = _fixture(tmp_path)
    result = resolve_canonical_lump(str(tmp_path), token, raw)
    assert result["ok"] and result["trusted"] and result["identity_verified"]
    headers = canonical_binding_headers(result)
    assert headers["X-Lump-Trust"] == "canonical"
    assert headers["X-Lump-Dot-Name"] == "MyThing"
    assert headers["X-Lump-Issue-N"] == "1"


def test_missing_approval_fails_closed(tmp_path):
    raw, token, _ = _fixture(tmp_path, approve=False)
    result = resolve_canonical_lump(str(tmp_path), token, raw)
    assert not result["ok"]
    assert result["reason"] == "approval-missing"


def test_tampered_binary_fails_filename_integrity(tmp_path):
    raw, token, _ = _fixture(tmp_path)
    result = resolve_canonical_lump(str(tmp_path), token, raw[:-4] + b"\0\0\0\1")
    assert not result["ok"]
    assert result["reason"] == "canonical-invalid"


def test_lookup_alias_never_becomes_trusted_identity(tmp_path):
    raw, alias, number = _fixture(tmp_path, lookup="00abcdef")
    result = resolve_canonical_lump(str(tmp_path), alias, raw)
    assert result["ok"] and not result["trusted"]
    assert result["reason"] == "lookup-alias-untrusted"
    assert result["cache_token"] == number
    assert canonical_binding_headers(result)["X-Lump-Trust"] == "untrusted"


def test_manifest_and_approval_reads_do_not_mutate_files(tmp_path):
    raw, token, _ = _fixture(tmp_path)
    before = {path.name: path.read_bytes() for path in tmp_path.iterdir()}
    resolve_canonical_lump(str(tmp_path), token, raw)
    after = {path.name: path.read_bytes() for path in tmp_path.iterdir()}
    assert before == after