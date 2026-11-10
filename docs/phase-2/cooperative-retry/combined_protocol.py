"""Bounded complete-LUMP transport; whole-image CSI1 framing is unchanged."""
import struct

MAGIC = b"CLP1"
BEGIN, FINISH, ABORT = 1, 2, 3
HEADER_BYTES = 20


def command(operation, selector, epoch, transaction, length=0):
    return MAGIC + struct.pack(">BBHIII", operation, selector, 0,
                               epoch, transaction, length)


def validate_records(records):
    """Elaboration-time policy validation, never permission from UART fields."""
    if len(records) != 2:
        raise ValueError("exactly two protected revision records required")
    ranges, slots = [], set()
    for record in records:
        size = record["sizeWords"]
        base = record["baseByte"]
        words = record["words"]
        if size not in (64, 256) or len(words) != size:
            raise ValueError("unsupported complete-LUMP geometry")
        if any(type(w) is not int or not 0 <= w <= 0xffffffff for w in words):
            raise ValueError("invalid LUMP word")
        hdr = words[0]
        if (hdr >> 27 != 31 or (hdr >> 8) & 3 or
                1 << (((hdr >> 23) & 15) + 6) != size):
            raise ValueError("unsupported executable header")
        cw, cc = (hdr >> 10) & 0x1fff, hdr & 0xff
        if not cw or not cc or 1 + cw + cc > size:
            raise ValueError("invalid executable bounds")
        if base % 4 or not 0x8000 <= base < base + size * 4 <= 0xa000:
            raise ValueError("destination outside reserved executable arena")
        if any(base < end and start < base + size * 4 for start, end in ranges):
            raise ValueError("overlapping executable allocations")
        if record["slot"] in slots or not 40 <= record["slot"] < 60:
            raise ValueError("invalid destination slot")
        ranges.append((base, base + size * 4))
        slots.add(record["slot"])
        import hashlib
        raw = struct.pack("<" + "I" * size, *words)
        if hashlib.sha256(raw).hexdigest() != record["localizedSha256LE"]:
            raise ValueError("protected digest does not match exact words")
    return records
