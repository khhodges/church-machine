#!/usr/bin/env python3
"""
Church Machine Ti60 Call-Home Bridge  —  Protocol v2.0
=======================================================
Reads the Sapphire SoC UART on ttyUSB2 (FT4232H interface 2), parses all
firmware v2.0 record types, and forwards them to the Church Machine IDE server.

Protocol v2.0 record types (all terminated with \\r\\n):
  CALLHOME:{...}      — periodic heartbeat; forwarded to /api/device/call-home
  FAULT_EVENT:{...}   — structured fault record (6 telemetry fields);
                        forwarded to /api/device/fault
  HUNG:{...}          — hung-program watchdog (NIA frozen ≥ 3 s, no fault);
                        forwarded to /api/device/call-home with hung:true
  TRACE:[0x...,...]   — 10-entry NIA circular buffer emitted every ~1 s;
                        forwarded (best-effort) to /api/device/trace

IDE endpoints used:
  POST /api/device/call-home   — CALLHOME heartbeats and HUNG events
  POST /api/device/fault       — FAULT_EVENT records
  POST /api/device/trace       — TRACE records (best-effort; silently dropped on failure)
  POST /api/device/uart-log    — raw non-protocol UART lines (batched, 500 ms)
  PUT  /api/launch-tests/{id}  — optional launch-test reporting (--report-launch)

The Ti60 FT4232H USB-UART mapping:
  ttyUSB0  — JTAG (interface 0)
  ttyUSB1  — SPI/debug (interface 1)
  ttyUSB2  — Sapphire SoC UART0   ← this bridge
  ttyUSB3  — Church Machine debug UART

Usage:
    python3 hardware/soc_combined/callhome_bridge.py [--port=/dev/ttyUSB2] [--ide=URL]

Flags:
    --port=PATH    Serial port to open (default: /dev/ttyUSB2)
    --baud=N       Baud rate (default: 57600 — 25 MHz crystal, CLOCKDIV=53)
    --ide=URL      IDE server base URL, e.g. http://localhost:5000
                   Enables call-home POSTs to /api/device/call-home.
    --reconnect    Automatically reconnect on serial errors (default: on)
    --no-reconnect Disable automatic reconnect.
    --report-launch  After the first CALLHOME with boot_ok=1, PUT
                   TEST-09 as passing to /api/launch-tests/TEST-09.
                   Requires --ide=URL.
    --upload       Fetch the current boot image from the IDE and write it to
                   the Church Machine's BRAM via the PATCH_LUMP (0xBEEF)
                   protocol on the CM debug UART (default: /dev/ttyUSB3,
                   115200 baud).  After ACK, the CM is halted — hold the
                   push button for ~1 s to retransmit the banner and reboot
                   the CM from NIA=0 with the patched namespace.
                   Requires --ide=URL.  Bridge continues normally after upload.
    --upload-port=PATH  CM debug serial port for --upload (default: /dev/ttyUSB3)
    --upload-baud=N     CM debug baud rate for --upload   (default: 115200)

IMPORTANT — confirmed hardware gotchas
---------------------------------------
  Baud rate: ALWAYS use --baud 57600.  The soc_combined firmware uses
  CLOCKDIV=53 at 25 MHz → 57,870 ≈ 57,600 baud on ttyUSB2.  Connecting
  at 115200 produces garbage or silence on the call-home port.
  (The CM debug UART on ttyUSB3 is a separate port and uses 115200 baud.)

  --ide flag: both --ide=URL (equals) and --ide URL (space) are accepted.
  The original parser only accepted the equals form; space form was silently
  ignored, leaving _IDE_SERVER_URL=None and suppressing all IDE forwarding.
"""

import sys
import os
import json
import time
import threading
import ssl
import sqlite3 as _sqlite3
import hashlib
import hmac as _hmac_mod

try:
    import serial
    _SERIAL_AVAILABLE = True
except ImportError:
    _SERIAL_AVAILABLE = False

# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------
_SERIAL_PORT = '/dev/ttyUSB2'
_BAUD = 57600
_IDE_SERVER_URL = None
_AUTO_RECONNECT = True
_REPORT_LAUNCH = False
_INSECURE = False
_UPLOAD_MODE = False
_UPLOAD_PORT = '/dev/ttyUSB3'
_UPLOAD_BAUD = 115200

_argv = sys.argv[1:]
_i = 0
while _i < len(_argv):
    _a = _argv[_i]
    def _next_val(flag):
        global _i
        if '=' in flag:
            return flag.split('=', 1)[1]
        _i += 1
        if _i >= len(_argv):
            print(f"ERROR: {flag} requires a value", file=sys.stderr)
            sys.exit(1)
        return _argv[_i]
    if _a.startswith('--port'):
        _SERIAL_PORT = _next_val(_a)
    elif _a.startswith('--baud'):
        _BAUD = int(_next_val(_a))
    elif _a.startswith('--ide'):
        _IDE_SERVER_URL = _next_val(_a).rstrip('/')
    elif _a == '--no-reconnect':
        _AUTO_RECONNECT = False
    elif _a == '--reconnect':
        _AUTO_RECONNECT = True
    elif _a == '--report-launch':
        _REPORT_LAUNCH = True
    elif _a == '--insecure':
        _INSECURE = True
    elif _a == '--upload':
        _UPLOAD_MODE = True
    elif _a.startswith('--upload-port'):
        _UPLOAD_PORT = _next_val(_a)
    elif _a.startswith('--upload-baud'):
        _UPLOAD_BAUD = int(_next_val(_a))
    elif _a.startswith('--'):
        print(f"WARNING: unknown flag {_a!r} ignored", file=sys.stderr)
    _i += 1

# ---------------------------------------------------------------------------
# Fault code name lookup
# Must stay in sync with ChurchSimulator.FAULT_CODES (simulator/simulator.js)
# and _fault_names[] in hardware/soc_combined/firmware/main.c.
# ---------------------------------------------------------------------------
_FAULT_NAMES = {
    0x00: "UNKNOWN",
    0x01: "PERM_R",       0x02: "PERM_W",       0x03: "PERM_X",
    0x04: "PERM_L",       0x05: "PERM_S",       0x06: "PERM_E",
    0x07: "NULL_CAP",     0x08: "BOUNDS",       0x09: "VERSION",
    0x0A: "SEAL",         0x0B: "INVALID_OP",   0x0C: "TPERM_RSV",
    0x0D: "DOMAIN_PURITY",0x0E: "PERM_B",       0x0F: "F_BIT",
    0x10: "STACK_OVERFLOW",0x11: "ABSENT_OUTFORM",
    0x12: "STACK_CORRUPT", 0x13: "STACK_UNDERFLOW",
    # 0x14 unassigned
    0x15: "OUTFORM_CRC",  0x16: "OUTFORM_ALLOC",
    0x17: "OUTFORM_MINT", 0x18: "OUTFORM_HDR",
    0x19: "INT_OVERFLOW",   # proposed — Track 3 bitstream
}

def _fault_name(code: int) -> str:
    """Return the human-readable fault name for a numeric fault code."""
    return _FAULT_NAMES.get(code, "UNKNOWN")

# ---------------------------------------------------------------------------
# sha32 identity primitive and HKDF helper
#
# sha32(ogt) — first 4 bytes of SHA-256(ogt) as big-endian uint32.
#   This is the token_32 hardware register value for a namespace entry.
#   Matches the C implementation in hardware/sha256.h exactly.
#
# hkdf_sha256(ikm, salt, info, length) — RFC 5869 HKDF using HMAC-SHA256.
#   Used by T0.4 key derivation: K_enc = hkdf_sha256(IKM, b"CM_ENC_v2", ...)
#   Both implementations (bridge + firmware) must produce identical output.
#
# Canonical test vectors: scripts/test_sha32_vectors.py
# ---------------------------------------------------------------------------

def sha32(ogt: str) -> int:
    """Return sha32(ogt): first 4 bytes of SHA-256 over the OGT string, big-endian uint32."""
    d = hashlib.sha256(ogt.encode("utf-8")).digest()
    return int.from_bytes(d[:4], "big")


def hkdf_sha256(ikm: bytes, salt: bytes, info: bytes, length: int) -> bytes:
    """RFC 5869 HKDF-SHA256.  Matches hardware/sha256.h hkdf_sha256() exactly."""
    # Extract: PRK = HMAC-SHA256(salt, IKM)
    prk = _hmac_mod.new(salt, ikm, hashlib.sha256).digest()
    # Expand: T(i) = HMAC-SHA256(PRK, T(i-1) || info || i)
    t, okm = b"", b""
    for i in range(1, (length // 32) + 2):
        t = _hmac_mod.new(prk, t + info + bytes([i]), hashlib.sha256).digest()
        okm += t
    return okm[:length]


def derive_keys(uid_hi: int, uid_lo: int, ogt: str) -> "tuple[bytes, bytes]":
    """
    Per-abstraction key derivation — T0.4, CM_MSG Protocol Section 2.6.

    Formula (CM_ENC_v3 / CM_MAC_v3 — spec-authoritative):
        preimage = uid_hi_BE4 || uid_lo_BE4 || ogt_utf8
        IKM      = SHA256(preimage)
        K_enc    = HKDF-SHA256(IKM, salt="CM_ENC_v3", info=ogt_bytes, len=16)
        K_mac    = HKDF-SHA256(IKM, salt="CM_MAC_v3", info=ogt_bytes, len=16)

    Matches hardware/sha256.h cm_derive_keys() exactly.
    Keys are never printed or logged.

    Returns (k_enc_16_bytes, k_mac_16_bytes).
    """
    uid_bytes = uid_hi.to_bytes(4, "big") + uid_lo.to_bytes(4, "big")
    ogt_bytes = ogt.encode("utf-8")
    ikm = hashlib.sha256(uid_bytes + ogt_bytes).digest()
    k_enc = hkdf_sha256(ikm, b"CM_ENC_v3", ogt_bytes, 16)
    k_mac = hkdf_sha256(ikm, b"CM_MAC_v3", ogt_bytes, 16)
    return k_enc, k_mac


# ---------------------------------------------------------------------------
# NS keystore persistence — AES-256-GCM encrypted at rest in church_machine.db
#
# KEK derivation:
#   KEK = HKDF-SHA256(IKM=REPORT_TOKEN.encode(), salt="CM_KEK_v1",
#                     info=b"ns_keystore", length=32)
#
# Each row: (uid, ogt, nonce_hex, k_enc_ct_hex, k_mac_ct_hex)
# On bridge restart: re-derive KEK, decrypt rows for reconnected board UID.
# ---------------------------------------------------------------------------

# Path to the IDE server's SQLite database (relative from hardware/soc_combined/).
_BRIDGE_DIR = os.path.dirname(os.path.abspath(__file__))
_DB_PATH = os.path.join(_BRIDGE_DIR, "..", "..", "server", "church_machine.db")

try:
    from Crypto.Cipher import AES as _AES_Cipher
    _AES_GCM_AVAILABLE = True
except ImportError:
    _AES_GCM_AVAILABLE = False


def _get_kek() -> bytes:
    """
    Derive the 32-byte key-encryption-key from REPORT_TOKEN.

    Fail-closed: raises RuntimeError if REPORT_TOKEN is absent.
    This ensures the keystore is never encrypted with a predictable
    fallback value — callers catch the error and skip persistence.
    """
    report_token = os.environ.get("REPORT_TOKEN", "")
    if not report_token:
        raise RuntimeError(
            "[keystore] REPORT_TOKEN env var is unset — "
            "key persistence requires a secret token.  "
            "Set REPORT_TOKEN in the environment or as a Replit secret."
        )
    return hkdf_sha256(
        report_token.encode("utf-8"),
        b"CM_KEK_v1",
        b"ns_keystore",
        32,
    )


# Serialize all SQLite keystore writes through a single lock so concurrent
# background threads cannot produce "database is locked" errors.
_KEYSTORE_WRITE_LOCK = threading.Lock()


def _keystore_db_conn():
    """Open the keystore DB and ensure the ns_keystore table exists."""
    db_path = os.path.abspath(_DB_PATH)
    if not os.path.exists(db_path):
        return None
    try:
        conn = _sqlite3.connect(db_path, timeout=10)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS ns_keystore (
                uid        TEXT NOT NULL,
                ogt        TEXT NOT NULL,
                ns_slot    INTEGER,
                nonce_hex  TEXT NOT NULL,
                k_enc_ct   TEXT NOT NULL,
                k_mac_ct   TEXT NOT NULL,
                PRIMARY KEY (uid, ogt)
            )
        """)
        # Add ns_slot column to older databases that were created without it.
        try:
            conn.execute("ALTER TABLE ns_keystore ADD COLUMN ns_slot INTEGER")
            conn.commit()
        except _sqlite3.OperationalError:
            pass   # Column already exists — normal case.
        conn.commit()
        return conn
    except Exception as e:
        print(f"  [keystore] DB open error: {e}", file=sys.stderr)
        return None


def _store_keys_encrypted(uid: str, ogt: str, k_enc: bytes, k_mac: bytes,
                          ns_slot: "int | None" = None) -> None:
    """
    Encrypt K_enc and K_mac with AES-256-GCM (KEK-derived) and persist
    to ns_keystore table.

    - Skips silently if AES-GCM is unavailable (pycryptodome not installed).
    - Skips silently if REPORT_TOKEN is unset (fail-closed KEK).
    - Serialised through _KEYSTORE_WRITE_LOCK to prevent SQLite contention.
    - `ns_slot` is the firmware-side BRAM slot index — stored as informational
      only.  The key derivation formula never uses slot numbers (per spec §2.6).
    """
    if not _AES_GCM_AVAILABLE:
        return
    with _KEYSTORE_WRITE_LOCK:
        try:
            kek = _get_kek()
            nonce = os.urandom(12)
            cipher = _AES_Cipher.new(kek, _AES_Cipher.MODE_GCM, nonce=nonce)
            plaintext = k_enc + k_mac          # 32 bytes total
            ciphertext, tag = cipher.encrypt_and_digest(plaintext)
            payload = ciphertext + tag         # append 16-byte GCM tag
            nonce_hex = nonce.hex()
            ct_hex = payload.hex()
            conn = _keystore_db_conn()
            if conn is None:
                return
            conn.execute(
                """INSERT OR REPLACE INTO ns_keystore
                   (uid, ogt, ns_slot, nonce_hex, k_enc_ct, k_mac_ct)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (uid, ogt, ns_slot, nonce_hex, ct_hex[:64], ct_hex[64:]),
            )
            conn.commit()
            conn.close()
        except RuntimeError as rte:
            # REPORT_TOKEN absent — fail-closed, log once per OGT
            print(f"  [keystore] skip persist for {ogt!r}: {rte}", file=sys.stderr)
        except Exception as e:
            print(f"  [keystore] store error for {ogt!r}: {e}", file=sys.stderr)


# Set of board UIDs for which we have already attempted a keystore load in
# this process session.  Prevents repeated DB queries on every CALLHOME.
_keystore_loaded_uids: set = set()


def _load_keys_for_board(uid: str) -> None:
    """
    Decrypt and repopulate _ogt_to_keys for all OGTs belonging to `uid`.

    Called at the start of the first CALLHOME from a new or reconnecting
    board, before key re-derivation overwrites in-memory state.  This restores
    keys from a previous session so the bridge can process binary frames that
    arrive between CALLHOME packets on reconnect.

    Skips silently if REPORT_TOKEN is absent (fail-closed) or pycryptodome
    is not installed.  Never blocks the CALLHOME handler — errors are logged
    and ignored.
    """
    global _ogt_to_keys
    if not _AES_GCM_AVAILABLE:
        return
    try:
        conn = _keystore_db_conn()
        if conn is None:
            return
        rows = conn.execute(
            "SELECT ogt, nonce_hex, k_enc_ct, k_mac_ct "
            "FROM ns_keystore WHERE uid=?",
            (uid,),
        ).fetchall()
        conn.close()
        if not rows:
            return
        kek = _get_kek()
        loaded = 0
        for ogt, nonce_hex, k_enc_ct_hex, k_mac_ct_hex in rows:
            try:
                nonce = bytes.fromhex(nonce_hex)
                full_payload = bytes.fromhex(k_enc_ct_hex + k_mac_ct_hex)
                ciphertext = full_payload[:32]
                tag        = full_payload[32:48]
                cipher = _AES_Cipher.new(kek, _AES_Cipher.MODE_GCM, nonce=nonce)
                plaintext = cipher.decrypt_and_verify(ciphertext, tag)
                _ogt_to_keys[ogt] = {
                    "k_enc": plaintext[:16],
                    "k_mac": plaintext[16:32],
                }
                loaded += 1
            except Exception as inner_e:
                print(f"  [keystore] decrypt error for {ogt!r}: {inner_e}",
                      file=sys.stderr)
        if loaded:
            print(f"  [keystore] Loaded {loaded} key(s) for UID={uid} from DB")
    except RuntimeError as rte:
        # REPORT_TOKEN absent — skip silently (fail-closed)
        print(f"  [keystore] skip load for UID={uid}: {rte}", file=sys.stderr)
    except Exception as e:
        print(f"  [keystore] load error for UID={uid}: {e}", file=sys.stderr)


# ---------------------------------------------------------------------------
# ns_manifest state — populated from CALLHOME ns_manifest field (fw v1.2+)
#
# _token32_to_ogt: maps token_32 (int) → ogt string, for every entry the
#   board reported in its last ns_manifest.  Used by T0.4 key lookup.
#
# _ogt_to_keys: maps ogt string → {"k_enc": bytes, "k_mac": bytes}.
#   Populated by T0.4 key derivation after CALLHOME.  Stub until then.
# ---------------------------------------------------------------------------
_token32_to_ogt: dict = {}
_ogt_to_keys: dict = {}

# ---------------------------------------------------------------------------
# Globals
# ---------------------------------------------------------------------------
_ser_lock = threading.Lock()
_ser = None
_stop_event = threading.Event()
_last_uid = None

_uart_buffer = []
_uart_buffer_lock = threading.Lock()

# ---------------------------------------------------------------------------
# PATCH_LUMP upload helpers
# ---------------------------------------------------------------------------

def _crc16_ccitt(data: bytes) -> int:
    """CRC-16/CCITT-FALSE: poly=0x1021, init=0xFFFF, MSB-first, no reflection.
    Matches the CRC16_CCITT Amaranth module in hardware/uart_crc16.py.
    """
    crc = 0xFFFF
    for byte in data:
        crc ^= byte << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) if (crc & 0x8000) else (crc << 1)
        crc &= 0xFFFF
    return crc


def _upload_boot_image() -> bool:
    """Fetch the current boot image from the IDE and push it to the Church
    Machine's BRAM via the PATCH_LUMP (0xBEEF) protocol on the CM debug UART
    (ttyUSB3, 115200 baud — separate from the SoC call-home UART on ttyUSB2).

    Protocol frame:
      [0xBE][0xEF][addrHi][addrLo][cntHi][cntLo]  ← header (6 bytes)
      [N × 4 bytes, little-endian words]            ← data
      [crcHi][crcLo]                               ← CRC-16/CCITT-FALSE over data

    ACK (success): [addrHi][addrLo][cntHi][cntLo]  ← echoes addr + count
    NAK (failure): [0x15]

    After a successful upload the CM debug FSM is in HALTED state.  Hold the
    push button for ~1 s to retransmit the banner and restart the CM from
    NIA=0 with the patched namespace.
    """
    if not _IDE_SERVER_URL:
        print("ERROR: --upload requires --ide=URL so the boot image can be fetched",
              file=sys.stderr)
        return False

    import urllib.request as _urllib_req

    print(f"  [upload] Fetching boot image from {_IDE_SERVER_URL}/api/boot-image/binary …")
    try:
        req = _urllib_req.Request(f"{_IDE_SERVER_URL}/api/boot-image/binary")
        resp = _urllib_req.urlopen(req, timeout=15, context=_ssl_ctx())
        img_bytes = resp.read()
    except Exception as e:
        print(f"ERROR: could not fetch boot image: {e}", file=sys.stderr)
        return False

    if len(img_bytes) == 0:
        print("ERROR: boot image is empty — generate it first via the IDE", file=sys.stderr)
        return False
    if len(img_bytes) % 4 != 0:
        print(f"ERROR: boot image size {len(img_bytes)} is not a multiple of 4",
              file=sys.stderr)
        return False

    n_words = len(img_bytes) // 4
    print(f"  [upload] {n_words} words ({len(img_bytes)} bytes), CRC computing …")

    crc  = _crc16_ccitt(img_bytes)
    addr = 0x0000
    frame = bytes([
        0xBE, 0xEF,
        (addr   >> 8) & 0xFF,   addr   & 0xFF,
        (n_words >> 8) & 0xFF,  n_words & 0xFF,
    ]) + img_bytes + bytes([(crc >> 8) & 0xFF, crc & 0xFF])

    print(f"  [upload] Opening CM debug port {_UPLOAD_PORT} @ {_UPLOAD_BAUD} baud …")
    if not _SERIAL_AVAILABLE:
        print("ERROR: pyserial not installed — run: pip install pyserial", file=sys.stderr)
        return False

    try:
        import serial as _serial_mod
        cm_ser = _serial_mod.Serial(_UPLOAD_PORT, _UPLOAD_BAUD, timeout=10)
        cm_ser.setRTS(False)
        cm_ser.setDTR(False)
    except Exception as e:
        print(f"ERROR: could not open {_UPLOAD_PORT}: {e}", file=sys.stderr)
        print("  Hint: PATCH_LUMP uses the CM debug UART (ttyUSB3, 115200 baud),")
        print("        not the SoC call-home UART (ttyUSB2, 57600 baud).")
        print("        Use --upload-port=/dev/ttyUSBx to override.")
        return False

    try:
        print(f"  [upload] Sending {len(frame)} bytes ({n_words} words + 8 header + 2 CRC) …")
        cm_ser.write(frame)
        cm_ser.flush()

        print("  [upload] Waiting for ACK …")
        deadline = time.time() + 10.0
        resp = b''
        while time.time() < deadline:
            chunk = cm_ser.read(max(1, 4 - len(resp)))
            if chunk:
                resp += chunk
            if len(resp) >= 1 and resp[0] == 0x15:
                print("ERROR: FPGA sent NAK (0x15) — CRC mismatch or framing error",
                      file=sys.stderr)
                print("  Check that the CM debug UART is on the correct port and baud rate.")
                return False
            if len(resp) >= 4:
                break
            time.sleep(0.005)

        if len(resp) < 4:
            print(f"ERROR: timed out waiting for ACK (got {len(resp)} byte(s): {resp.hex() or 'none'})",
                  file=sys.stderr)
            print("  Is the Ti60 powered on?  Is the CM debug UART on ttyUSB3?")
            return False

        ack_addr = (resp[0] << 8) | resp[1]
        ack_cnt  = (resp[2] << 8) | resp[3]
        if ack_addr != addr or ack_cnt != n_words:
            print(f"ERROR: unexpected ACK bytes: addr=0x{ack_addr:04X} cnt={ack_cnt} "
                  f"(expected addr=0x{addr:04X} cnt={n_words})", file=sys.stderr)
            return False

        print(f"  [upload] ✓ ACK — {n_words} words written to BRAM at 0x{addr:04X}")
        print()
        print("  ┌──────────────────────────────────────────────────────────────┐")
        print("  │  Boot image uploaded.  CM is now halted.                     │")
        print("  │                                                               │")
        print("  │  HOLD the Ti60 push button for ~1 second.                    │")
        print("  │  The banner retransmits, then the CM reboots from NIA=0      │")
        print("  │  with the patched namespace — LED should start flashing.     │")
        print("  └──────────────────────────────────────────────────────────────┘")
        print()
        return True

    finally:
        cm_ser.close()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _open_port(port, baud):
    s = serial.Serial(port, baud, timeout=0)
    s.setRTS(False)
    s.setDTR(False)
    return s


_launch_test_reported = set()


def _report_launch_test(test_id, status="passing", notes=""):
    """PUT a launch-test result to /api/launch-tests/<test_id> on the IDE server."""
    global _launch_test_reported
    if not _IDE_SERVER_URL:
        return
    if test_id in _launch_test_reported and status == "passing":
        return
    import urllib.request
    try:
        body = json.dumps({
            "status": status,
            "device_uid": _last_uid or "",
            "notes": notes,
        }).encode()
        req = urllib.request.Request(
            f"{_IDE_SERVER_URL}/api/launch-tests/{test_id}",
            data=body,
            headers={"Content-Type": "application/json"},
            method="PUT",
        )
        resp = urllib.request.urlopen(req, timeout=10, context=_ssl_ctx())
        result = json.loads(resp.read())
        if result.get("ok"):
            print(f"  [LAUNCH] {test_id} reported as {status}")
            if status == "passing":
                _launch_test_reported.add(test_id)
        else:
            print(f"  [LAUNCH] {test_id} report failed: {result}", file=sys.stderr)
    except Exception as e:
        print(f"  [LAUNCH] {test_id} report error: {e}", file=sys.stderr)


def _ssl_ctx():
    """Return an SSL context — unverified if --insecure, otherwise default."""
    if _INSECURE:
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return ctx
    return None


def _post_callhome(payload):
    """POST a call-home payload dict to /api/device/call-home on the IDE server."""
    if not _IDE_SERVER_URL:
        return
    import urllib.request
    try:
        body = json.dumps(payload).encode()
        req = urllib.request.Request(
            f"{_IDE_SERVER_URL}/api/device/call-home",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        resp = urllib.request.urlopen(req, timeout=10, context=_ssl_ctx())
        result = json.loads(resp.read())
        if result.get("ok"):
            ack_str = "[CALL HOME] ACK received from IDE"
            if result.get("boot_count"):
                ack_str += f" — boot #{result['boot_count']}"
            print(f"  {ack_str}")
            with _uart_buffer_lock:
                _uart_buffer.append({
                    "ts":   time.time(),
                    "line": ack_str,
                    "uid":  _last_uid or "unknown",
                })
        else:
            print(f"  [CALL HOME] IDE responded: {result}")
    except Exception as e:
        print(f"  [CALL HOME] POST failed: {e}")


def _handle_callhome_json(line):
    """
    Parse a CALLHOME:{...} line, print a human summary, and POST to the IDE.

    Expected JSON fields (from firmware/main.c uart_emit_callhome):
        board        str   e.g. "Ti60F225"
        uid          str   16-hex-char device UID
        nia          str   e.g. "0x00001234"
        boot_ok      int   1 if boot complete
        boot_reason  int   0=cold boot, 2=fault-recovery re-boot
        fault        int   1 if fault_latched
        fault_code   int   fault code (0-31)
        fault_name   str   human-readable name (firmware v1.1+); bridge fills
                           it from _FAULT_NAMES if firmware omits it
        fw_major     int   firmware major version
        fw_minor     int   firmware minor version
    """
    global _last_uid
    json_str = line[len("CALLHOME:"):].strip()
    try:
        pkt = json.loads(json_str)
    except json.JSONDecodeError as e:
        print(f"  [CALL HOME] JSON parse error: {e}  raw={json_str!r}")
        return

    board        = pkt.get("board", "?")
    uid          = pkt.get("uid", "0" * 16)
    nia          = pkt.get("nia", "0x0")
    boot_ok      = int(pkt.get("boot_ok", 0))
    boot_reason  = int(pkt.get("boot_reason", 0))
    fault        = int(pkt.get("fault", 0))
    fault_code   = int(pkt.get("fault_code", 0))
    fw_major     = int(pkt.get("fw_major", 1))
    fw_minor     = int(pkt.get("fw_minor", 0))
    cr14         = pkt.get("cr14", None)   # GT of active LUMP (Track 4-B+)
    cr12         = pkt.get("cr12", None)
    cr15         = pkt.get("cr15", None)

    # fault_name: use firmware-provided value if present, else look up locally
    fname = pkt.get("fault_name") or (_fault_name(fault_code) if fault else "")

    # GT fault telemetry — Track 4-C (firmware v1.1+ with new bitstream)
    fault_gt    = pkt.get("fault_gt",    None)   # GT word0 hex str, e.g. "0x01800003"
    fault_instr = pkt.get("fault_instr", None)   # instruction word hex str
    fault_cr14  = pkt.get("fault_cr14",  None)   # CR14 word0 hex str
    fault_stage = pkt.get("fault_stage", None)   # int 0-7 pipeline stage

    # NS manifest — present from firmware v1.2+ (Task #1766)
    # Each entry: {"slot": int, "ogt": str, "token_32": "0x...", "label": str, "resident": bool}
    ns_manifest = pkt.get("ns_manifest", None)
    if ns_manifest is not None:
        # Load any persisted keys for this board from a previous session
        # before re-deriving.  This populates _ogt_to_keys for binary frames
        # that may arrive before the next CALLHOME on reconnect.
        if uid not in _keystore_loaded_uids:
            _keystore_loaded_uids.add(uid)
            _load_keys_for_board(uid)

        _token32_to_ogt.clear()
        collision_count = 0
        keys_derived = 0
        # Parse board UID into hi/lo halves for key derivation.
        uid_hex = uid.zfill(16)
        try:
            _uid_hi = int(uid_hex[:8], 16)
            _uid_lo = int(uid_hex[8:], 16)
        except ValueError:
            _uid_hi, _uid_lo = 0, 0
        for entry in ns_manifest:
            ogt       = entry.get("ogt", "")
            t32_str   = entry.get("token_32", "0x0")
            t32_fw    = int(t32_str, 16)
            t32_local = sha32(ogt)
            entry_slot = entry.get("slot", None)   # informational — never in derivation
            if t32_fw != t32_local:
                print(f"  [CALLHOME] WARN token_32 mismatch for {ogt!r}: "
                      f"fw={t32_fw:#010x} local={t32_local:#010x}")
            if t32_local in _token32_to_ogt:
                existing = _token32_to_ogt[t32_local]
                if existing != ogt:
                    print(f"  [CALLHOME] COLLISION token_32={t32_local:#010x}: "
                          f"{existing!r} vs {ogt!r}")
                    collision_count += 1
            else:
                _token32_to_ogt[t32_local] = ogt
            # T0.4 key derivation — populate _ogt_to_keys (never printed/logged)
            if ogt:
                try:
                    k_enc, k_mac = derive_keys(_uid_hi, _uid_lo, ogt)
                    _ogt_to_keys[ogt] = {"k_enc": k_enc, "k_mac": k_mac}
                    keys_derived += 1
                    # Persist encrypted to DB in a background thread.
                    # _store_keys_encrypted is serialised through
                    # _KEYSTORE_WRITE_LOCK so concurrent threads are safe.
                    _uid_str  = uid
                    _ogt_str  = ogt
                    _k_enc    = k_enc
                    _k_mac    = k_mac
                    _ns_slot  = entry_slot
                    threading.Thread(
                        target=_store_keys_encrypted,
                        args=(_uid_str, _ogt_str, _k_enc, _k_mac),
                        kwargs={"ns_slot": _ns_slot},
                        daemon=True,
                    ).start()
                except Exception as _kd_err:
                    print(f"  [CALLHOME] key derivation error for {ogt!r}: {_kd_err}",
                          file=sys.stderr)
        print(f"  [CALLHOME] ns_manifest: {len(_token32_to_ogt)} abstractions registered, "
              f"{keys_derived} key(s) derived"
              + (f"  WARN {collision_count} collision(s)" if collision_count else ""))

    _last_uid = uid

    boot_tag   = " [RECOVERY]" if boot_reason == 2 else ""
    fault_str  = f"  FAULT={fname}" if fault else ""
    gt_str     = f"  GT={fault_gt}" if fault_gt is not None else ""
    instr_str  = f"  INSTR={fault_instr}" if fault_instr is not None else ""
    cr14_str   = f"  CR14={cr14}" if cr14 is not None else ""
    stage_names = ("Fetch", "Decode", "Perm", "Lambda", "TPERM", "Call", "Return", "DataRW")
    stage_str  = (f"  STAGE={stage_names[int(fault_stage)] if int(fault_stage) < len(stage_names) else fault_stage}"
                  if fault_stage is not None else "")
    print(f"  [CALL HOME] {board}  UID={uid}  NIA={nia}  boot_ok={boot_ok}{boot_tag}  FW={fw_major}.{fw_minor}{fault_str}{gt_str}{instr_str}{cr14_str}{stage_str}")

    if _REPORT_LAUNCH and boot_ok and _IDE_SERVER_URL:
        threading.Thread(
            target=_report_launch_test,
            args=("TEST-09",),
            kwargs={"status": "passing", "notes": f"CALLHOME boot_ok=1 from {board} UID={uid} FW={fw_major}.{fw_minor}"},
            daemon=True,
        ).start()

    if _IDE_SERVER_URL:
        payload = {
            "board_type":    board,
            "device_uid":    uid,
            "nia":           nia,
            "boot_complete": boot_ok,
            "boot_reason":   boot_reason,
            "fault_latched": fault,
            "fault_code":    fault_code,
            "fault_name":    fname,
            "fw_major":      fw_major,
            "fw_minor":      fw_minor,
        }
        if cr14 is not None:
            payload["cr14"] = cr14
        if cr12 is not None:
            payload["cr12"] = cr12
        if cr15 is not None:
            payload["cr15"] = cr15
        # Track 4-C GT telemetry (present when firmware reads new APB3 registers)
        if fault_gt is not None:
            payload["fault_gt"] = fault_gt
        if fault_instr is not None:
            payload["fault_instr"] = fault_instr
        if fault_cr14 is not None:
            payload["fault_cr14"] = fault_cr14
        if fault_stage is not None:
            payload["fault_stage"] = fault_stage
        if ns_manifest is not None:
            payload["ns_manifest"] = ns_manifest
        threading.Thread(
            target=_post_callhome,
            args=(payload,),
            daemon=True,
        ).start()


def _flush_uart_buffer():
    """Background thread: POST buffered plain-text UART lines to the IDE every 500 ms."""
    import urllib.request
    while not _stop_event.is_set():
        time.sleep(0.5)
        if not _IDE_SERVER_URL:
            continue
        with _uart_buffer_lock:
            if not _uart_buffer:
                continue
            batch = list(_uart_buffer)
            _uart_buffer.clear()
        try:
            body = json.dumps({"lines": batch}).encode()
            req = urllib.request.Request(
                f"{_IDE_SERVER_URL}/api/device/uart-log",
                data=body,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            urllib.request.urlopen(req, timeout=5, context=_ssl_ctx())
        except Exception as e:
            print(f"  [bridge] uart-log POST failed: {e}")
            with _uart_buffer_lock:
                combined = batch + list(_uart_buffer)
                _uart_buffer.clear()
                _uart_buffer.extend(combined[-500:])


def _post_fault_event(payload: dict):
    """POST a FAULT_EVENT payload to /api/device/fault on the IDE server."""
    if not _IDE_SERVER_URL:
        return
    import urllib.request
    try:
        body = json.dumps(payload).encode()
        req = urllib.request.Request(
            f"{_IDE_SERVER_URL}/api/device/fault",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        resp = urllib.request.urlopen(req, timeout=10, context=_ssl_ctx())
        result = json.loads(resp.read())
        if result.get("ok"):
            print(f"  [FAULT EVENT] ACK received from IDE — fault_code={payload.get('fault_code')} ({payload.get('fault_name')})")
        else:
            print(f"  [FAULT EVENT] IDE responded: {result}")
    except Exception as e:
        print(f"  [FAULT EVENT] POST failed: {e}")


def _post_hung_event(payload: dict):
    """POST a HUNG watchdog event to /api/device/call-home (with hung:true)."""
    if not _IDE_SERVER_URL:
        return
    import urllib.request
    try:
        body = json.dumps(payload).encode()
        req = urllib.request.Request(
            f"{_IDE_SERVER_URL}/api/device/call-home",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        resp = urllib.request.urlopen(req, timeout=10, context=_ssl_ctx())
        result = json.loads(resp.read())
        if result.get("ok"):
            print(f"  [HUNG] ACK from IDE — nia={payload.get('nia')}")
        else:
            print(f"  [HUNG] IDE responded: {result}")
    except Exception as e:
        print(f"  [HUNG] POST failed: {e}")


def _post_trace_event(payload: dict):
    """POST a TRACE record to /api/device/trace on the IDE server (best-effort)."""
    if not _IDE_SERVER_URL:
        return
    import urllib.request
    try:
        body = json.dumps(payload).encode()
        req = urllib.request.Request(
            f"{_IDE_SERVER_URL}/api/device/trace",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=5, context=_ssl_ctx())
    except Exception:
        pass   # Trace endpoint is best-effort; silently drop on failure


def _handle_fault_event_line(line: str):
    """
    Parse a FAULT_EVENT:{...} line and forward to the IDE fault endpoint.

    JSON fields:
        uid          str   16-hex device UID
        nia          str   faulting NIA, e.g. "0x00000042"
        fault_code   int   fault code 0-31
        fault_name   str   human-readable name
        fault_gt     str   GT word0 hex, e.g. "0x01800003"
        fault_instr  str   instruction word hex
        fault_cr14   str   CR14 word0 hex
        fault_stage  int   pipeline stage 0-7
        ts           int   loop counter (proxy timestamp)
    """
    json_str = line[len("FAULT_EVENT:"):].strip()
    try:
        pkt = json.loads(json_str)
    except json.JSONDecodeError as e:
        print(f"  [FAULT EVENT] JSON parse error: {e}  raw={json_str!r}")
        return

    uid         = pkt.get("uid", "0" * 16)
    nia         = pkt.get("nia", "0x0")
    fault_code  = int(pkt.get("fault_code", 0))
    fault_name  = pkt.get("fault_name") or _fault_name(fault_code)
    fault_gt    = pkt.get("fault_gt", "0x0")
    fault_instr = pkt.get("fault_instr", "0x0")
    fault_cr14  = pkt.get("fault_cr14", "0x0")
    fault_stage = int(pkt.get("fault_stage", 0))
    ts          = int(pkt.get("ts", 0))

    stage_names = ("Fetch", "Decode", "Perm", "Lambda", "TPERM", "Call", "Return", "DataRW")
    stage_label = stage_names[fault_stage] if fault_stage < len(stage_names) else str(fault_stage)

    print(f"  [FAULT EVENT] UID={uid}  NIA={nia}  code={fault_code} ({fault_name})"
          f"  GT={fault_gt}  INSTR={fault_instr}  CR14={fault_cr14}  stage={stage_label}"
          f"  ts={ts}")

    payload = {
        "device_uid":   uid,
        "nia":          nia,
        "fault_code":   fault_code,
        "fault_name":   fault_name,
        "fault_gt":     fault_gt,
        "fault_instr":  fault_instr,
        "fault_cr14":   fault_cr14,
        "fault_stage":  fault_stage,
        "ts":           ts,
        "fault_latched": 1,
    }
    threading.Thread(target=_post_fault_event, args=(payload,), daemon=True).start()


def _handle_hung_line(line: str):
    """
    Parse a HUNG:{...} line and forward to the IDE as a callhome with hung:true.

    JSON fields:
        uid    str   16-hex device UID
        nia    str   NIA that was frozen, e.g. "0x00000100"
        loops  int   number of consecutive unchanged-NIA samples
    """
    json_str = line[len("HUNG:"):].strip()
    try:
        pkt = json.loads(json_str)
    except json.JSONDecodeError as e:
        print(f"  [HUNG] JSON parse error: {e}  raw={json_str!r}")
        return

    uid   = pkt.get("uid", "0" * 16)
    nia   = pkt.get("nia", "0x0")
    loops = int(pkt.get("loops", 0))

    print(f"  [HUNG] UID={uid}  NIA={nia}  loops={loops} — watchdog triggered, CM reset")

    payload = {
        "board_type":    "Ti60F225",
        "device_uid":    uid,
        "nia":           nia,
        "boot_complete": 0,
        "fault_latched": 0,
        "hung":          True,
        "hung_loops":    loops,
        "fault_code":    0,
        "fault_name":    "",
    }
    threading.Thread(target=_post_hung_event, args=(payload,), daemon=True).start()


def _handle_trace_line(line: str):
    """
    Parse a TRACE:[0x...,0x...,...] line and forward to the IDE trace endpoint.

    The line contains a JSON array of hex address strings, e.g.:
        TRACE:[0x00000001,0x00000002,...,0x0000000A]
    """
    array_str = line[len("TRACE:"):].strip()
    try:
        # The array may contain bare hex strings without JSON quoting —
        # wrap each element in quotes if needed, or parse directly.
        # Firmware v2.0 emits: TRACE:[0x...,0x...] — valid JSON array of strings.
        addresses = json.loads(array_str)
    except json.JSONDecodeError:
        # Fallback: split manually on comma/brackets
        inner = array_str.strip("[]")
        addresses = [a.strip() for a in inner.split(",") if a.strip()]

    uid = _last_uid or "unknown"
    print(f"  [TRACE] UID={uid}  {len(addresses)} NIA entries: {addresses[:3]}{'...' if len(addresses) > 3 else ''}")

    payload = {
        "device_uid": uid,
        "nia_trace":  addresses,
        "ts":         time.time(),
    }
    threading.Thread(target=_post_trace_event, args=(payload,), daemon=True).start()


def _process_line(line):
    """Route a decoded text line to the appropriate handler."""
    if line.startswith("CALLHOME:"):
        _handle_callhome_json(line)
    elif line.startswith("FAULT_EVENT:"):
        _handle_fault_event_line(line)
    elif line.startswith("HUNG:"):
        _handle_hung_line(line)
    elif line.startswith("TRACE:"):
        _handle_trace_line(line)
    else:
        print(f"  {line}")
        if _IDE_SERVER_URL:
            with _uart_buffer_lock:
                _uart_buffer.append({
                    "ts":   time.time(),
                    "line": line,
                    "uid":  _last_uid or "unknown",
                })


# ---------------------------------------------------------------------------
# Reader thread
# ---------------------------------------------------------------------------

def _reader_thread(port, baud):
    global _ser
    buf = b""
    while not _stop_event.is_set():
        with _ser_lock:
            s = _ser
        if s is None or not s.is_open:
            time.sleep(0.1)
            continue
        try:
            waiting = s.in_waiting
            if waiting:
                chunk = s.read(waiting)
                buf += chunk
                while b'\n' in buf:
                    idx = buf.index(b'\n')
                    raw = buf[:idx]
                    buf = buf[idx + 1:]
                    line = raw.rstrip(b'\r').decode('utf-8', errors='replace')
                    if line:
                        _process_line(line)
            else:
                time.sleep(0.005)
        except serial.SerialException as e:
            print(f"  [bridge] Serial error: {e}")
            with _ser_lock:
                try:
                    _ser.close()
                except Exception:
                    pass
                _ser = None
            if _AUTO_RECONNECT:
                print(f"  [bridge] Reconnecting in 2 s…")
                time.sleep(2)
                _reconnect(port, baud)
            else:
                _stop_event.set()
        except Exception as e:
            print(f"  [bridge] Unexpected error in reader: {e}")
            time.sleep(0.05)


def _reconnect(port, baud):
    global _ser
    for attempt in range(1, 11):
        try:
            s = _open_port(port, baud)
            with _ser_lock:
                _ser = s
            print(f"  [bridge] Reconnected to {port}")
            return
        except Exception as e:
            print(f"  [bridge] Reconnect attempt {attempt}/10 failed: {e}")
            time.sleep(2)
    print("  [bridge] Could not reconnect after 10 attempts — giving up.")
    _stop_event.set()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    global _ser
    print("Church Machine Ti60 Call-Home Bridge")
    print(f"  Port   : {_SERIAL_PORT} @ {_BAUD} baud")
    if _BAUD != 57600:
        print(f"  WARNING: expected 57600 baud (25 MHz crystal, CLOCKDIV=53); got {_BAUD}")
    if _IDE_SERVER_URL:
        print(f"  IDE    : {_IDE_SERVER_URL}")
    else:
        print("  IDE    : (not configured — use --ide=URL to enable call-home)")
    if _REPORT_LAUNCH:
        if _IDE_SERVER_URL:
            print("  Launch : TEST-09 will be reported passing on first boot_ok=1 CALLHOME")
        else:
            print("  Launch : --report-launch set but --ide=URL missing; reporting disabled")
    if _UPLOAD_MODE:
        print(f"  Upload : boot image → {_UPLOAD_PORT} @ {_UPLOAD_BAUD} baud (PATCH_LUMP)")
        if not _IDE_SERVER_URL:
            print("  Upload : ERROR — --ide=URL required for --upload mode")
    print()
    print("Press Ctrl+C to stop.")
    print()

    if _UPLOAD_MODE:
        ok = _upload_boot_image()
        if not ok:
            sys.exit(1)

    try:
        s = _open_port(_SERIAL_PORT, _BAUD)
        with _ser_lock:
            _ser = s
        print(f"  [bridge] Opened {_SERIAL_PORT}")
    except Exception as e:
        print(f"ERROR: could not open {_SERIAL_PORT}: {e}")
        print()
        print("Hint: The Ti60 FT4232H exposes four USB-UART interfaces:")
        print("  ttyUSB0 — JTAG")
        print("  ttyUSB1 — SPI/debug")
        print("  ttyUSB2 — Sapphire SoC UART0  (this bridge)")
        print("  ttyUSB3 — Church Machine debug UART")
        print()
        print("If ttyUSB2 is not present, try --port=/dev/ttyUSB3 or --port=/dev/ttyACM0")
        sys.exit(1)

    t = threading.Thread(target=_reader_thread, args=(_SERIAL_PORT, _BAUD), daemon=True)
    t.start()

    f = threading.Thread(target=_flush_uart_buffer, daemon=True)
    f.start()

    try:
        while not _stop_event.is_set():
            time.sleep(0.5)
    except KeyboardInterrupt:
        print()
        print("  [bridge] Stopping.")
    finally:
        _stop_event.set()
        with _ser_lock:
            if _ser and _ser.is_open:
                _ser.close()


if __name__ == '__main__':
    main()
