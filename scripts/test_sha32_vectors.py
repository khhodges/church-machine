"""
scripts/test_sha32_vectors.py

Canonical test-vector suite for sha32() and hkdf_sha256().

This file is the TRUTH TABLE for the Church Machine sha32 primitive and
HKDF key-derivation.  The C implementation in hardware/sha256.h and the
Python implementation in hardware/soc_combined/callhome_bridge.py must
both produce byte-identical output for every row in these tables.

Run:
    python -m pytest scripts/test_sha32_vectors.py -v
"""

import hashlib
import hmac as _hmac
import struct
import sys
import os
import pytest

# ---------------------------------------------------------------------------
# Reference implementations (authoritative — Python stdlib only)
# ---------------------------------------------------------------------------

def _sha32_ref(ogt: str) -> int:
    """Return first 4 bytes of SHA-256(ogt) as big-endian uint32."""
    d = hashlib.sha256(ogt.encode("utf-8")).digest()
    return struct.unpack(">I", d[:4])[0]


def _hmac_sha256_ref(key: bytes, msg: bytes) -> bytes:
    return _hmac.new(key, msg, hashlib.sha256).digest()


def _hkdf_sha256_ref(ikm: bytes, salt: bytes, info: bytes, length: int) -> bytes:
    """RFC 5869 HKDF-SHA256 reference implementation."""
    # Extract
    prk = _hmac_sha256_ref(salt, ikm)
    # Expand
    t, okm = b"", b""
    for i in range(1, (length // 32) + 2):
        t = _hmac_sha256_ref(prk, t + info + bytes([i]))
        okm += t
    return okm[:length]


# ---------------------------------------------------------------------------
# sha32 vectors — all 9 Core OGTs
# ---------------------------------------------------------------------------

SHA32_VECTORS = [
    # (ogt_string, expected_token_32)
    ("global.Core.BoardIdentity.boot",  0x68706247),
    ("global.Core.Heartbeat.boot",       0x416d6848),
    ("global.Core.FaultReporter.boot",  0x677d36a7),
    ("global.Core.PerfReporter.boot",   0xeb2b7554),
    ("global.Core.LumpLoader.boot",     0xd728290d),
    ("global.Core.TraceEmitter.boot",   0xa7ce2b32),
    ("global.Core.NSInspector.boot",    0x404c79d5),
    ("global.Core.MediaConsumer.boot",  0xe400ec35),
    ("global.Core.BrowseClient.boot",   0xe7eed989),
    # Edge cases
    ("",   0xe3b0c442),  # SHA256("") first 4 bytes
    ("a",  0xca978112),
    ("x" * 63,  0x75220b47),  # 63-byte OGT (near SHA-256 block-size boundary)
    ("x" * 255, 0xd22609da),  # 255-char OGT — exercises multi-block SHA-256
    # Unicode OGT — Ñ and ñ are 2-byte UTF-8 sequences (0xC3 0x91 and 0xC3 0xB1)
    # sha32("global.Core.Ñoño.boot") — verifies UTF-8 encoding, not Latin-1
    ("global.Core.\u00d1o\u00f1o.boot", 0x219e9c32),
]


@pytest.mark.parametrize("ogt,expected", SHA32_VECTORS)
def test_sha32_reference(ogt, expected):
    """Reference Python implementation matches hard-coded vector."""
    assert _sha32_ref(ogt) == expected, (
        f"sha32({ogt!r}) = {_sha32_ref(ogt):#010x}, expected {expected:#010x}"
    )


def test_sha32_bridge_matches_reference():
    """callhome_bridge.sha32() matches the reference for all 9 Core OGTs."""
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "hardware", "soc_combined"))
        from callhome_bridge import sha32 as bridge_sha32
    except (ImportError, SystemExit):
        pytest.skip("callhome_bridge not importable (serial dependency missing on CI)")
    for ogt, expected in SHA32_VECTORS:
        got = bridge_sha32(ogt)
        assert got == expected, (
            f"bridge.sha32({ogt!r}) = {got:#010x}, expected {expected:#010x}"
        )


# ---------------------------------------------------------------------------
# HKDF vectors — RFC 5869 Appendix A.1
# ---------------------------------------------------------------------------

HKDF_VECTORS = [
    {
        "label":    "RFC5869-A.1",
        "ikm":      bytes.fromhex("0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b"),
        "salt":     bytes.fromhex("000102030405060708090a0b0c"),
        "info":     bytes.fromhex("f0f1f2f3f4f5f6f7f8f9"),
        "length":   42,
        "expected": bytes.fromhex(
            "3cb25f25faacd57a90434f64d0362f2a"
            "2d2d0a90cf1a5a4c5db02d56ecc4c5bf"
            "34007208d5b887185865"
        ),
    },
    {
        "label":    "RFC5869-A.2",
        # Test Case 2 — longer IKM, no salt → use zero-filled salt per RFC
        "ikm":      bytes.fromhex(
            "000102030405060708090a0b0c0d0e0f"
            "101112131415161718191a1b1c1d1e1f"
            "202122232425262728292a2b2c2d2e2f"
            "303132333435363738393a3b3c3d3e3f"
            "404142434445464748494a4b4c4d4e4f"
        ),
        "salt":     bytes.fromhex(
            "606162636465666768696a6b6c6d6e6f"
            "707172737475767778797a7b7c7d7e7f"
            "808182838485868788898a8b8c8d8e8f"
            "909192939495969798999a9b9c9d9e9f"
            "a0a1a2a3a4a5a6a7a8a9aaabacadaeaf"
        ),
        "info":     bytes.fromhex(
            "b0b1b2b3b4b5b6b7b8b9babbbcbdbebf"
            "c0c1c2c3c4c5c6c7c8c9cacbcccdcecf"
            "d0d1d2d3d4d5d6d7d8d9dadbdcdddedf"
            "e0e1e2e3e4e5e6e7e8e9eaebecedeeef"
            "f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff"
        ),
        "length":   82,
        "expected": bytes.fromhex(
            "b11e398dc80327a1c8e7f78c596a4934"
            "4f012eda2d4efad8a050cc4c19afa97c"
            "59045a99cac7827271cb41c65e590e09"
            "da3275600c2f09b8367793a9aca3db71"
            "cc30c58179ec3e87c14c01d5c1f3434f"
            "1d87"
        ),
    },
]


@pytest.mark.parametrize("vec", HKDF_VECTORS, ids=lambda v: v["label"])
def test_hkdf_reference(vec):
    """Reference Python HKDF matches RFC 5869 test vectors."""
    got = _hkdf_sha256_ref(vec["ikm"], vec["salt"], vec["info"], vec["length"])
    assert got == vec["expected"], (
        f"{vec['label']}: got {got.hex()}, expected {vec['expected'].hex()}"
    )


def test_hkdf_bridge_matches_rfc():
    """callhome_bridge.hkdf_sha256() matches RFC 5869 A.1."""
    try:
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "hardware", "soc_combined"))
        from callhome_bridge import hkdf_sha256 as bridge_hkdf
    except (ImportError, SystemExit):
        pytest.skip("callhome_bridge not importable")
    vec = HKDF_VECTORS[0]
    got = bridge_hkdf(vec["ikm"], vec["salt"], vec["info"], vec["length"])
    assert got == vec["expected"]
