"""Shared Wukong post-boot LUMP transport definitions.

The transport is deliberately small and deterministic.  The board requests
one policy entry at a time; the bridge answers with the canonical raw LUMP
bytes.  The board checks the policy token, allocation-sized header and CRC
before it publishes the Namespace entry.
"""

import struct
import zlib

PREFETCH_REQUEST_MAGIC = 0xD7
PREFETCH_RESPONSE_MAGIC = 0xD8
PREFETCH_INCIDENT_MAGIC = 0xD9
PREFETCH_VERSION = 1
PREFETCH_REQUEST_LEN = 16
PREFETCH_RESPONSE_HEADER_LEN = 16
PREFETCH_INCIDENT_LEN = 8
PREFETCH_POLICY_MAGIC = 0x57504B31  # "WPK1"
PREFETCH_POLICY_VERSION = 1
PREFETCH_POLICY_BASE_WORD = 320
PREFETCH_POLICY_ENTRY_WORDS = 6
PREFETCH_MAX_ENTRIES = 8
PREFETCH_MAX_LUMP_WORDS = 16384
PREFETCH_MAX_RETRIES = 3

PREFETCH_REQUIRED = 1
PREFETCH_STATUS_OK = 0
PREFETCH_STATUS_NOT_FOUND = 1
PREFETCH_STATUS_MALFORMED = 2
PREFETCH_STATUS_CRC = 3
PREFETCH_STATUS_CAPACITY = 4
PREFETCH_STATUS_TRANSPORT = 5


def crc32(raw):
    """Return the wire CRC-32/ISO-HDLC value for raw LUMP bytes."""
    return zlib.crc32(raw) & 0xFFFFFFFF


def build_request(sequence, slot, token, max_words, expected_hash32=0):
    return struct.pack(">BBBBIHH", PREFETCH_REQUEST_MAGIC, PREFETCH_VERSION,
                       sequence & 0xFF, slot & 0xFF, token & 0xFFFFFFFF,
                       max_words & 0xFFFF, 0) + struct.pack(
                           ">I", expected_hash32 & 0xFFFFFFFF)


def parse_request(frame):
    if len(frame) != PREFETCH_REQUEST_LEN:
        return None
    magic, version, sequence, slot, token, max_words, reserved = \
        struct.unpack(">BBBBIHH", frame[:12])
    # The final four bytes are the expected binary-hash prefix.  Keep the
    # legacy-looking 12-byte prefix easy to inspect on a logic analyser.
    expected_hash32 = struct.unpack(">I", frame[12:16])[0]
    if magic != PREFETCH_REQUEST_MAGIC or version != PREFETCH_VERSION or reserved:
        return None
    if max_words < 1 or max_words > PREFETCH_MAX_LUMP_WORDS:
        return None
    return {"sequence": sequence, "slot": slot, "token": token,
            "max_words": max_words, "expected_hash32": expected_hash32}


def build_response(slot, token, words, status=PREFETCH_STATUS_OK):
    raw = struct.pack(">%dI" % len(words), *(w & 0xFFFFFFFF for w in words))
    return struct.pack(">BBBBIII", PREFETCH_RESPONSE_MAGIC, PREFETCH_VERSION,
                       status & 0xFF, slot & 0xFF, token & 0xFFFFFFFF,
                       len(words), crc32(raw)) + raw


def parse_response_header(frame):
    if len(frame) < PREFETCH_RESPONSE_HEADER_LEN:
        return None
    magic, version, status, slot, token, word_count, expected_crc = \
        struct.unpack(">BBBBIII", frame[:PREFETCH_RESPONSE_HEADER_LEN])
    if magic != PREFETCH_RESPONSE_MAGIC or version != PREFETCH_VERSION:
        return None
    return {"status": status, "slot": slot, "token": token,
            "word_count": word_count, "crc": expected_crc}


def build_incident(sequence, slot, status, attempts):
    return struct.pack(">BBBBBBBB", PREFETCH_INCIDENT_MAGIC, PREFETCH_VERSION,
                       sequence & 0xFF, slot & 0xFF, status & 0xFF,
                       attempts & 0xFF, 0, 0)
