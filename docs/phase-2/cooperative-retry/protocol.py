"""Cooperative observation format; CRC is transport integrity, not authentication."""
import binascii
import hashlib
import struct

WORDS = (2, 0xAF60400D, 0x1F000000, 0x4A000006, 0xF8001001)
OFFSETS = (1, 2, 3, 63, 0)
PAYLOAD = struct.pack(">5I", *WORDS)
OBJECT_ID = hashlib.sha256(PAYLOAD).digest()


def crc(data):
    return binascii.crc_hqx(data, 0xFFFF)


def seal(data):
    return data + struct.pack(">H", crc(data))


REQUEST = seal(b"URQ2" + OBJECT_ID + struct.pack(">H", len(PAYLOAD)))
RESPONSE = seal(b"URS2" + OBJECT_ID + struct.pack(">H", len(PAYLOAD)) + PAYLOAD)
FIELDS = (
    "accepted", "failed", "index", "rx_count", "post_count", "post_crc",
    "line_errors", "write_count", "publish_count", "handoffs", "retries",
    "nia", "cr12", "dr12", "post_terminal_activity",
    *(f"buffer{i}" for i in range(5)), *(f"memory{i}" for i in range(5)),
    "renewals", "progress", "pending_changes", "fault_seen", "ticks",
)
REPORT_SIZE = 46 + 4 * len(FIELDS)


def decode_report(frame):
    if len(frame) != REPORT_SIZE or frame[:4] != b"UCV3":
        raise ValueError("Wrong cooperative report format")
    if crc(frame[:-2]) != int.from_bytes(frame[-2:], "big"):
        raise ValueError("Report CRC mismatch")
    if frame[12:44] != OBJECT_ID:
        raise ValueError("Wrong object")
    result = dict(zip(FIELDS, struct.unpack(">30I", frame[44:-2])))
    result.update(sequence=int.from_bytes(frame[4:8], "big"),
                  nonce=int.from_bytes(frame[8:12], "big"))
    return result


def challenge(nonce):
    bad = bytearray(RESPONSE)
    bad[40] ^= 0x80
    return RESPONSE + bytes(bad) + b"UCP3" + struct.pack(">I", nonce)


def verify_report(report, other_user):
    expected = dict(accepted=1, failed=0, index=5, rx_count=len(RESPONSE),
                    line_errors=0, write_count=5, publish_count=1,
                    handoffs=1, retries=1, fault_seen=0)
    expected.update({f"{kind}{i}": word for kind in ("buffer", "memory")
                     for i, word in enumerate(WORDS)})
    for key, value in expected.items():
        if report[key] != value:
            raise ValueError(f"{key}: {report[key]} != {value}")
    if report["pending_changes"] < 2 or report["renewals"] < 3 or not report["ticks"]:
        raise ValueError("Missing cooperative renewal evidence")
    if (report["progress"] < 2 if other_user else report["progress"] != 0):
        raise ValueError("Wrong USER B progress")


def verify_pair(before, after, nonce, other_user):
    for report in (before, after):
        verify_report(report, other_user)
    if (before["sequence"], before["nonce"], before["post_count"], before["post_crc"]) != (1, 0, 0, 0xffff):
        raise ValueError("Unclean baseline")
    if (after["sequence"], after["nonce"]) != (2, nonce):
        raise ValueError("Stale observation")
    probe = challenge(nonce)
    if (after["post_count"], after["post_crc"]) != (len(probe), crc(probe)):
        raise ValueError("Challenge not observed exactly")
    if after["renewals"] <= before["renewals"]:
        raise ValueError("No renewal during observation")
