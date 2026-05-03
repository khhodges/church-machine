"""
server/mum.py — Mum identity module (Stage 3, Keystone Hello Mum).

Generates a real Ed25519 key pair on first run; persists the private key
to server/mum_key.pem (gitignored).

Key-generation strategy — preferred order:
  1. cryptography.hazmat (Ed25519PrivateKey) — used when available.
  2. OpenSSL subprocess fallback — used when cffi / Rust bindings are absent
     (e.g. NixOS dev environment: `No module named '_cffi_backend'`).

Derives the canonical identity string (public key bytes, base64url, no padding)
and the 32-bit identity word used by Keystone.Connect().

Identity-word format (matches keystone.cloomc and system_abstractions.js):
  bits [31:28]  version tag        = 0x1  (Ed25519 / GTKN-1)
  bits [27:16]  fingerprint[28:17] — top 12 bits of SHA-256(pubkey)
  bits [15: 0]  fingerprint[15: 0] — low  16 bits of SHA-256(pubkey)
"""

import os
import hashlib
import base64
import logging
import subprocess

log = logging.getLogger(__name__)

_SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
_KEY_PATH   = os.path.join(_SERVER_DIR, "mum_key.pem")

_private_key_pem  = None
_public_key_bytes = None   # raw 32 bytes
_identity_string  = None   # base64url, no padding
_identity_word    = None   # 32-bit encoded value


# ---------------------------------------------------------------------------
# Strategy 1 — Python cryptography library
# ---------------------------------------------------------------------------

def _try_load_cryptography():
    """
    Attempt to load / generate the key pair using the `cryptography` library.
    Raises ImportError if cffi / Rust bindings are unavailable.
    """
    # This import triggers the cffi/Rust check; it will raise ImportError on
    # NixOS environments where `_cffi_backend` is missing.
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from cryptography.hazmat.primitives.serialization import (
        Encoding, PrivateFormat, PublicFormat, NoEncryption,
        load_pem_private_key,
    )

    global _private_key_pem, _public_key_bytes

    if os.path.isfile(_KEY_PATH):
        with open(_KEY_PATH, "rb") as fh:
            raw_pem = fh.read()
        private_key = load_pem_private_key(raw_pem, password=None)
        _private_key_pem = raw_pem
        log.info("mum.py: loaded Ed25519 private key via cryptography library from %s", _KEY_PATH)
    else:
        private_key = Ed25519PrivateKey.generate()
        _private_key_pem = private_key.private_bytes(Encoding.PEM, PrivateFormat.PKCS8, NoEncryption())
        with open(_KEY_PATH, "wb") as fh:
            fh.write(_private_key_pem)
        log.info("mum.py: generated new Ed25519 key via cryptography library, stored at %s", _KEY_PATH)

    _public_key_bytes = private_key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)


# ---------------------------------------------------------------------------
# Strategy 2 — OpenSSL subprocess fallback
# ---------------------------------------------------------------------------

# Ed25519 SubjectPublicKeyInfo DER prefix (12 bytes):
#   SEQUENCE { SEQUENCE { OID 1.3.101.112 } BIT STRING 0x00 <32 bytes> }
_ED25519_DER_PREFIX_LEN = 12


def _run_openssl(*args, stdin=None):
    """Run an openssl subcommand and return stdout bytes; raise on error."""
    result = subprocess.run(
        ["openssl"] + list(args),
        input=stdin,
        capture_output=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"openssl {' '.join(args)} failed: {result.stderr.decode(errors='replace')}"
        )
    return result.stdout


def _try_load_openssl():
    """
    Load / generate the key pair using `openssl` subprocess.
    Used as a fallback when the `cryptography` library is unavailable.
    """
    global _private_key_pem, _public_key_bytes

    if os.path.isfile(_KEY_PATH):
        with open(_KEY_PATH, "rb") as fh:
            _private_key_pem = fh.read()
        log.info("mum.py: loaded Ed25519 private key via openssl subprocess from %s", _KEY_PATH)
    else:
        _private_key_pem = _run_openssl("genpkey", "-algorithm", "Ed25519")
        with open(_KEY_PATH, "wb") as fh:
            fh.write(_private_key_pem)
        log.info("mum.py: generated new Ed25519 key via openssl subprocess, stored at %s", _KEY_PATH)

    pub_der = _run_openssl("pkey", "-pubout", "-outform", "DER", stdin=_private_key_pem)
    if len(pub_der) < _ED25519_DER_PREFIX_LEN + 32:
        raise RuntimeError(f"Unexpected DER public key length: {len(pub_der)} bytes")
    _public_key_bytes = pub_der[_ED25519_DER_PREFIX_LEN : _ED25519_DER_PREFIX_LEN + 32]


# ---------------------------------------------------------------------------
# Shared initialisation
# ---------------------------------------------------------------------------

def _load_or_generate():
    global _identity_string, _identity_word

    if _private_key_pem is not None and _identity_string is not None:
        return

    try:
        _try_load_cryptography()
    except ImportError:
        log.warning(
            "mum.py: cryptography library unavailable (cffi/Rust bindings missing in "
            "this Nix environment); falling back to openssl subprocess."
        )
        _try_load_openssl()

    _identity_string = (
        base64.urlsafe_b64encode(_public_key_bytes)
        .rstrip(b"=")
        .decode("ascii")
    )

    digest = hashlib.sha256(_public_key_bytes).digest()
    fp_hi  = (digest[0] << 4) | (digest[1] >> 4)
    fp_lo  = ((digest[1] & 0x0F) << 12) | (digest[2] << 4) | (digest[3] >> 4)
    _identity_word = (0x1 << 28) | ((fp_hi & 0xFFF) << 16) | (fp_lo & 0xFFFF)


def get_identity_string() -> str:
    _load_or_generate()
    return _identity_string


def get_identity_word() -> int:
    _load_or_generate()
    return _identity_word


def regenerate_key() -> None:
    """Delete the persisted key file and regenerate a fresh Ed25519 key pair.

    Resets all module-level globals so the next call to any public accessor
    will trigger a fresh key generation via _load_or_generate().
    """
    global _private_key_pem, _public_key_bytes, _identity_string, _identity_word

    if os.path.isfile(_KEY_PATH):
        os.remove(_KEY_PATH)
        log.info("mum.py: deleted %s for key regeneration", _KEY_PATH)

    _private_key_pem  = None
    _public_key_bytes = None
    _identity_string  = None
    _identity_word    = None

    _load_or_generate()
    log.info("mum.py: key regenerated; new identity = %s", _identity_string)


# ---------------------------------------------------------------------------
# QR code renderer (pure-stdlib PNG — no Pillow required)
# ---------------------------------------------------------------------------

def _matrix_to_png(matrix, box_size: int = 10, border: int = 4) -> bytes:
    """
    Convert a QR code matrix (list of lists of bool) to a PNG byte string.
    Uses only stdlib (zlib + struct) — no Pillow required.
    """
    import struct
    import zlib

    n    = len(matrix)
    side = (n + 2 * border) * box_size

    def png_chunk(tag, data):
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    sig  = b"\x89PNG\r\n\x1a\n"
    ihdr = png_chunk(b"IHDR", struct.pack(">IIBBBBB", side, side, 8, 0, 0, 0, 0))

    rows       = []
    white_row  = b"\x00" + b"\xff" * side
    for _ in range(border * box_size):
        rows.append(white_row)
    for row_bits in matrix:
        pixels = bytearray()
        pixels += b"\xff" * (border * box_size)
        for bit in row_bits:
            pixels += (b"\x00" if bit else b"\xff") * box_size
        pixels += b"\xff" * (border * box_size)
        row_bytes = b"\x00" + bytes(pixels)
        for _ in range(box_size):
            rows.append(row_bytes)
    for _ in range(border * box_size):
        rows.append(white_row)

    raw        = b"".join(rows)
    compressed = zlib.compress(raw, 6)
    idat       = png_chunk(b"IDAT", compressed)
    iend       = png_chunk(b"IEND", b"")
    return sig + ihdr + idat + iend


def _make_qr_matrix(data: str) -> list:
    """
    Generate a QR code matrix (list[list[bool]]) encoding *data* as bytes.
    Uses byte mode with M error-correction level.
    Selects the minimum version (1–9) that fits the payload.
    Pure stdlib — no external dependencies.
    """
    data_bytes = data.encode("utf-8")

    # ------------------------------------------------------------------
    # Version / capacity tables for byte mode, M error correction.
    # Each entry: (max_bytes, data_cw_total, ec_per_block, [(n_blocks, data_per_block), ...])
    # Source: ISO/IEC 18004:2015 tables 7 and 9.
    # ------------------------------------------------------------------
    _M_TABLES = {
        1: (14,  16, 10, [(1, 16)]),
        2: (26,  28, 16, [(1, 28)]),
        3: (42,  44, 26, [(1, 44)]),
        4: (62,  64, 18, [(2, 32)]),
        5: (84,  86, 24, [(2, 43)]),
        6: (106, 108, 16, [(4, 27)]),
        7: (122, 124, 18, [(4, 31)]),
        8: (152, 154, 22, [(2, 38), (2, 39)]),
        9: (180, 182, 22, [(3, 36), (2, 37)]),
    }

    # Alignment pattern centre coordinates (row, col) per version.
    # Version 1 has no alignment pattern; versions 2-6 have one at these centres.
    _ALIGN_POS = {
        2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
        7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46],
    }

    # ------------------------------------------------------------------
    # Select minimum version
    # ------------------------------------------------------------------
    version = None
    for v in range(1, 10):
        if _M_TABLES[v][0] >= len(data_bytes):
            version = v
            break
    if version is None:
        raise ValueError(f"Data too long for versions 1-9 ({len(data_bytes)} bytes)")

    _, data_cw_total, ec_per_block, block_groups = _M_TABLES[version]
    size = 21 + (version - 1) * 4   # module side length

    # ------------------------------------------------------------------
    # GF(256) arithmetic (primitive polynomial x^8+x^4+x^3+x^2+1 = 0x11D)
    # ------------------------------------------------------------------
    _GF_EXP = [0] * 512
    _GF_LOG  = [0] * 256
    x = 1
    for i in range(255):
        _GF_EXP[i] = x
        _GF_LOG[x] = i
        x <<= 1
        if x & 256:
            x ^= 0x11D
    for i in range(255, 512):
        _GF_EXP[i] = _GF_EXP[i - 255]

    def gf_mul(a, b):
        if a == 0 or b == 0:
            return 0
        return _GF_EXP[_GF_LOG[a] + _GF_LOG[b]]

    def gf_poly_mul(p, q):
        r = [0] * (len(p) + len(q) - 1)
        for i, pi in enumerate(p):
            for j, qj in enumerate(q):
                r[i + j] ^= gf_mul(pi, qj)
        return r

    def rs_generator(n_ec):
        g = [1]
        for i in range(n_ec):
            g = gf_poly_mul(g, [1, _GF_EXP[i]])
        return g

    def rs_encode(data_cws, n_ec):
        gen = rs_generator(n_ec)
        msg = list(data_cws) + [0] * n_ec
        for i in range(len(data_cws)):
            coef = msg[i]
            if coef:
                for j, g in enumerate(gen):
                    msg[i + j] ^= gf_mul(g, coef)
        return msg[len(data_cws):]

    # ------------------------------------------------------------------
    # Build data bitstream (byte mode)
    # ------------------------------------------------------------------
    bits = []

    def push_bits(val, n):
        for i in range(n - 1, -1, -1):
            bits.append((val >> i) & 1)

    # Mode indicator: byte mode = 0b0100
    push_bits(0b0100, 4)
    # Character count (8 bits for versions 1-9 in byte mode)
    push_bits(len(data_bytes), 8)
    # Data bytes
    for b in data_bytes:
        push_bits(b, 8)
    # Terminator (up to 4 zero bits)
    for _ in range(min(4, data_cw_total * 8 - len(bits))):
        bits.append(0)
    # Pad to byte boundary
    while len(bits) % 8:
        bits.append(0)
    # Pad to required capacity with alternating pad bytes
    pad_bytes = [0xEC, 0x11]
    pi = 0
    while len(bits) < data_cw_total * 8:
        push_bits(pad_bytes[pi % 2], 8)
        pi += 1

    # Convert bitstream to codewords list
    codewords = [int("".join(str(b) for b in bits[i:i+8]), 2)
                 for i in range(0, len(bits), 8)]

    # ------------------------------------------------------------------
    # Split into blocks and compute error-correction codewords
    # ------------------------------------------------------------------
    blocks_data = []
    idx = 0
    for n_blocks, data_per_block in block_groups:
        for _ in range(n_blocks):
            blocks_data.append(codewords[idx:idx + data_per_block])
            idx += data_per_block

    blocks_ec = [rs_encode(bd, ec_per_block) for bd in blocks_data]

    # Interleave: data codewords first
    final_cws = []
    max_data = max(len(bd) for bd in blocks_data)
    for i in range(max_data):
        for bd in blocks_data:
            if i < len(bd):
                final_cws.append(bd[i])
    # Then error-correction codewords
    for i in range(ec_per_block):
        for be in blocks_ec:
            final_cws.append(be[i])

    # Convert to final bitstream
    data_bits = []
    for cw in final_cws:
        for i in range(7, -1, -1):
            data_bits.append((cw >> i) & 1)
    # Remainder bits: versions 2-6 require 7 trailing zero bits (ISO 18004 §6.7.3)
    data_bits += [0] * (7 if 2 <= version <= 6 else 0)

    # ------------------------------------------------------------------
    # Build the QR matrix
    # ------------------------------------------------------------------
    DARK  = True
    LIGHT = False
    UNDEF = None

    mat = [[UNDEF] * size for _ in range(size)]

    def place(r, c, val):
        mat[r][c] = val

    def place_rect(r, c, rows, cols, pattern):
        for dr in range(rows):
            for dc in range(cols):
                place(r + dr, c + dc, pattern[dr][dc])

    # Finder pattern (7×7 dark square + 6×6 border + 1 light separator)
    finder = [
        [DARK]*7,
        [DARK, LIGHT, LIGHT, LIGHT, LIGHT, LIGHT, DARK],
        [DARK, LIGHT, DARK,  DARK,  DARK,  LIGHT, DARK],
        [DARK, LIGHT, DARK,  DARK,  DARK,  LIGHT, DARK],
        [DARK, LIGHT, DARK,  DARK,  DARK,  LIGHT, DARK],
        [DARK, LIGHT, LIGHT, LIGHT, LIGHT, LIGHT, DARK],
        [DARK]*7,
    ]
    # Top-left finder
    place_rect(0, 0, 7, 7, finder)
    for c in range(8): place(7, c, LIGHT)
    for r in range(8): place(r, 7, LIGHT)
    # Top-right finder
    place_rect(0, size - 7, 7, 7, finder)
    for c in range(size - 8, size): place(7, c, LIGHT)
    for r in range(8): place(r, size - 8, LIGHT)
    # Bottom-left finder
    place_rect(size - 7, 0, 7, 7, finder)
    for c in range(8): place(size - 8, c, LIGHT)
    for r in range(size - 8, size): place(r, 7, LIGHT)

    # Timing patterns (row 6 and col 6, between finder patterns)
    for i in range(8, size - 8):
        val = DARK if i % 2 == 0 else LIGHT
        place(6, i, val)
        place(i, 6, val)

    # Dark module (always dark, fixed position)
    place(size - 8, 8, DARK)

    # Alignment patterns (5×5 pattern)
    align_pat = [
        [DARK]*5,
        [DARK, LIGHT, LIGHT, LIGHT, DARK],
        [DARK, LIGHT, DARK,  LIGHT, DARK],
        [DARK, LIGHT, LIGHT, LIGHT, DARK],
        [DARK]*5,
    ]
    if version >= 2:
        coords = _ALIGN_POS.get(version, [])
        positions = [(r, c) for r in coords for c in coords]
        for (r, c) in positions:
            # Skip if overlaps finder pattern areas
            if (r <= 8 and c <= 8) or (r <= 8 and c >= size - 8) or (r >= size - 8 and c <= 8):
                continue
            place_rect(r - 2, c - 2, 5, 5, align_pat)

    # ------------------------------------------------------------------
    # Place data bits (zigzag upward column pairs, skipping reserved areas)
    # ------------------------------------------------------------------
    reserved = set()
    for r in range(size):
        for c in range(size):
            if mat[r][c] is not UNDEF:
                reserved.add((r, c))
    # Format info positions (to be reserved)
    fmt_positions = (
        [(8, c) for c in range(9) if c != 6] +
        [(r, 8) for r in range(8) if r != 6] +
        [(8, size - 1 - i) for i in range(8)] +
        [(size - 1 - i, 8) for i in range(7)]
    )
    for pos in fmt_positions:
        reserved.add(pos)

    bit_idx = 0
    going_up = True
    col = size - 1
    while col > 0:
        if col == 6:
            col -= 1  # skip timing column
        for row_step in range(size):
            r = (size - 1 - row_step) if going_up else row_step
            for dc in range(2):
                c = col - dc
                if (r, c) not in reserved:
                    if bit_idx < len(data_bits):
                        mat[r][c] = bool(data_bits[bit_idx])
                        bit_idx += 1
                    else:
                        mat[r][c] = LIGHT
        col -= 2
        going_up = not going_up

    # ------------------------------------------------------------------
    # Format information (EC level M = 0b00, masks 0-7)
    # Precomputed: format bits = (EC_bits XOR mask_bits) encoded with BCH(15,5)
    # M level indicator bits = 0b00 (note: QR spec uses different encoding:
    #   L=01, M=00, Q=11, H=10 — this is the *raw* 2-bit EC indicator).
    # ------------------------------------------------------------------
    # Precomputed format strings for M (00) + masks 0-7.
    # Each is the full 15-bit format word (data + BCH + XOR with 101010000010010).
    _FMT_M = [
        0b101010000010010,  # mask 0
        0b101000100100101,  # mask 1
        0b101111001111100,  # mask 2
        0b101101101001011,  # mask 3
        0b100010111111001,  # mask 4
        0b100000011001110,  # mask 5
        0b100111110010111,  # mask 6
        0b100101010100000,  # mask 7
    ]

    def apply_mask_and_format(mask_id):
        # Mask functions
        mask_fn = [
            lambda r, c: (r + c) % 2 == 0,
            lambda r, c: r % 2 == 0,
            lambda r, c: c % 3 == 0,
            lambda r, c: (r + c) % 3 == 0,
            lambda r, c: (r // 2 + c // 3) % 2 == 0,
            lambda r, c: (r * c) % 2 + (r * c) % 3 == 0,
            lambda r, c: ((r * c) % 2 + (r * c) % 3) % 2 == 0,
            lambda r, c: ((r + c) % 2 + (r * c) % 3) % 2 == 0,
        ][mask_id]

        m = [row[:] for row in mat]
        for r in range(size):
            for c in range(size):
                if (r, c) not in reserved and (r, c) not in set(fmt_positions):
                    if mask_fn(r, c):
                        m[r][c] = not m[r][c]

        # Write format info bits (LSB = bit 0 is placed first, per ISO 18004 §7.9)
        fmt = _FMT_M[mask_id]
        fmt_bits = [(fmt >> i) & 1 for i in range(15)]

        # Top-left region (8 around finder)
        tl_pos = (
            [(8, 0), (8, 1), (8, 2), (8, 3), (8, 4), (8, 5),
             (8, 7), (8, 8), (7, 8), (5, 8), (4, 8), (3, 8), (2, 8), (1, 8), (0, 8)]
        )
        for i, (r, c) in enumerate(tl_pos):
            m[r][c] = bool(fmt_bits[i])

        # Top-right and bottom-left regions
        tr_bl_pos = (
            [(size - 1, 8), (size - 2, 8), (size - 3, 8), (size - 4, 8),
             (size - 5, 8), (size - 6, 8), (size - 7, 8),
             (8, size - 8), (8, size - 7), (8, size - 6), (8, size - 5),
             (8, size - 4), (8, size - 3), (8, size - 2), (8, size - 1)]
        )
        for i, (r, c) in enumerate(tr_bl_pos):
            m[r][c] = bool(fmt_bits[i])

        return m

    def penalty(m):
        score = 0
        n = len(m)
        # Rule 1: 5+ in a row/col same color
        for row in m:
            run = 1
            for i in range(1, n):
                if row[i] == row[i-1]:
                    run += 1
                else:
                    if run >= 5: score += run - 2
                    run = 1
            if run >= 5: score += run - 2
        for c in range(n):
            run = 1
            for r in range(1, n):
                if m[r][c] == m[r-1][c]:
                    run += 1
                else:
                    if run >= 5: score += run - 2
                    run = 1
            if run >= 5: score += run - 2
        # Rule 2: 2x2 same color blocks
        for r in range(n - 1):
            for c in range(n - 1):
                v = m[r][c]
                if m[r][c+1] == v and m[r+1][c] == v and m[r+1][c+1] == v:
                    score += 3
        # Rule 3: finder-like patterns (simplified)
        finder_pat = [DARK,LIGHT,DARK,DARK,DARK,LIGHT,DARK,LIGHT,LIGHT,LIGHT,LIGHT]
        rev_finder = list(reversed(finder_pat))
        for row in m:
            for i in range(n - 10):
                if row[i:i+11] == finder_pat or row[i:i+11] == rev_finder:
                    score += 40
        # Rule 4: proportion of dark modules
        dark = sum(1 for row in m for v in row if v)
        pct = dark * 100 // (n * n)
        score += min(abs(pct - 50) // 5, abs(pct + 5 - 50) // 5) * 10
        return score

    best_mask = min(range(8), key=lambda mid: penalty(apply_mask_and_format(mid)))
    return apply_mask_and_format(best_mask)


def get_qr_png() -> bytes:
    """Return a PNG-encoded QR code of Mum's canonical identity string.

    Encodes the identity string (43 ASCII bytes for a 32-byte Ed25519 key) as
    a version-4 QR code (33×33 modules) with M error correction.  The encoder
    supports payloads up to 180 bytes (version 9); payloads beyond that raise
    ValueError from _make_qr_matrix.
    """
    _load_or_generate()
    matrix = _make_qr_matrix(_identity_string)
    return _matrix_to_png(matrix, box_size=10, border=4)


# ---------------------------------------------------------------------------
# Identity-word derivation (for submitted identity strings)
# ---------------------------------------------------------------------------

def identity_word_from_string(identity_string: str) -> int:
    """
    Derive the 32-bit identity word from a canonical identity string.
    Validates that the decoded payload is exactly 32 bytes (Ed25519 pubkey).
    Returns 0 if the string is invalid.
    """
    try:
        padded    = identity_string + "=" * (-len(identity_string) % 4)
        pub_bytes = base64.urlsafe_b64decode(padded)
        if len(pub_bytes) != 32:
            return 0
        digest = hashlib.sha256(pub_bytes).digest()
        fp_hi  = (digest[0] << 4) | (digest[1] >> 4)
        fp_lo  = ((digest[1] & 0x0F) << 12) | (digest[2] << 4) | (digest[3] >> 4)
        return (0x1 << 28) | ((fp_hi & 0xFFF) << 16) | (fp_lo & 0xFFFF)
    except Exception:
        return 0
