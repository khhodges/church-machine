#!/usr/bin/env python3
"""Convert a Xilinx .bit file to Intel MCS (Extended HEX) format for SPI flash.

Usage:
    python3 scripts/bit_to_mcs.py <input.bit> <output.mcs>

The MCS file places the bitstream at flash address 0x00000000 (SPIx4, 128 Mb).
Flash with:
    xc3sprog -c xpc -I <output.mcs>
"""

import struct
import sys


def parse_bit(path):
    """Return the raw bitstream bytes from a Xilinx .bit file."""
    with open(path, 'rb') as f:
        data = f.read()

    # Skip 13-byte sync preamble (ends with 0x00 0x00 0x01)
    i = 0
    while i < len(data) - 2:
        if data[i] == 0x00 and data[i+1] == 0x00 and data[i+2] == 0x01:
            i += 3
            break
        i += 1

    # Parse fields a–e
    while i < len(data):
        field = chr(data[i]); i += 1
        if field == 'e':
            blen = struct.unpack_from('>I', data, i)[0]; i += 4
            return data[i:i+blen]
        else:
            slen = struct.unpack_from('>H', data, i)[0]; i += 2
            i += slen  # skip field value

    raise ValueError("No field 'e' (bitstream data) found in .bit file")


def checksum(record_bytes):
    """Intel HEX two's-complement checksum of a list of byte values."""
    return (-sum(record_bytes)) & 0xFF


def write_mcs(bitstream, path):
    """Write bitstream bytes as Intel Extended HEX (MCS) to path."""
    BYTES_PER_LINE = 16

    with open(path, 'w') as f:
        addr = 0
        prev_upper = None

        for offset in range(0, len(bitstream), BYTES_PER_LINE):
            chunk = bitstream[offset:offset + BYTES_PER_LINE]
            upper = (addr >> 16) & 0xFFFF
            lower = addr & 0xFFFF

            # Emit Extended Linear Address record when upper word changes
            if upper != prev_upper:
                rec = [0x02, 0x00, 0x00, 0x04,
                       (upper >> 8) & 0xFF, upper & 0xFF]
                rec.append(checksum(rec))
                f.write(':' + ''.join(f'{b:02X}' for b in rec) + '\r\n')
                prev_upper = upper

            # Data record
            ll = len(chunk)
            rec = [ll, (lower >> 8) & 0xFF, lower & 0xFF, 0x00] + list(chunk)
            rec.append(checksum(rec))
            f.write(':' + ''.join(f'{b:02X}' for b in rec) + '\r\n')

            addr += ll

        # End-of-file record
        f.write(':00000001FF\r\n')

    return addr


def main():
    if len(sys.argv) != 3:
        print(f"Usage: {sys.argv[0]} <input.bit> <output.mcs>", file=sys.stderr)
        sys.exit(1)

    in_path, out_path = sys.argv[1], sys.argv[2]
    print(f"Reading {in_path} …")
    bitstream = parse_bit(in_path)
    print(f"  Bitstream: {len(bitstream):,} bytes ({len(bitstream)/1024:.0f} KB)")

    print(f"Writing {out_path} …")
    written = write_mcs(bitstream, out_path)
    print(f"  Done — {written:,} bytes written to flash image")


if __name__ == '__main__':
    main()
