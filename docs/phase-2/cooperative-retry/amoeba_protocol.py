"""CLA1: one outstanding SYSTEM-requested, exact selected LUMP delivery.

Records are trusted configuration, never supplied as authority by UART.
The receiver has staging-only write authority; Amoeba publishes natively.
"""
import hashlib
import struct

MAGIC = b"CLA1"
BEGIN, FINISH, ABORT = 1, 2, 3


def command(operation, slot, epoch, transaction, length=0):
    return MAGIC + struct.pack(">BBHIII", operation, slot, 0,
                               epoch, transaction, length)


def validate_records(records, *, staging_base, staging_words):
    if not records or len(records) > 61:
        raise ValueError("one to 61 selected targets required")
    if staging_words < 64 or staging_words > 4096 or staging_words & (staging_words - 1):
        raise ValueError("invalid staging capacity")
    if staging_base % 4 or not 0 <= staging_base < staging_base + staging_words * 4 <= 65536:
        raise ValueError("staging outside RAM")
    slots, ranges = set(), [(staging_base, staging_base + staging_words * 4)]
    for r in records:
        slot, size, base, words = r["slot"], r["sizeWords"], r["baseByte"], r["words"]
        if type(slot) is not int or not 3 <= slot < 64 or slot in slots:
            raise ValueError("duplicate or invalid target slot")
        if size < 64 or size > staging_words or size & (size - 1) or len(words) != size:
            raise ValueError("invalid target size")
        if any(type(w) is not int or not 0 <= w <= 0xffffffff for w in words):
            raise ValueError("invalid words")
        h = words[0]
        cw, cc = (h >> 10) & 8191, h & 255
        if h >> 27 != 31 or (h >> 8) & 3 or not cw or not cc:
            raise ValueError("target must be executable Inform")
        if 1 << (((h >> 23) & 15) + 6) != size or 1 + cw + cc > size:
            raise ValueError("invalid executable geometry")
        if base % 4 or not 1024 <= base < base + size * 4 <= 65536:
            raise ValueError("target outside reserved RAM")
        if any(base < end and start < base + size * 4 for start, end in ranges):
            raise ValueError("overlapping target/staging")
        raw = struct.pack("<" + "I" * size, *words)
        if hashlib.sha256(raw).hexdigest() != r["localizedSha256LE"]:
            raise ValueError("selected digest differs from bytes")
        ranges.append((base, base + size * 4))
        slots.add(slot)
    return records
