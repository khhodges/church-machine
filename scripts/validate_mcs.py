#!/usr/bin/env python3
"""Validate Intel HEX configuration images, without accessing any hardware.

Accept data, EOF, extended segment and extended linear address records only.
Wukong defaults require address zero, at least 1024 data bytes and an 8 MiB
flash. These are format/completeness checks, not bitstream or hardware proof.
"""

import argparse
from dataclasses import dataclass
from pathlib import Path
import re
import sys


WUKONG_FLASH_BYTES = 8 * 1024 * 1024


@dataclass(frozen=True)
class ImageSummary:
    data_bytes: int
    end_address_exclusive: int


def validate_mcs(path, *, flash_bytes=WUKONG_FLASH_BYTES, min_data_bytes=1024):
    """Return image extent or raise ValueError/OSError for an invalid image.

    Sparse and out-of-order records are permitted; duplicate writes (even
    identical bytes) are rejected. Address records replace the previous base.
    """
    if flash_bytes <= 0 or min_data_bytes <= 0:
        raise ValueError("capacity and minimum data size must be positive")
    base = 0
    eof = False
    intervals = []
    count = 0
    with Path(path).open(encoding="ascii") as source:
        for number, raw in enumerate(source, 1):
            line = raw.rstrip("\r\n")
            if not line.strip():
                continue

            def fail(message):
                raise ValueError(f"line {number}: {message}")

            if eof:
                fail("record after EOF")
            if not re.fullmatch(r":[0-9a-fA-F]+", line):
                fail("malformed Intel HEX record")
            if len(line[1:]) % 2:
                fail("odd hex record length")
            record = bytes.fromhex(line[1:])
            if len(record) < 5 or len(record) != record[0] + 5:
                fail("record length mismatch")
            if sum(record) & 255:
                fail("record checksum mismatch")
            size = record[0]
            address = int.from_bytes(record[1:3], "big")
            kind = record[3]
            data = record[4:-1]
            if kind == 0:
                if not size:
                    fail("empty data record")
                start = base + address
                end = start + size
                if end > flash_bytes:
                    fail(f"data exceeds flash capacity ({flash_bytes} bytes)")
                intervals.append((start, end, number))
                count += size
            elif kind in (2, 4):
                if size != 2 or address != 0:
                    fail("malformed extended-address record")
                base = int.from_bytes(data, "big") << (4 if kind == 2 else 16)
            elif kind == 1:
                if size != 0 or address != 0:
                    fail("malformed EOF record")
                eof = True
            else:
                fail(f"unsupported MCS record type {kind}")
    if not eof:
        raise ValueError("missing EOF record")
    if not intervals:
        raise ValueError("image contains no data")
    intervals.sort()
    if intervals[0][0] != 0:
        raise ValueError("image must start at address zero")
    previous_end = 0
    for start, end, number in intervals:
        if start < previous_end:
            raise ValueError(f"line {number}: overlapping data records")
        previous_end = end
    if count < min_data_bytes:
        raise ValueError(f"incomplete image: {count} data bytes; need {min_data_bytes}")
    return ImageSummary(count, previous_end)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path)
    args = parser.parse_args()
    try:
        result = validate_mcs(args.image)
    except (OSError, ValueError) as exc:
        print(f"MCS validation failed: {exc}", file=sys.stderr)
        return 1
    print(f"MCS_RECORDS_PASS data_bytes={result.data_bytes} "
          f"end_address_exclusive=0x{result.end_address_exclusive:x} "
          f"flash_bytes={WUKONG_FLASH_BYTES}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
