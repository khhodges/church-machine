import hmac, hashlib, os, sys

def compute_build_sig(board_type, fw_major, fw_minor, key=None):
    if key is None:
        key = os.environ.get("BUILD_SIGNING_KEY", "")
    if not key:
        return [0x00, 0x00, 0x00, 0x00]
    msg = bytes([board_type, fw_major, fw_minor])
    h = hmac.new(key.encode(), msg, hashlib.sha256).digest()
    return list(h[:4])

def verify_build_sig(board_type, fw_major, fw_minor, sig_bytes, key=None):
    expected = compute_build_sig(board_type, fw_major, fw_minor, key)
    return list(sig_bytes) == expected and expected != [0, 0, 0, 0]

if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python -m hardware.build_sig <board_type> <fw_major> <fw_minor>")
        print("  Set BUILD_SIGNING_KEY env var first.")
        sys.exit(1)
    bt = int(sys.argv[1], 0)
    maj = int(sys.argv[2])
    mi = int(sys.argv[3])
    sig = compute_build_sig(bt, maj, mi)
    print(f"Board 0x{bt:02X}  FW {maj}.{mi}")
    print(f"Signature: {sig}")
    print(f"Hex: {bytes(sig).hex()}")
