#!/usr/bin/env python3
"""
Church Machine FPGA Patcher — command-line tool
================================================
Reads a .patch file exported from the Church Machine IDE and sends the
pre-compiled binary blocks to the FPGA over UART.

Usage:
    python3 patch_fpga.py <serial-port> <patch-file>

Example:
    python3 patch_fpga.py /dev/ttyUSB1 CR14_patch.bin

The script knows nothing about Church Machine internals.  It reads
binary patch blocks and sends each one using the PATCH_LUMP UART protocol:

    [0xBE][0xEF][addrHi][addrLo][countHi][countLo][word0_LE...wordN_LE][crcHi][crcLo]

After all blocks are sent, it transmits the RUN command (0xBE 0xAA).

.patch file format (all multi-byte values little-endian unless noted):
    Bytes 0-3:  Magic "CHPF" (0x43 0x48 0x50 0x46)
    Byte  4:    Version (0x01)
    Byte  5:    Number of patch blocks (1-255)
    Byte  6:    Flags (bit 0 = send RUN after all blocks)
    Byte  7:    Reserved (0x00)
    Then for each block:
        Bytes 0-1:  Address (big-endian, BRAM word address)
        Bytes 2-3:  Word count N (big-endian)
        Bytes 4..4+N*4-1:  N words (little-endian, 4 bytes each)

Requires: pyserial (pip3 install pyserial)
"""
import sys, time

def crc16_ccitt(data):
    crc = 0xFFFF
    for byte in data:
        for i in range(8):
            bit = ((byte >> (7 - i)) & 1) ^ ((crc >> 15) & 1)
            crc = ((crc << 1) & 0xFFFF) ^ (0x1021 if bit else 0)
    return crc

def parse_patch_file(path):
    with open(path, 'rb') as f:
        data = f.read()

    if len(data) < 8 or data[:4] != b'CHPF':
        print(f"ERROR: '{path}' is not a valid .patch file (bad magic)")
        sys.exit(1)

    version = data[4]
    if version != 1:
        print(f"ERROR: Unsupported patch version {version} (expected 1)")
        sys.exit(1)

    num_blocks = data[5]
    flags = data[6]
    send_run = bool(flags & 1)

    blocks = []
    offset = 8
    for i in range(num_blocks):
        if offset + 4 > len(data):
            print(f"ERROR: Patch file truncated at block {i}")
            sys.exit(1)
        addr = (data[offset] << 8) | data[offset + 1]
        count = (data[offset + 2] << 8) | data[offset + 3]
        offset += 4
        words_bytes = data[offset:offset + count * 4]
        if len(words_bytes) < count * 4:
            print(f"ERROR: Patch file truncated in block {i} data")
            sys.exit(1)
        offset += count * 4
        blocks.append((addr, count, words_bytes))

    return blocks, send_run

def build_uart_frame(addr, count, words_bytes):
    body = bytearray()
    body.append(0xBE)
    body.append(0xEF)
    body.append((addr >> 8) & 0xFF)
    body.append(addr & 0xFF)
    body.append((count >> 8) & 0xFF)
    body.append(count & 0xFF)
    body.extend(words_bytes)
    crc = crc16_ccitt(body)
    frame = bytearray(body)
    frame.append((crc >> 8) & 0xFF)
    frame.append(crc & 0xFF)
    return frame, crc

def main():
    if len(sys.argv) < 3:
        print("Usage: python3 patch_fpga.py <serial-port> <patch-file>")
        print("Example: python3 patch_fpga.py /dev/ttyUSB1 CR14_patch.bin")
        sys.exit(1)

    serial_port = sys.argv[1]
    patch_path = sys.argv[2]

    try:
        import serial
    except ImportError:
        print("ERROR: pyserial not installed.  Run:  pip3 install pyserial")
        sys.exit(1)

    blocks, send_run = parse_patch_file(patch_path)

    print(f"Church Machine FPGA Patcher")
    print(f"  File   : {patch_path}")
    print(f"  Blocks : {len(blocks)}")
    print(f"  RUN    : {'yes' if send_run else 'no'}")
    print()

    for i, (addr, count, _) in enumerate(blocks):
        print(f"  Block {i}: addr=0x{addr:04X}  words={count}")
    print()

    try:
        ser = serial.Serial(serial_port, 115200, timeout=0)
    except Exception as e:
        print(f"ERROR: Cannot open {serial_port}: {e}")
        sys.exit(1)

    print(f"  Serial : {serial_port} @ 115200 baud")
    print()

    ser.reset_input_buffer()
    time.sleep(0.05)

    all_ok = True
    for i, (addr, count, words_bytes) in enumerate(blocks):
        frame, crc = build_uart_frame(addr, count, words_bytes)
        print(f"  Block {i}: TX {len(frame)} bytes  addr=0x{addr:04X}  words={count}  CRC=0x{crc:04X}")

        ser.reset_input_buffer()
        ser.write(frame)
        ser.flush()

        rx = bytearray()
        deadline = time.time() + 3.0
        while len(rx) < 4 and time.time() < deadline:
            waiting = ser.in_waiting
            if waiting:
                rx.extend(ser.read(waiting))
            else:
                time.sleep(0.005)

        if len(rx) >= 4:
            echo_addr = (rx[0] << 8) | rx[1]
            echo_count = (rx[2] << 8) | rx[3]
            addr_ok = echo_addr == addr
            count_ok = echo_count == count
            if addr_ok and count_ok:
                print(f"           RX echo OK: addr=0x{echo_addr:04X}  count={echo_count}")
            else:
                print(f"           RX echo MISMATCH: expected addr=0x{addr:04X} count={count}, got addr=0x{echo_addr:04X} count={echo_count}")
                all_ok = False
        else:
            print(f"           RX no echo ({len(rx)} bytes received)")
            all_ok = False

    if send_run:
        print()
        print("  Sending RUN command (0xBE 0xAA)...")
        ser.write(bytes([0xBE, 0xAA]))
        ser.flush()
        print("  RUN sent — core executing from PC=0.")

    ser.close()

    print()
    if all_ok:
        print("SUCCESS — all blocks patched and verified.")
    else:
        print("WARNING — some blocks did not echo correctly. Check UART connection.")

    sys.exit(0 if all_ok else 1)

if __name__ == '__main__':
    main()
