"""Bounded diagnostic wire format. Hash/CRC matching is NOT authentication."""
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
    "nia", "cr12", "dr12", "post_stop_activity",
    *(f"buffer{i}" for i in range(5)), *(f"memory{i}" for i in range(5)),
)
REPORT_SIZE = 4 + 4 + 4 + 32 + 4 * len(FIELDS) + 2


def decode_report(frame):
    if len(frame) != REPORT_SIZE or frame[:4] != b"URV2":
        raise ValueError("Wrong report format")
    if crc(frame[:-2]) != int.from_bytes(frame[-2:], "big"):
        raise ValueError("Report CRC mismatch")
    if frame[12:44] != OBJECT_ID:
        raise ValueError("Report object mismatch")
    result = dict(zip(FIELDS, struct.unpack(">" + "I" * len(FIELDS), frame[44:-2])))
    result.update(sequence=int.from_bytes(frame[4:8], "big"),
                  nonce=int.from_bytes(frame[8:12], "big"))
    return result


def challenge(nonce):
    """Repeat the valid response, then corrupted payload, then observation nonce."""
    bad = bytearray(RESPONSE)
    bad[40] ^= 0x80
    return RESPONSE + bytes(bad) + b"URP2" + struct.pack(">I", nonce)


def verify_terminal(report):
    expected = dict(accepted=1, failed=0, index=5, rx_count=len(RESPONSE),
                    line_errors=0, write_count=5, publish_count=1,
                    handoffs=1, retries=1, nia=0x400C, cr12=0x02070004,
                    dr12=13, post_stop_activity=0)
    expected.update({f"{kind}{i}": word for kind in ("buffer", "memory")
                     for i, word in enumerate(WORDS)})
    for name, value in expected.items():
        if report[name] != value:
            raise ValueError(f"{name}: got {report[name]}, expected {value}")


def verify_baseline(before):
    verify_terminal(before)
    if (before["sequence"], before["nonce"], before["post_count"], before["post_crc"]) != (1, 0, 0, 0xFFFF):
        raise ValueError("Not a clean baseline")


def verify_reports(before, after, probe, nonce):
    verify_baseline(before)
    verify_terminal(after)
    if after["sequence"] != 2 or after["nonce"] != nonce:
        raise ValueError("Stale or unrelated observation")
    if after["post_count"] != len(probe) or after["post_crc"] != crc(probe):
        raise ValueError("Board did not observe the exact post-claim challenge")
