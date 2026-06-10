"""
scripts/test_key_derivation_vectors.py

Pytest suite for T0.4 per-abstraction key derivation.

Tests the Python reference implementation (derive_keys() in callhome_bridge.py)
against the canonical vector table defined here.  The same vectors are used by
the C test (hardware/key_derive_test.c) to verify byte-for-byte agreement
between C firmware and Python bridge.

Formula (spec-authoritative, CM_MSG Protocol Section 2.6):
    preimage  = uid_hi_BE4 || uid_lo_BE4 || ogt_utf8
    IKM       = SHA256(preimage)
    K_enc[16] = HKDF-SHA256(IKM, salt="CM_ENC_v3", info=ogt, len=16)
    K_mac[16] = HKDF-SHA256(IKM, salt="CM_MAC_v3", info=ogt, len=16)

Run:
    python -m pytest scripts/test_key_derivation_vectors.py -v
"""

import hashlib
import hmac as _hmac_mod
import sys
import os

import pytest

# ---------------------------------------------------------------------------
# Reference implementation (mirrors callhome_bridge.py derive_keys, no import)
# ---------------------------------------------------------------------------

def _hkdf_sha256(ikm: bytes, salt: bytes, info: bytes, length: int) -> bytes:
    """RFC 5869 HKDF-SHA256 — matches hardware/sha256.h hkdf_sha256() exactly."""
    prk = _hmac_mod.new(salt, ikm, hashlib.sha256).digest()
    t, okm = b"", b""
    for i in range(1, (length // 32) + 2):
        t = _hmac_mod.new(prk, t + info + bytes([i]), hashlib.sha256).digest()
        okm += t
    return okm[:length]


def _derive_keys_ref(uid_hi: int, uid_lo: int, ogt: str):
    """
    Reference key derivation — must match callhome_bridge.py derive_keys().
    Returns (k_enc_16_bytes, k_mac_16_bytes).
    """
    uid_bytes = uid_hi.to_bytes(4, "big") + uid_lo.to_bytes(4, "big")
    ogt_bytes = ogt.encode("utf-8")
    ikm = hashlib.sha256(uid_bytes + ogt_bytes).digest()
    k_enc = _hkdf_sha256(ikm, b"CM_ENC_v3", ogt_bytes, 16)
    k_mac = _hkdf_sha256(ikm, b"CM_MAC_v3", ogt_bytes, 16)
    return k_enc, k_mac


# ---------------------------------------------------------------------------
# Canonical vector table — truth for both Python and C implementations.
# Generated from the reference implementation above.  If these values ever
# need to change, bump the salts to CM_ENC_v4 / CM_MAC_v4 and update
# hardware/key_derive_vectors.h in the same commit.
# ---------------------------------------------------------------------------

# uid=0xC0FFEE0100000001 covers all 9 Core OGTs
_UID_HI = 0xC0FFEE01
_UID_LO = 0x00000001

VECTORS = [
    # (uid_hi, uid_lo, ogt, k_enc_hex, k_mac_hex)
    (_UID_HI, _UID_LO,
     "global.Core.BoardIdentity.boot",
     "ba9289a8ed79627b23078b0996443adb",
     "152a0279c48db63fc9380d9c3446d2d6"),

    (_UID_HI, _UID_LO,
     "global.Core.Heartbeat.boot",
     "69b101135d94bac1a4618763b993a666",
     "4c9235881bb916e9c27812ff2e7d1a10"),

    (_UID_HI, _UID_LO,
     "global.Core.FaultReporter.boot",
     "2e5391b2a382a33026e037ce4a3cee44",
     "e778dc03a8a9d8b2f60392c1d6abadfd"),

    (_UID_HI, _UID_LO,
     "global.Core.PerfReporter.boot",
     "e23be3d49c87e8331ba9742274653a4e",
     "75118d871c3606fa88833f62531c0f21"),

    (_UID_HI, _UID_LO,
     "global.Core.LumpLoader.boot",
     "366f52230eb1b894b2dfa8c8baa7ac73",
     "7f89cdbbe1eb520b9d282e6cc193d4b5"),

    (_UID_HI, _UID_LO,
     "global.Core.TraceEmitter.boot",
     "5d3d0c27c47e9c1f06c697e82b6a4562",
     "4db3e96fbaab5a64e386730a7ed29f6c"),

    (_UID_HI, _UID_LO,
     "global.Core.NSInspector.boot",
     "ccc7e5656fc1139ad3cae440473e4670",
     "84138636b581ab860db389927788e8b3"),

    (_UID_HI, _UID_LO,
     "global.Core.MediaConsumer.boot",
     "68e2107575fd6be972779c1e833eac3c",
     "e3376ae415947d8ffc07dfb5541cbef0"),

    (_UID_HI, _UID_LO,
     "global.Core.BrowseClient.boot",
     "b240dea6556fe78a6aaa7b3361d1d431",
     "ebac6394afa10118faba6a73a493e443"),

    # Edge case: zero UID
    (0x00000000, 0x00000000,
     "global.Core.Heartbeat.boot",
     "3147184ec6763981fcd5ae5090e91bb8",
     "5406fc33991cfad07a79b41a429ef42c"),

    # Edge case: long OGT (~78 chars)
    (_UID_HI, _UID_LO,
     "global.Telecommunications.MargaretHodges.family-hub-extended-name-for-testing",
     "8ccaf1b4b4d5e680f413f4eac09b266a",
     "95bc037f814abdb0fb7268522250edfd"),
]


# ---------------------------------------------------------------------------
# Tests against the reference implementation
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("uid_hi,uid_lo,ogt,k_enc_hex,k_mac_hex", VECTORS)
def test_derive_keys_reference(uid_hi, uid_lo, ogt, k_enc_hex, k_mac_hex):
    """Reference Python implementation matches canonical vectors."""
    k_enc, k_mac = _derive_keys_ref(uid_hi, uid_lo, ogt)
    assert k_enc.hex() == k_enc_hex, (
        f"K_enc mismatch for {ogt!r}\n"
        f"  expected: {k_enc_hex}\n"
        f"  got:      {k_enc.hex()}"
    )
    assert k_mac.hex() == k_mac_hex, (
        f"K_mac mismatch for {ogt!r}\n"
        f"  expected: {k_mac_hex}\n"
        f"  got:      {k_mac.hex()}"
    )


@pytest.mark.parametrize("uid_hi,uid_lo,ogt,k_enc_hex,k_mac_hex", VECTORS)
def test_derive_keys_bridge(uid_hi, uid_lo, ogt, k_enc_hex, k_mac_hex):
    """callhome_bridge.derive_keys() matches canonical vectors."""
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "hardware", "soc_combined"))
    from callhome_bridge import derive_keys
    k_enc, k_mac = derive_keys(uid_hi, uid_lo, ogt)
    assert k_enc.hex() == k_enc_hex, (
        f"Bridge K_enc mismatch for {ogt!r}\n"
        f"  expected: {k_enc_hex}\n"
        f"  got:      {k_enc.hex()}"
    )
    assert k_mac.hex() == k_mac_hex, (
        f"Bridge K_mac mismatch for {ogt!r}\n"
        f"  expected: {k_mac_hex}\n"
        f"  got:      {k_mac.hex()}"
    )


def test_key_length():
    """Keys are exactly 16 bytes (128-bit)."""
    k_enc, k_mac = _derive_keys_ref(_UID_HI, _UID_LO, "global.Core.Heartbeat.boot")
    assert len(k_enc) == 16, f"K_enc length {len(k_enc)} != 16"
    assert len(k_mac) == 16, f"K_mac length {len(k_mac)} != 16"


def test_keys_differ_per_ogt():
    """Different OGTs produce different keys — no accidental collision."""
    seen_enc = set()
    seen_mac = set()
    for uid_hi, uid_lo, ogt, _, _ in VECTORS:
        k_enc, k_mac = _derive_keys_ref(uid_hi, uid_lo, ogt)
        enc_hex = k_enc.hex()
        mac_hex = k_mac.hex()
        assert enc_hex not in seen_enc, f"K_enc collision for {ogt!r}"
        assert mac_hex not in seen_mac, f"K_mac collision for {ogt!r}"
        seen_enc.add(enc_hex)
        seen_mac.add(mac_hex)


def test_enc_mac_differ():
    """K_enc and K_mac are never equal for any vector."""
    for uid_hi, uid_lo, ogt, k_enc_hex, k_mac_hex in VECTORS:
        assert k_enc_hex != k_mac_hex, (
            f"K_enc == K_mac for {ogt!r} — salts are not differentiating"
        )


def test_uid_changes_keys():
    """Different board UIDs produce different keys for the same OGT."""
    ogt = "global.Core.Heartbeat.boot"
    k1_enc, k1_mac = _derive_keys_ref(0xC0FFEE01, 0x00000001, ogt)
    k2_enc, k2_mac = _derive_keys_ref(0xDEADBEEF, 0x12345678, ogt)
    assert k1_enc != k2_enc, "Same K_enc for different boards — derivation broken"
    assert k1_mac != k2_mac, "Same K_mac for different boards — derivation broken"


def test_zero_uid_not_all_zeros():
    """Zero UID does not produce all-zero keys."""
    k_enc, k_mac = _derive_keys_ref(0, 0, "global.Core.Heartbeat.boot")
    assert k_enc != bytes(16), "K_enc is all-zero for zero UID"
    assert k_mac != bytes(16), "K_mac is all-zero for zero UID"
