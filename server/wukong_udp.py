"""server/wukong_udp.py — Wukong Ethernet wire-protocol helpers.

Shared between server/app.py (UDP listener thread) and
scripts/test_wukong_protocol.py (dry-run test).

Wire format (docs/HARDWARE.md § Wukong Ethernet Protocol):

Callhome broadcast (board → IDE server, UDP port 5900):
  Offset  Bytes  Field
  0       4      Magic = 0xCE110001
  4       4      Sender token = 0x00003300 (Ethernet abstraction Pet-Name GT)
  8       4      CM version word (u32, big-endian)
  12      6      Board MAC address (6 octets)
  18      2      Pad = 0x0000
  20      4      Link-up uptime (u32, big-endian, seconds since power-on)
  24      2      Request count N (u16, big-endian)
  26      N×4    Requested lump tokens (each u32, big-endian)

Lump-serve response (IDE server → board, UDP port 5900):
  Offset  Bytes  Field
  0       4      Magic = 0xCE110002
  4       4      Lump token (u32, big-endian) — Pet-Name GT of the served lump
  8       4      Word count W (u32, big-endian)
  12      W×4    LUMP data words (each u32, big-endian)

Identity rule: abstractions are identified by token in every frame field.
NS slot numbers are never used as identifiers in the wire protocol.
"""

import struct
import socket
import threading
import logging
import time

CALLHOME_MAGIC   = 0xCE110001
LUMPSERVE_MAGIC  = 0xCE110002
WUKONG_PORT      = 5900
CALLHOME_MIN_LEN = 26    # minimum callhome frame length (N=0)

ETHERNET_TOKEN   = 0x00003300   # Pet-Name GT of the Ethernet abstraction


# ── Frame constructors (used by tests and the board simulator) ────────────────

def build_callhome_frame(src_mac, cm_version=0, uptime=0, requests=None):
    """Build a Wukong callhome UDP payload.

    Parameters
    ----------
    src_mac    : bytes  6-byte board MAC address
    cm_version : int    CM version word (upper16=major, lower16=minor)
    uptime     : int    seconds since power-on
    requests   : list   lump tokens (int) the Locator is requesting; default []

    Returns
    -------
    bytes  raw UDP payload (not including IP/UDP header)
    """
    if requests is None:
        requests = []
    n = len(requests)
    frame  = struct.pack('>III', CALLHOME_MAGIC, ETHERNET_TOKEN, cm_version)
    frame += (src_mac[:6] + b'\x00' * 6)[:6]
    frame += b'\x00\x00'
    frame += struct.pack('>IH', uptime, n)
    if n:
        frame += struct.pack(f'>{n}I', *requests)
    return frame


def build_lump_serve_response(token, words):
    """Build a lump-serve response UDP payload.

    Parameters
    ----------
    token : int        Pet-Name GT token of the lump being served
    words : list[int]  LUMP data words (32-bit each)

    Returns
    -------
    bytes  raw UDP payload
    """
    w = len(words)
    payload = struct.pack('>III', LUMPSERVE_MAGIC, token, w)
    if w:
        payload += struct.pack(f'>{w}I', *words)
    return payload


# ── Frame parsers ─────────────────────────────────────────────────────────────

def parse_callhome_frame(data):
    """Parse a Wukong callhome UDP payload.

    Returns a dict with parsed fields, or None if the frame is malformed.

    Fields in the returned dict:
        magic       (int)        always CALLHOME_MAGIC
        token       (int)        sender abstraction token
        cm_version  (int)        CM version word
        mac         (bytes)      6-byte board MAC address
        uptime      (int)        seconds since power-on
        requests    (list[int])  lump tokens the board is requesting
    """
    if len(data) < CALLHOME_MIN_LEN:
        return None
    magic, token, cm_version = struct.unpack_from('>III', data, 0)
    if magic != CALLHOME_MAGIC:
        return None
    if token != ETHERNET_TOKEN:
        logging.warning(
            "Wukong callhome: unexpected sender token 0x%08X (expected 0x%08X)",
            token, ETHERNET_TOKEN)
    mac = data[12:18]
    uptime, n_requests = struct.unpack_from('>IH', data, 20)
    required = CALLHOME_MIN_LEN + n_requests * 4
    if len(data) < required:
        return None
    if n_requests:
        requests = list(struct.unpack_from(f'>{n_requests}I', data, 26))
    else:
        requests = []
    return {
        'magic':      magic,
        'token':      token,
        'cm_version': cm_version,
        'mac':        mac,
        'uptime':     uptime,
        'requests':   requests,
    }


def parse_lump_serve_response(data):
    """Parse a lump-serve response UDP payload.

    Returns a dict with parsed fields, or None if the frame is malformed.

    Fields:
        magic  (int)        always LUMPSERVE_MAGIC
        token  (int)        Pet-Name GT token of the served lump
        words  (list[int])  LUMP data words
    """
    if len(data) < 12:
        return None
    magic, token, w = struct.unpack_from('>III', data, 0)
    if magic != LUMPSERVE_MAGIC:
        return None
    if len(data) < 12 + w * 4:
        return None
    words = list(struct.unpack_from(f'>{w}I', data, 12)) if w else []
    return {'magic': magic, 'token': token, 'words': words}


# ── UDP listener thread ───────────────────────────────────────────────────────

class WukongUdpListener:
    """Background UDP listener for Wukong callhome frames on UDP port 5900.

    Usage::

        def handle(entry):
            print("Wukong callhome from", entry['src_addr'])

        def lookup(token):
            # Return list[int] of 32-bit LUMP words for the given token, or None
            return my_lump_db.get(token)

        listener = WukongUdpListener(
            on_callhome=handle,
            lump_lookup=lookup,
        )
        listener.start()
        ...
        listener.stop()

    Parameters
    ----------
    port : int
        UDP port to listen on (default: 5900).
    on_callhome : callable(entry: dict) | None
        Called on the listener thread for each valid callhome frame.
        ``entry`` is the dict returned by parse_callhome_frame() augmented
        with ``'src_addr'`` (host, port) and ``'ts'`` (Unix timestamp).
    lump_lookup : callable(token: int) -> list[int] | None
        Called for each token in the callhome ``requests`` list.  Should
        return the LUMP data words for that token, or ``None`` if not found.
        Called on the listener thread — implementations must be thread-safe.
        Takes precedence over ``lump_store`` when both are provided.
    lump_store : dict[int, list[int]] | None
        Static token → word-list mapping used when ``lump_lookup`` is not
        provided or returns ``None``.  Useful for tests and fixed boot lumps.
    """

    def __init__(self, port=WUKONG_PORT, on_callhome=None,
                 lump_lookup=None, lump_store=None):
        self.port        = port
        self.on_callhome = on_callhome
        self.lump_lookup = lump_lookup
        self.lump_store  = lump_store or {}
        self._sock       = None
        self._thread     = None
        self._stop_event = threading.Event()

    def start(self):
        """Bind the UDP socket and start the listener thread."""
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            sock.settimeout(1.0)
            sock.bind(('', self.port))
            self._sock = sock
            self._stop_event.clear()
            self._thread = threading.Thread(
                target=self._run, daemon=True, name='wukong-udp-listener')
            self._thread.start()
            logging.info("WukongUdpListener started on UDP port %d", self.port)
        except OSError as exc:
            logging.warning(
                "WukongUdpListener: could not bind to port %d: %s",
                self.port, exc)

    def stop(self):
        """Signal the listener to stop and wait for the thread to exit."""
        self._stop_event.set()
        if self._sock:
            try:
                self._sock.close()
            except Exception:
                pass
        if self._thread:
            self._thread.join(timeout=3.0)

    def restart_after_fork(self):
        """Restart the listener thread after a process fork (e.g. gunicorn post_fork).

        OS threads do not survive fork().  The socket file descriptor IS inherited
        by the child process, so we reuse it rather than re-binding the port.
        This avoids both 'address already in use' errors and port-ownership races
        with the parent process.

        If the socket was not inherited (self._sock is None), falls back to a
        full stop+start cycle.
        """
        if self._sock is None:
            # No inherited socket — full restart
            self.start()
            return
        # Socket inherited; only the thread needs to be recreated.
        self._stop_event.clear()
        self._thread = threading.Thread(
            target=self._run, daemon=True, name='wukong-udp-listener')
        self._thread.start()
        logging.info(
            "WukongUdpListener: thread restarted after fork on UDP port %d",
            self.port)

    def _run(self):
        while not self._stop_event.is_set():
            try:
                data, addr = self._sock.recvfrom(2048)
            except socket.timeout:
                continue
            except OSError:
                break
            entry = parse_callhome_frame(data)
            if entry is None:
                continue
            entry['src_addr'] = addr
            entry['ts'] = time.time()
            if self.on_callhome:
                try:
                    self.on_callhome(entry)
                except Exception as exc:
                    logging.error(
                        "WukongUdpListener on_callhome callback error: %s", exc)
            for req_token in entry.get('requests', []):
                words = None
                # Try lump_lookup callable first (dynamic, e.g. from server manifest)
                if self.lump_lookup is not None:
                    try:
                        words = self.lump_lookup(req_token)
                    except Exception as exc:
                        logging.warning(
                            "WukongUdpListener: lump_lookup error for token "
                            "0x%08X: %s", req_token, exc)
                # Fall back to static lump_store
                if words is None:
                    words = self.lump_store.get(req_token)
                if words is not None:
                    response = build_lump_serve_response(req_token, words)
                    try:
                        self._sock.sendto(response, addr)
                        logging.info(
                            "WukongUdpListener: served lump token=0x%08X "
                            "words=%d to %s",
                            req_token, len(words), addr)
                    except Exception as exc:
                        logging.warning(
                            "WukongUdpListener: reply send error for token "
                            "0x%08X: %s", req_token, exc)
                else:
                    logging.warning(
                        "WukongUdpListener: requested token 0x%08X not found "
                        "in lump_lookup or lump_store", req_token)
