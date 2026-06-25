"""scripts/test_wukong_protocol.py — Dry-run pytest for the Wukong UDP wire protocol.

Tests parse_callhome_frame(), build_callhome_frame(), build_lump_serve_response(),
and parse_lump_serve_response() in server/wukong_udp.py without requiring
physical hardware or a running server.

Run:
    python -m pytest scripts/test_wukong_protocol.py -v
"""

import sys
import os
import struct
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'server'))

from wukong_udp import (
    CALLHOME_MAGIC,
    LUMPSERVE_MAGIC,
    ETHERNET_TOKEN,
    CALLHOME_MIN_LEN,
    WUKONG_PORT,
    parse_callhome_frame,
    build_callhome_frame,
    build_lump_serve_response,
    parse_lump_serve_response,
)


# ── Test fixtures ─────────────────────────────────────────────────────────────

TEST_MAC      = b'\x02\xCE\x11\x00\x00\x01'
TEST_VERSION  = 0x00010002
TEST_UPTIME   = 42
TEST_REQUESTS = [0x00003300, 0xABCD1234]


# ── Build / parse round-trips ─────────────────────────────────────────────────

def test_callhome_round_trip():
    """Build a callhome frame and verify all fields survive a parse round-trip."""
    raw = build_callhome_frame(
        src_mac=TEST_MAC,
        cm_version=TEST_VERSION,
        uptime=TEST_UPTIME,
        requests=TEST_REQUESTS,
    )
    result = parse_callhome_frame(raw)
    assert result is not None, "parse_callhome_frame returned None"
    assert result['magic']      == CALLHOME_MAGIC
    assert result['token']      == ETHERNET_TOKEN
    assert result['cm_version'] == TEST_VERSION
    assert result['mac']        == TEST_MAC
    assert result['uptime']     == TEST_UPTIME
    assert result['requests']   == TEST_REQUESTS


def test_callhome_no_requests():
    """Callhome with N=0 requests round-trips correctly."""
    raw    = build_callhome_frame(TEST_MAC, uptime=0, requests=[])
    result = parse_callhome_frame(raw)
    assert result is not None
    assert result['requests'] == []
    assert result['magic']    == CALLHOME_MAGIC


def test_lump_serve_round_trip():
    """Build a lump-serve response and verify all fields survive a parse."""
    token    = 0xABCD1234
    words    = [0xDEADBEEF, 0xCAFEBABE, 0x00000001, 0x12345678]
    response = build_lump_serve_response(token, words)
    result   = parse_lump_serve_response(response)
    assert result is not None, "parse_lump_serve_response returned None"
    assert result['magic'] == LUMPSERVE_MAGIC
    assert result['token'] == token
    assert result['words'] == words


def test_lump_serve_empty_words():
    """Lump-serve with W=0 words (not-found signal) round-trips correctly."""
    response = build_lump_serve_response(0x00003300, [])
    result   = parse_lump_serve_response(response)
    assert result is not None
    assert result['words'] == []
    assert result['token'] == 0x00003300


# ── Token identity in frame bytes ─────────────────────────────────────────────

def test_callhome_magic_in_bytes():
    """First 4 bytes of a callhome frame are big-endian 0xCE110001."""
    raw = build_callhome_frame(TEST_MAC)
    assert struct.unpack_from('>I', raw, 0)[0] == CALLHOME_MAGIC


def test_callhome_carries_ethernet_token():
    """Bytes 4-7 carry ETHERNET_TOKEN (0x00003300) — not a slot number."""
    raw   = build_callhome_frame(TEST_MAC)
    token = struct.unpack_from('>I', raw, 4)[0]
    assert token == ETHERNET_TOKEN == 0x00003300


def test_lumpserve_magic_in_bytes():
    """First 4 bytes of a lump-serve response are big-endian 0xCE110002."""
    raw = build_lump_serve_response(0x00003300, [0xABCD])
    assert struct.unpack_from('>I', raw, 0)[0] == LUMPSERVE_MAGIC


def test_lumpserve_carries_lump_token():
    """Bytes 4-7 of a lump-serve response carry the lump's token, never a slot."""
    lump_token = 0xBEEF0001
    raw    = build_lump_serve_response(lump_token, [])
    result = parse_lump_serve_response(raw)
    assert result['token'] == lump_token


def test_requests_use_tokens_not_slots():
    """Requested tokens in callhome frame are token values, not NS slot indices."""
    token_a = 0x00003300
    token_b = 0xABCD1234
    raw     = build_callhome_frame(TEST_MAC, requests=[token_a, token_b])
    result  = parse_callhome_frame(raw)
    assert result['requests'] == [token_a, token_b]


# ── Frame length ──────────────────────────────────────────────────────────────

def test_callhome_minimum_length():
    """Callhome with no requests is exactly CALLHOME_MIN_LEN bytes."""
    raw = build_callhome_frame(TEST_MAC, requests=[])
    assert len(raw) == CALLHOME_MIN_LEN


def test_callhome_length_with_requests():
    """Each additional request adds 4 bytes to the callhome frame."""
    base = build_callhome_frame(TEST_MAC, requests=[])
    with1 = build_callhome_frame(TEST_MAC, requests=[0x00003300])
    with2 = build_callhome_frame(TEST_MAC, requests=[0x00003300, 0xABCD1234])
    assert len(with1) == len(base) + 4
    assert len(with2) == len(base) + 8


def test_lumpserve_length():
    """Lump-serve frame is 12 + W×4 bytes."""
    words    = [1, 2, 3, 4, 5]
    response = build_lump_serve_response(0x12345678, words)
    assert len(response) == 12 + len(words) * 4


# ── Malformed frame rejection ─────────────────────────────────────────────────

def test_callhome_wrong_magic():
    """Bad magic field → parse_callhome_frame returns None."""
    raw    = build_callhome_frame(TEST_MAC)
    broken = b'\x00\x00\x00\x00' + raw[4:]
    assert parse_callhome_frame(broken) is None


def test_callhome_too_short():
    """Frame shorter than CALLHOME_MIN_LEN → None."""
    assert parse_callhome_frame(b'\xCE\x11\x00\x01') is None


def test_callhome_truncated_requests():
    """Frame claiming N requests but truncated data → None."""
    raw   = build_callhome_frame(TEST_MAC, requests=[0x00003300, 0xABCD1234])
    trunc = raw[:-4]
    assert parse_callhome_frame(trunc) is None


def test_lumpserve_too_short():
    """Response shorter than 12 bytes → None."""
    assert parse_lump_serve_response(b'\x00\x00\x00\x01' * 2) is None


def test_lumpserve_wrong_magic():
    """Bad magic in lump-serve response → None."""
    raw    = build_lump_serve_response(0x12345678, [0xABCD])
    broken = b'\xFF\xFF\xFF\xFF' + raw[4:]
    assert parse_lump_serve_response(broken) is None


def test_lumpserve_truncated_words():
    """Response claiming W words but fewer bytes available → None."""
    bad = struct.pack('>III', LUMPSERVE_MAGIC, 0x12345678, 4) + b'\x00' * 8
    assert parse_lump_serve_response(bad) is None


# ── Port constant ─────────────────────────────────────────────────────────────

def test_protocol_port():
    """Wukong protocol uses port 5900."""
    assert WUKONG_PORT == 5900
