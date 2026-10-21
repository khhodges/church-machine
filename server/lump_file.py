"""Whole-LUMP file packaging. Identity always belongs to the decoded binary.

New files use one gzip member. Legacy raw files (including frames with raw
DEFLATE source) remain readable. This is not the hardware delivery protocol.
"""
import gzip
import zlib

MAX_LUMP_BYTES = 4 * (1 << 21)  # largest allocation representable by header N
MAX_FILE_BYTES = MAX_LUMP_BYTES + 65536


def validate_binary(raw):
    if len(raw) < 4 or len(raw) > MAX_LUMP_BYTES or len(raw) % 4:
        raise ValueError("Invalid decoded LUMP byte length")
    header = int.from_bytes(raw[:4], "big")
    expected = 4 * (1 << (((header >> 23) & 15) + 6))
    if header >> 27 != 31 or len(raw) != expected:
        raise ValueError("Decoded LUMP header/allocation does not match its bytes")
    return raw


def unpack_lump(data):
    """Bound decompression, check gzip CRC, reject truncation/trailing members."""
    if len(data) > MAX_FILE_BYTES:
        raise ValueError("LUMP file exceeds the supported size")
    if data[:2] != b"\x1f\x8b":
        return validate_binary(data)
    decoder = zlib.decompressobj(31)
    try:
        raw = decoder.decompress(data, MAX_LUMP_BYTES + 1)
    except zlib.error as exc:
        raise ValueError("Corrupt gzip LUMP file") from exc
    if len(raw) > MAX_LUMP_BYTES or decoder.unconsumed_tail:
        raise ValueError("Decoded LUMP exceeds the supported size")
    if not decoder.eof or decoder.unused_data:
        raise ValueError("Truncated LUMP gzip stream or unexpected trailing data")
    return validate_binary(raw)


def pack_lump(raw):
    return gzip.compress(validate_binary(raw), compresslevel=6, mtime=0)
