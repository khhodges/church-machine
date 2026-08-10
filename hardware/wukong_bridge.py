#!/usr/bin/env python3
"""hardware/wukong_bridge.py — UART bridge: Wukong board ↔ Church Machine IDE.

Usage
-----
    python3 hardware/wukong_bridge.py --ide=https://<your-replit-url>
    python3 hardware/wukong_bridge.py --port=/dev/ttyUSB0 --ide=http://localhost:5000 --insecure

What it does
------------
Reads bytes from the UART (57600 8N1):
  • ASCII bytes (bit-7 clear) are printed to stdout as CM program output.
  • 0xAA-prefixed 12-byte trace packets are parsed and POSTed to
    /hardware/wukong/trace as JSON.

Polls GET /hardware/wukong/command every 50 ms and writes any pending command
byte to the serial port.  Commands from the IDE:

  {cmd: "s"}                    → write b's'  (step: execute one instruction)
  {cmd: "r"}                    → write b'r'  (run free)
  {cmd: "h"}                    → write b'h'  (halt immediately)
  {cmd: "b", nia: N}            → write b'b' + big-endian 4-byte NIA  (set/clear breakpoint)
  {cmd: "u", data: "<base64>"}  → decode boot-image bytes, write 0x75+len(4 BE)+bytes
                                   to UART, then POST result to /hardware/wukong/upload-ack

Trace packet format (12 bytes, big-endian) — one packet per state-change event:
  [0]     0xAA      magic
  [1..4]  NIA       retiring instruction NIA (uint32 big-endian)
  [5]     ev_type   TRACE_EV_* constant (which CR changed, or stack push/pop)
  [6..9]  payload   GT word0 (uint32 big-endian); 0 for push/pop events
  [10]    flags     bits[3:0] = NZCV; bits[7:4] = 0
  [11]    fault     bits[4:0]=fault_code; bit[6]=fault_valid; bit[7]=bp_hit

Multi-event instructions emit multiple consecutive packets with the same NIA:
  LOAD    → 2 packets (LOAD.shadow, LOAD.new)
  CHANGE  → 3 packets (CHANGE.push, CHANGE.CR12, CHANGE.CR5)
  CALL    → 3 packets (CALL.CR6, CALL.CR14, CALL.push)
  RETURN  → 3 packets (RETURN.pop, RETURN.CR6, RETURN.CR14)
  others  → 1 packet  (RESULT)
"""

import argparse
import base64
import os
import struct
import sys
import time

try:
    import serial
except ImportError:
    serial = None  # unit tests import this module without pyserial; main() checks

try:
    import requests
except ImportError:
    requests = None  # IDE notifications silently skipped; bridge main() will exit if None

try:
    from wukong_trace_symbols import trace_metadata as _trace_metadata
except ImportError:
    # The bridge is also distributed as a standalone single-file download.
    _trace_metadata = None


TRACE_MAGIC    = 0xAA
TRACE_LEN      = 12   # 12-byte per-event packet: magic(1)+NIA(4)+ev_type(1)+payload(4)+flags(1)+fault(1)

# ── Event type constants ──────────────────────────────────────────────────────
# Must match _TRACE_EV_* in wukong_top.py and docs/debug-packet-protocol.md.
TRACE_EV_RESULT      = 0x00  # Single-packet result (DR→DR, SAVE, Function, etc.)
TRACE_EV_LOAD_SHADOW = 0x01  # LOAD: old CR_dst GT displaced
TRACE_EV_LOAD_NEW    = 0x02  # LOAD: new GT installed in CR_dst
TRACE_EV_CHANGE_PUSH = 0x03  # CHANGE: context stack push
TRACE_EV_CHANGE_CR12 = 0x04  # CHANGE: CR12 ← new thread GT
TRACE_EV_CHANGE_CR5  = 0x05  # CHANGE: CR5  ← heap GT
TRACE_EV_CALL_CR6    = 0x06  # CALL:   CR6  ← abstraction GT
TRACE_EV_CALL_CR14   = 0x07  # CALL:   CR14 ← code / return GT
TRACE_EV_CALL_PUSH   = 0x08  # CALL:   caller frame stack push
TRACE_EV_RETURN_POP  = 0x09  # RETURN: caller frame stack pop
TRACE_EV_RETURN_CR6  = 0x0A  # RETURN: CR6  ← restored from frame
TRACE_EV_RETURN_CR14 = 0x0B  # RETURN: CR14 ← restored from frame

_EV_NAMES = {
    TRACE_EV_RESULT:      'RESULT',
    TRACE_EV_LOAD_SHADOW: 'LOAD.shadow',
    TRACE_EV_LOAD_NEW:    'LOAD.new',
    TRACE_EV_CHANGE_PUSH: 'CHANGE.push',
    TRACE_EV_CHANGE_CR12: 'CHANGE.CR12',
    TRACE_EV_CHANGE_CR5:  'CHANGE.CR5',
    TRACE_EV_CALL_CR6:    'CALL.CR6',
    TRACE_EV_CALL_CR14:   'CALL.CR14',
    TRACE_EV_CALL_PUSH:   'CALL.push',
    TRACE_EV_RETURN_POP:  'RETURN.pop',
    TRACE_EV_RETURN_CR6:  'RETURN.CR6',
    TRACE_EV_RETURN_CR14: 'RETURN.CR14',
}

# ── Boot sentinel constants ───────────────────────────────────────────────────
# Old (stale) bitstreams emit a 2-byte sentinel:  0xBB  N_INIT&0xFF
# New bitstreams emit a 3-byte sentinel:           0xBC  N_INIT&0xFF  TU_VERSION
#
# TU_VERSION encodes TraceUnit FSM capability:
#   0x02 = ELOADCALL and XLOADLAMBDA emit 3-packet CALL sequence
#          (CALL_CR6 + CALL_CR14 + CALL_PUSH) — current standard.
#
# If the bridge sees 0xBB it knows the TraceUnit is old: ELOADCALL and
# XLOADLAMBDA will emit a single RESULT packet instead of the 3-packet CALL
# sequence, so CR6/CR14 state shown in the IDE will be silently wrong.
BOOT_SENTINEL_V1  = 0xBB   # old/stale 2-byte sentinel magic
BOOT_SENTINEL_V2  = 0xBC   # current 3-byte sentinel magic
SENTINEL_V1_LEN   = 2      # 0xBB  N_INIT&0xFF
SENTINEL_V2_LEN   = 4      # 0xBC  N_INIT&0xFF  TU_VERSION  BUILD_VERSION

# Minimum TU_VERSION required to guarantee correct ELOADCALL/XLOADLAMBDA trace.
TU_VERSION_CALL_3PKT = 0x02  # must match _TU_VERSION_CALL_3PKT in wukong_top.py


def parse_boot_sentinel(buf, i=0):
    """Parse a boot sentinel starting at position *i* of *buf*.

    Shared helper used by both the bridge's ``main()`` loop and the smoke
    test's ``check_sentinel()``.  Centralising the parsing here means a
    single change keeps both paths in sync.

    Parameters
    ----------
    buf : bytes | bytearray
        Receive buffer (may contain arbitrary bytes before and after the
        sentinel).
    i : int
        Index of the candidate sentinel byte within *buf*.

    Returns
    -------
    None
        ``buf[i]`` is not a sentinel magic byte (0xBB or 0xBC); the caller
        should advance ``i`` and try the next byte.
    False
        ``buf[i]`` *is* a sentinel magic byte, but the buffer does not yet
        contain the full sentinel (not enough bytes).  The caller should
        wait for more data without advancing ``i``.
    dict
        Fully-parsed sentinel.  Keys:

        ``magic``       — sentinel magic byte (``BOOT_SENTINEL_V1`` or
                          ``BOOT_SENTINEL_V2``)
        ``n_init_byte`` — raw N_INIT byte sent by the board
        ``tu_version``  — ``TU_VERSION`` byte for V2 sentinels; ``None``
                          for V1 (stale) sentinels
        ``length``      — number of bytes consumed (``SENTINEL_V1_LEN`` or
                          ``SENTINEL_V2_LEN``)
        ``stale``       — ``True`` when the sentinel indicates a stale
                          TraceUnit FSM (V1 magic, or V2 with
                          ``tu_version < TU_VERSION_CALL_3PKT``)
    """
    if i >= len(buf):
        return None
    b = buf[i]
    if b == BOOT_SENTINEL_V1:
        # Old 2-byte sentinel: 0xBB  N_INIT&0xFF
        if len(buf) - i < SENTINEL_V1_LEN:
            return False
        return {
            'magic':        b,
            'n_init_byte':  buf[i + 1],
            'tu_version':   None,
            'length':       SENTINEL_V1_LEN,
            'stale':        True,
        }
    elif b == BOOT_SENTINEL_V2:
        # Current 4-byte sentinel: 0xBC  N_INIT&0xFF  TU_VERSION  BUILD_VERSION
        if len(buf) - i < SENTINEL_V2_LEN:
            return False
        tu_version    = buf[i + 2]
        build_version = buf[i + 3]
        return {
            'magic':         b,
            'n_init_byte':   buf[i + 1],
            'tu_version':    tu_version,
            'build_version': build_version,
            'length':        SENTINEL_V2_LEN,
            'stale':         tu_version < TU_VERSION_CALL_3PKT,
        }
    return None


def _compute_expected_n_init():
    """Return the N_INIT value expected from the current boot_rom.py tables.

    Mirrors wukong_top.py:
        hw_init_pairs = [(addr, val) for addr, val in enumerate(dmem_init) if val != 0]
        N_INIT = len(hw_init_pairs)

    Returns None if boot_rom cannot be imported (bridge running stand-alone
    without the hardware package on the path).
    """
    try:
        _here = os.path.dirname(os.path.abspath(__file__))
        _root = os.path.dirname(_here)   # project root
        if _root not in sys.path:
            sys.path.insert(0, _root)
        from hardware.boot_rom import WUKONG_DEMO_NAMESPACE, WUKONG_DEMO_CLIST
    except ImportError:
        return None

    dmem_init = list(WUKONG_DEMO_NAMESPACE)
    while len(dmem_init) < 256:
        dmem_init.append(0)
    dmem_init += list(WUKONG_DEMO_CLIST)
    while len(dmem_init) < 16384:
        dmem_init.append(0)
    return sum(1 for v in dmem_init if v != 0)


def _flags_str(flags_byte):
    """Return a human-readable flag string like 'NZ' from the flags byte."""
    names = ['V', 'C', 'Z', 'N']  # bits 0..3
    return ''.join(n for i, n in enumerate(names) if flags_byte & (1 << i)) or '-'


_STANDALONE_WUKONG_WORDS = (
    0x071B0005, 0x07230006, 0xAF080001, 0x8F098000,
    0xAF280043, 0x8F2A0000, 0x87320001, 0xB73B0001,
    0xB8007FFE, 0xAF28004D, 0x8F2A0000, 0x87320001,
    0xB73B0001, 0xB8007FFE, 0xAF28003A, 0x8F2A0000,
    0x87320001, 0xB73B0001, 0xB8007FFE, 0xAF280057,
    0x8F2A0000, 0x87320001, 0xB73B0001, 0xB8007FFE,
    0xAF280055, 0x8F2A0000, 0x87320001, 0xB73B0001,
    0xB8007FFE, 0xAF28004B, 0x8F2A0000, 0x87320001,
    0xB73B0001, 0xB8007FFE, 0xAF28004F, 0x8F2A0000,
    0x87320001, 0xB73B0001, 0xB8007FFE, 0xAF28004E,
    0x8F2A0000, 0x87320001, 0xB73B0001, 0xB8007FFE,
    0xAF280047, 0x8F2A0000, 0x87320001, 0xB73B0001,
    0xB8007FFE, 0xAF28000D, 0x8F2A0000, 0x87320001,
    0xB73B0001, 0xB8007FFE, 0xAF28000A, 0x8F2A0000,
    0x87320001, 0xB73B0001, 0xB8007FFE, 0xAF18017C,
    0xAF103FFF, 0xB7110001, 0xB8807FFF, 0xB7198001,
    0xB8807FFC, 0x8F018000, 0xAF18017C, 0xAF103FFF,
    0xB7110001, 0xB8807FFF, 0xB7198001, 0xB8807FFC,
    0xBF007FBB,
)
_STANDALONE_BOOT_WORDS = (0x077F8000, 0x27678001, 0x17000000)
_STANDALONE_CONDS = ('EQ', 'NE', 'CS', 'CC', 'MI', 'PL', 'VS', 'VC',
                     'HI', 'LS', 'GE', 'LT', 'GT', 'LE', '', 'NV')
_STANDALONE_OPS = {
    0: 'LOAD', 1: 'SAVE', 2: 'CALL', 3: 'RETURN', 4: 'CHANGE',
    5: 'SWITCH', 6: 'TPERM', 7: 'LAMBDA', 8: 'ELOADCALL',
    9: 'XLOADLAMBDA', 16: 'DREAD', 17: 'DWRITE', 18: 'BFEXT',
    19: 'BFINS', 20: 'MCMP', 21: 'IADD', 22: 'ISUB',
    23: 'BRANCH', 24: 'SHL', 25: 'SHR',
}


def _standalone_disassemble(word):
    word &= 0xFFFFFFFF
    opcode = (word >> 27) & 0x1F
    cond = (word >> 23) & 0xF
    dst = (word >> 19) & 0xF
    src = (word >> 15) & 0xF
    imm = word & 0x7FFF
    op = _STANDALONE_OPS.get(opcode)
    if op is None:
        return f'??? 0x{word:08x}'
    op += '' if cond == 14 else _STANDALONE_CONDS[cond]
    if opcode in (0, 1, 2, 4, 5, 8, 9):
        return f'{op} CR{dst}, CR{src}[0x{imm:04X}]'
    if opcode in (16, 17):
        if imm & 0x4000:
            return f'{op} DR{dst}, CR{src}, #{imm & 0x3FFF}'
        return f'{op} DR{dst}, CR{src}, #{(imm >> 4) & 0x3FF}, DR{imm & 0xF}'
    if opcode in (18, 19):
        return f'{op} DR{dst}, DR{src}, #{(imm >> 5) & 0x1F}, #{imm & 0x1F}'
    if opcode == 20:
        return f'{op} DR{dst}, DR{src}'
    if opcode in (21, 22):
        operand = f'#{imm & 0x3FFF}' if imm & 0x4000 else f'DR{imm & 0xF}'
        return f'{op} DR{dst}, DR{src}, {operand}'
    if opcode == 23:
        offset = imm | 0xFFFF8000 if imm & 0x4000 else imm
        if offset & 0x80000000:
            offset -= 0x100000000
        return f'{op} {offset:+d}'
    return f'{op} DR{dst}, DR{src}, {imm & 0x1F}'


def _trace_location(nia):
    """Resolve the reference-bitstream pet-name/offset and disassembly."""
    if _trace_metadata is not None:
        return _trace_metadata(nia)
    nia = int(nia) & 0xFFFFFFFF
    if nia in (0, 4, 8):
        offset = nia // 4
        return {
            'pet_name': 'Boot',
            'offset': offset,
            'nia_label': f'Boot.{offset}',
            'disasm': _standalone_disassemble(_STANDALONE_BOOT_WORDS[offset]),
            'source_map': 'reference-bitstream',
        }
    # 0x700 is the LUMP header; executable word 0 starts at 0x704.
    if 0x700 <= nia < 0x700 + (len(_STANDALONE_WUKONG_WORDS) + 1) * 4 and nia % 4 == 0:
        offset = (nia - 0x700) // 4
        if offset == 0:
            return {
                'pet_name': 'WukongCallHome',
                'offset': 0,
                'nia_label': 'WukongCallHome.0',
                'disasm': 'LUMP_HEADER',
                'source_map': 'reference-bitstream',
            }
        return {
            'pet_name': 'WukongCallHome',
            'offset': offset,
            'nia_label': f'WukongCallHome.{offset}',
            'disasm': _standalone_disassemble(_STANDALONE_WUKONG_WORDS[offset - 1]),
            'source_map': 'reference-bitstream',
        }
    return None


# Fault-code table — must match hardware.hw_types.FaultType exactly.
# (The bridge is distributed as a single standalone file via /dl/wukong-bridge,
# so it cannot import hw_types at runtime on the Chromebook.)
_FAULT_NAMES = {
    0x00: 'NONE',          0x01: 'PERM_R',        0x02: 'PERM_W',
    0x03: 'PERM_X',        0x04: 'PERM_L',        0x05: 'PERM_S',
    0x06: 'PERM_E',        0x07: 'NULL_CAP',      0x08: 'BOUNDS',
    0x09: 'VERSION',       0x0A: 'SEAL',          0x0B: 'INVALID_OP',
    0x0C: 'TPERM_RSV',     0x0D: 'DOMAIN_PURITY', 0x0E: 'BIND',
    0x0F: 'F_BIT',         0x10: 'STACK_OVERFLOW', 0x11: 'ABSENT_OUTFORM',
    0x12: 'STACK_CORRUPT', 0x13: 'STACK_UNDERFLOW', 0x14: 'IRQ_NULL_BASE',
    0x15: 'OUTFORM_CRC',   0x16: 'OUTFORM_ALLOC', 0x17: 'OUTFORM_MINT',
    0x18: 'OUTFORM_HDR',   0x19: 'OUTFORM_TIMEOUT',
}
MAX_FAULT_CODE = max(_FAULT_NAMES)   # 0x19 — highest defined FaultType


def _fault_name(code):
    return _FAULT_NAMES.get(code, f'FAULT_{code}')


# ── GT word decoder ───────────────────────────────────────────────────────────
# GT bit layout (hw_types.py):
#   bits[6:0]   = slot_id
#   bits[26:25] = gt_type  (00=NULL  01=Inform  10=Outform  11=Abstract)
#   bit[27]     = dom      (0=Turing  1=Church)
#   bits[30:28] = perm[2:0]
#     Turing (dom=0): bit0=R  bit1=W  bit2=X
#     Church (dom=1): bit0=L  bit1=S  bit2=E
_GT_SLOT_NAMES = {0: 'Thread', 1: 'Boot.NS', 7: 'WukongCallHome'}
_GT_TYPE_SUFFIX = {2: 'Outform ', 3: 'Abstract '}

# ev_types whose packet payload IS the GT (even 0 = null-GT is informative).
# Events NOT in this set (RESULT=0x00, CHANGE_PUSH=0x03, CALL_PUSH=0x08,
# RETURN_POP=0x09) always have hardware-forced payload=0 with no GT meaning.
_EV_HAS_GT_PAYLOAD = frozenset({
    0x01, 0x02,        # LOAD_SHADOW, LOAD_NEW
    0x04, 0x05,        # CHANGE_CR12, CHANGE_CR5
    0x06, 0x07,        # CALL_CR6, CALL_CR14
    0x0A, 0x0B,        # RETURN_CR6, RETURN_CR14
})


def _decode_gt_label(gt_word):
    """Return a short human-readable annotation for a GT word.

    Returns None only when gt_word is None/undefined.
    0x00000000 returns 'NULL GT' — it is a valid null-GT value, not absence of
    a GT payload (call sites must gate on _EV_HAS_GT_PAYLOAD to decide whether
    to call this at all).

    Examples:
        0x42000007 -> 'WukongCallHome, Turing X-perm'
        0x1A000007 -> 'WukongCallHome, Church L-perm'
        0x02000001 -> 'Boot.NS, Turing no-perm'
        0x00000000 -> 'NULL GT'
    """
    if gt_word is None:
        return None
    gt_type = (gt_word >> 25) & 0x3
    dom     = (gt_word >> 27) & 0x1
    perm    = (gt_word >> 28) & 0x7
    slot    = gt_word & 0x7F
    if gt_type == 0:
        return 'NULL GT'
    type_pfx = _GT_TYPE_SUFFIX.get(gt_type, '')
    slot_str = _GT_SLOT_NAMES.get(slot, f'slot {slot}')
    dom_str  = 'Church' if dom else 'Turing'
    if dom:   # Church: L S E
        parts = (['L'] if perm & 1 else []) + \
                (['S'] if perm & 2 else []) + \
                (['E'] if perm & 4 else [])
    else:     # Turing: R W X
        parts = (['R'] if perm & 1 else []) + \
                (['W'] if perm & 2 else []) + \
                (['X'] if perm & 4 else [])
    perm_str = ('+'.join(parts) + '-perm') if parts else 'no-perm'
    return f'{type_pfx}{slot_str}, {dom_str} {perm_str}'


def decode_trace_packet(pkt):
    """Decode a single 12-byte trace packet into a dict.

    Parameters
    ----------
    pkt : bytes | bytearray
        Exactly 12 bytes starting with TRACE_MAGIC (0xAA).

    Returns
    -------
    dict with keys:
        nia         — retiring instruction NIA (int)
        ev_type     — TRACE_EV_* constant (int)
        payload_gt  — GT word0 from packet bytes 6-9 (int); 0 for push/pop events
        flags       — raw flags byte (int); bits[3:0] = NZCV
        fault_code  — 5-bit fault code (int)
        fault_valid — bool
        bp_hit      — bool

    The decode is purely mechanical: it unpacks bytes 1-11 of the packet.
    All TRACE_EV_* values are forwarded as-is, including CALL sequences:
        TRACE_EV_CALL_CR6  (0x06) — CR6  ← abstraction GT  (payload_gt = new GT word0)
        TRACE_EV_CALL_CR14 (0x07) — CR14 ← code/return GT  (payload_gt = new GT word0)
        TRACE_EV_CALL_PUSH (0x08) — caller frame push        (payload_gt = 0)
    Three consecutive packets with the same NIA covering CALL_CR6, CALL_CR14,
    and CALL_PUSH correspond to one ELOADCALL or XLOADLAMBDA retire.
    """
    if len(pkt) != TRACE_LEN or pkt[0] != TRACE_MAGIC:
        raise ValueError(f'decode_trace_packet: expected {TRACE_LEN}-byte packet '
                         f'starting with 0x{TRACE_MAGIC:02X}, got {bytes(pkt).hex()}')
    nia        = struct.unpack('>I', pkt[1:5])[0]
    ev_type    = pkt[5]
    payload_gt = struct.unpack('>I', pkt[6:10])[0]
    raw11      = pkt[11]
    return {
        'nia':         nia,
        'ev_type':     ev_type,
        'payload_gt':  payload_gt,
        'flags':       pkt[10],
        'fault_code':  raw11 & 0x1F,
        'fault_valid': bool(raw11 & 0x40),
        'bp_hit':      bool(raw11 & 0x80),
    }


# ── Trace frame validation / resync ───────────────────────────────────────────
# The 0xAA magic byte can also appear inside packet payloads (NIA bytes, GT
# bytes).  If the parser loses byte alignment — mid-stream attach, a dropped
# byte on reconnect, or UART noise — it can lock onto a payload 0xAA and emit
# byte-shifted garbage events (e.g. NIA=0x000000AA with GT = a shifted copy of
# the real NIA).  validate_trace_frame() applies plausibility checks so such
# misaligned candidates are rejected and the scanner advances one byte instead.

DMEM_BYTES      = 16384 * 4         # 64 KB DMEM — NIA must be below this
_VALID_EV_TYPES = frozenset(_EV_NAMES)


def validate_trace_frame(pkt):
    """Return True when *pkt* (12 bytes starting 0xAA) is a plausible frame.

    Checks (all must hold):
      • correct length and magic byte
      • NIA word-aligned and within DMEM range (< 64 KB)
      • ev_type is one of the known TRACE_EV_* constants
      • flags byte upper nibble zero (bits[7:4] are always 0 on hardware)
      • fault byte reserved bit[5] zero, fault_code ≤ MAX_FAULT_CODE (0x19,
        highest hw_types.FaultType — keep _FAULT_NAMES in sync with FaultType)
    """
    if len(pkt) != TRACE_LEN or pkt[0] != TRACE_MAGIC:
        return False
    nia = struct.unpack('>I', bytes(pkt[1:5]))[0]
    if nia & 0x3 or nia >= DMEM_BYTES:
        return False
    if pkt[5] not in _VALID_EV_TYPES:
        return False
    if pkt[10] & 0xF0:
        return False
    raw11 = pkt[11]
    if raw11 & 0x20:                       # reserved bit — always 0 on hardware
        return False
    if (raw11 & 0x1F) > MAX_FAULT_CODE:
        return False
    return True


def try_parse_trace_frame(buf, i=0):
    """Attempt to parse a validated trace frame at position *i* of *buf*.

    Returns
    -------
    None
        ``buf[i]`` is not 0xAA, or the candidate frame failed validation.
        The caller should advance ``i`` by one byte and rescan.
    False
        ``buf[i]`` is 0xAA but fewer than 12 bytes are buffered.  The caller
        should wait for more data without advancing ``i``.
    dict
        Decoded frame (see decode_trace_packet) — caller consumes TRACE_LEN.
    """
    if i >= len(buf) or buf[i] != TRACE_MAGIC:
        return None
    if len(buf) - i < TRACE_LEN:
        return False
    pkt = bytes(buf[i:i + TRACE_LEN])
    if not validate_trace_frame(pkt):
        return None
    return decode_trace_packet(pkt)


def validate_boot_sentinel(sentinel, expected_n_init=None):
    """Plausibility check used to *acquire* frame sync from a boot sentinel.

    ``parse_boot_sentinel`` accepts any 0xBB/0xBC byte plus the following
    byte(s) — that is fine once the stream is aligned, but while the bridge
    is still hunting for frame sync (mid-run attach, byte slip), a sentinel
    magic byte inside unaligned trace-packet payload would falsely acquire
    the lock and re-open the console-garbage spray this gate exists to stop.

    Rules (all must hold for the sentinel to be trusted for lock
    acquisition; locked-state sentinel handling is unaffected):
      • when *expected_n_init* is known, the N_INIT byte must match it
      • V2 sentinels must carry a sane TU_VERSION (0x01..0x0F)
      • V1 sentinels with no N_INIT reference are rejected — two arbitrary
        bytes are too weak a signature to trust from an unaligned stream
    """
    if expected_n_init is not None:
        if sentinel['n_init_byte'] != (expected_n_init & 0xFF):
            return False
    if sentinel['magic'] == BOOT_SENTINEL_V2:
        tu = sentinel.get('tu_version')
        if tu is None or not (0x01 <= tu <= 0x0F):
            return False
    elif expected_n_init is None:
        return False
    return True


class StreamSync:
    """Attach-time / mid-run frame-sync state for the bridge main loop.

    When the bridge attaches to a board that is already streaming trace
    packets, the first bytes read land at an arbitrary offset inside a
    packet.  Misaligned payload bytes are mostly printable ASCII, so without
    this gate they get echoed to the terminal and forwarded to the IDE
    console as garbage (``5!%!)!...`` spray).

    The stream is *unlocked* until the first fully-validated trace frame or
    boot sentinel is decoded.  While unlocked, non-magic bytes are counted
    and dropped instead of echoed/forwarded.  A failed 0xAA candidate frame
    (payload byte mistaken for magic — mid-session byte slip) drops the lock
    again so resync happens quietly.  Serial reopen also drops the lock.

    NOTE: no handshake byte is ever sent to acquire sync — in particular
    never 'f' (0x66), which performs a full CM reboot on the board.
    """

    def __init__(self, out=None):
        self.locked = False
        self.discarded = 0          # unaligned bytes dropped while unlocked
        self._out = out if out is not None else print

    def lock(self, source='trace frame'):
        """Mark the stream aligned (a validated frame/sentinel was decoded)."""
        if self.locked:
            return
        self.locked = True
        n = self.discarded
        self.discarded = 0
        self._out(f'[bridge] frame sync acquired ({source}) — '
                  f'discarded {n} unaligned byte(s)')

    def unlock(self, reason='byte slip'):
        """Drop the lock; subsequent non-magic bytes are dropped quietly."""
        if not self.locked:
            return
        self.locked = False
        self._out(f'[bridge] frame sync lost ({reason}) — '
                  f'reacquiring quietly')

    def drop_byte(self):
        """Count one unaligned byte discarded while unlocked."""
        self.discarded += 1

def is_console_plausible(b):
    """Return True when byte *b* is plausible genuine ASCII console output.

    Printable ASCII (0x20..0x7E) plus tab/CR/LF.  Anything else arriving
    while the stream is *locked* is a strong slip signal: if a packet's
    0xAA magic byte itself is dropped by a UART overrun, the shifted bytes
    that follow start with the NIA high bytes (always 0x00 — NIA < 64 KB),
    so gating on this predicate and dropping the lock on the first
    implausible byte suppresses the shifted-byte console leak entirely.
    """
    return 32 <= b < 127 or b in (0x09, 0x0A, 0x0D)
def post_command_ack(ide_base, verify_tls, cmd, ok, error='', cmd_id=None):
    """Report the serial-write result for a dequeued command to the server.

    Delivery of the ack is best-effort; a failure to POST never interrupts
    the bridge loop.
    """
    try:
        requests.post(f'{ide_base}/hardware/wukong/command-ack',
                      json={'cmd': cmd, 'ok': ok, 'error': error,
                            'id': cmd_id},
                      timeout=1, verify=verify_tls)
    except Exception as exc:
        print(f'  [command-ack POST error] {exc}', flush=True)


def execute_board_command(cmd, data, ser, reopen_serial, buf,
                          ide_base, verify_tls):
    """Write a dequeued command ('s','r','h','b','f') to the board's UART.

    Reports success/failure back to the server via POST
    /hardware/wukong/command-ack so a consumed-but-unwritten command is
    never lost silently.  Returns the (possibly reopened) Serial object.

    The server-assigned command id (data['id']) is echoed in the ack so the
    server can attribute the write result to exactly this command, even if
    another command with the same letter has been queued since.
    """
    cmd_id = data.get('id')
    try:
        if cmd == 'b':
            nia_val = int(data.get('nia', 0xFFFFFFFF))
            ser.write(b'b' + struct.pack('>I', nia_val))
        elif cmd == 'f':
            # Reopen the serial port first — JTAG programming silently kills
            # the FTDI connection, so the port may be dead.  Reopening
            # restores it, then 'f' tells the FPGA to re-fire its boot
            # sentinel (FAULT_RST, top priority in hardware).
            ser = reopen_serial()
            buf.clear()
            ser.write(b'f')
        elif cmd in ('s', 'r', 'h'):
            ser.write(cmd.encode('ascii'))
        else:
            post_command_ack(ide_base, verify_tls, cmd, False,
                             f'bridge does not understand command {cmd!r}',
                             cmd_id=cmd_id)
            return ser
        post_command_ack(ide_base, verify_tls, cmd, True, cmd_id=cmd_id)
    except Exception as exc:
        print(f'  [command] serial write FAILED for {cmd!r}: {exc}',
              flush=True)
        post_command_ack(ide_base, verify_tls, cmd, False,
                         f'serial write failed: {exc}', cmd_id=cmd_id)
    return ser


def main():
    if serial is None:
        print("ERROR: pyserial not installed.  Run: pip install pyserial", file=sys.stderr)
        sys.exit(1)
    if requests is None:
        print("ERROR: requests not installed.  Run: pip install requests", file=sys.stderr)
        sys.exit(1)

    parser = argparse.ArgumentParser(description='Wukong UART ↔ IDE bridge')
    parser.add_argument('--port', default='auto', help='Serial port (default: auto-detect /dev/ttyUSB*)')
    parser.add_argument('--baud', type=int, default=57600, help='Baud rate')
    parser.add_argument('--ide', default='http://localhost:5000', help='IDE base URL')
    parser.add_argument('--insecure', action='store_true',
                        help='Skip TLS certificate verification')
    args = parser.parse_args()

    ide_base   = args.ide.rstrip('/')

    # For https:// IDE URLs the common case is a self-signed / lab certificate
    # (e.g. lab.cloomc.org), which floods the terminal with one urllib3
    # InsecureRequestWarning per HTTP request and drowns out the HW trace.
    # Default to skipping verification for https and suppress the per-request
    # warnings, printing a single one-line notice at startup instead.
    verify_tls = not (args.insecure or ide_base.startswith('https://'))
    if not verify_tls:
        try:
            import urllib3
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        except Exception:
            pass

    # ── Port auto-detection ────────────────────────────────────────────────────
    def _find_usb_serial(preferred=None):
        """Return the first available /dev/ttyUSB* path, trying preferred first."""
        import glob
        candidates = sorted(glob.glob('/dev/ttyUSB*'))
        if preferred and preferred in candidates:
            return preferred
        if candidates:
            return candidates[0]
        return preferred or '/dev/ttyUSB0'

    port = args.port
    if port == 'auto':
        port = _find_usb_serial()
        print(f'Wukong bridge: auto-detected {port} @ {args.baud} baud → {ide_base}')
    else:
        import os as _os
        if not _os.path.exists(port):
            alt = _find_usb_serial()
            if alt != port:
                print(f'[bridge] {port} not found — trying {alt} instead')
                port = alt
        print(f'Wukong bridge: {port} @ {args.baud} baud → {ide_base}')
    if not verify_tls:
        print('SSL verification disabled — add a cert to enable')

    # Compute the expected N_INIT from the current boot_rom.py tables once at
    # startup.  Used to validate the N_INIT byte that the board sends after the
    # sentinel magic byte (0xBB for old/stale bitstreams, 0xBC for current ones).
    expected_n_init = _compute_expected_n_init()
    if expected_n_init is None:
        print('WARNING: boot_rom not importable — N_INIT sentinel byte will not be validated',
              file=sys.stderr)
    else:
        print(f'Boot sentinel: expecting N_INIT={expected_n_init} '
              f'(0x{expected_n_init & 0xFF:02X}) from board')

    try:
        ser = serial.Serial(port, args.baud, timeout=0.05)
    except serial.SerialException as e:
        print(f'ERROR opening {port}: {e}', file=sys.stderr)
        sys.exit(1)

    # Attach flush: discard OS-buffered partial stream so we don't start
    # decoding in the middle of a packet the board sent before we attached.
    try:
        ser.reset_input_buffer()
    except Exception:
        pass
    print('[bridge] acquiring frame sync — unaligned bytes will be '
          'discarded until the first valid trace frame or boot sentinel',
          flush=True)
    sync = StreamSync(out=lambda msg: print(msg, flush=True))

    buf          = bytearray()
    last_poll    = 0.0
    resync_skips = 0   # bogus-0xAA candidates skipped by frame validation

    # ── UART ASCII console forwarding ────────────────────────────────────
    # Printable UART bytes (banner text etc.) are line-buffered and POSTed
    # to the IDE so the /fpga page's live event log shows ALL board output,
    # not just decoded trace packets.
    _console_line  = []     # chars of the line currently being assembled
    _console_last  = [0.0]  # time of last char appended (for idle flush)

    def _console_flush(base, vtls):
        if not _console_line:
            return
        text = ''.join(_console_line)
        _console_line.clear()
        if not text.strip():
            return
        try:
            requests.post(f'{base}/hardware/wukong/console',
                          json={'text': text, 'ts': time.time()},
                          timeout=1, verify=vtls)
        except Exception as exc:
            print(f'  [console POST error] {exc}')

    def _reopen_serial():
        """Close and reopen the serial port; return the new Serial object.

        After a USB reconnect the device may be renumbered (e.g. ttyUSB0→ttyUSB1).
        We scan /dev/ttyUSB* on each attempt so the renumbered port is found.
        """
        nonlocal port
        try:
            ser.close()
        except Exception:
            pass
        for attempt in range(15):
            found = _find_usb_serial(port)
            try:
                s = serial.Serial(found, args.baud, timeout=0.05)
                if found != port:
                    print(f'[bridge] USB renumbered: {port} → {found}', flush=True)
                    port = found
                print(f'[bridge] serial port reopened ({port})', flush=True)
                # Attach flush + quiet resync: drop the frame lock and any
                # partial buffer so we re-acquire alignment without spraying
                # misaligned payload bytes as console text.
                try:
                    s.reset_input_buffer()
                except Exception:
                    pass
                sync.unlock('serial reopen')
                del buf[:]
                print('[bridge] acquiring frame sync after reopen', flush=True)
                return s
            except serial.SerialException as exc:
                print(f'[bridge] reopen attempt {attempt+1}/15 failed ({found}): {exc}', flush=True)
                time.sleep(1)
        print(f'[bridge] ERROR: could not reopen serial port after 15 attempts', file=sys.stderr)
        return ser  # return old object; read loop will keep failing gracefully

    try:
        while True:
            try:
                chunk = ser.read(128)
            except (serial.SerialException, OSError) as exc:
                print(f'[bridge] serial read error: {exc} — reopening port', flush=True)
                ser = _reopen_serial()
                buf.clear()
                continue
            if chunk:
                buf.extend(chunk)

            i = 0
            while i < len(buf):
                b = buf[i]

                if b == TRACE_MAGIC:
                    decoded = try_parse_trace_frame(buf, i)
                    if decoded is False:
                        # Magic byte seen but frame not fully buffered yet.
                        break
                    if decoded is None:
                        # Candidate frame failed plausibility checks — the 0xAA
                        # is a payload byte from a misaligned stream (mid-stream
                        # attach, dropped byte, or noise).  Advance one byte and
                        # rescan instead of emitting a garbage event.
                        resync_skips += 1
                        if resync_skips <= 3 or resync_skips % 100 == 0:
                            print(f'[bridge] trace resync: skipped bogus 0xAA '
                                  f'candidate ({resync_skips} total)', flush=True)
                        # A payload 0xAA mistaken for magic means we may have
                        # slipped alignment mid-session — drop the lock so the
                        # following bytes are discarded quietly instead of
                        # sprayed as console text.
                        sync.unlock('bogus 0xAA candidate')
                        sync.drop_byte()
                        i += 1
                        continue
                    sync.lock('trace frame')
                    # Flush any pending ASCII first so console text and trace
                    # packets appear in the IDE event log in arrival order.
                    _console_flush(ide_base, verify_tls)
                    decoded['ts'] = time.time()
                    location = _trace_location(decoded['nia'])
                    if location:
                        decoded.update(location)
                    decoded['gt_label'] = (
                        _decode_gt_label(decoded.get('payload_gt', 0)) or ''
                        if decoded.get('ev_type') in _EV_HAS_GT_PAYLOAD else ''
                    )

                    try:
                        requests.post(
                            f'{ide_base}/hardware/wukong/trace',
                            json=decoded, timeout=1, verify=verify_tls)
                    except Exception as exc:
                        print(f'  [trace POST error] {exc}')

                    ev_type    = decoded['ev_type']
                    payload_gt = decoded['payload_gt']
                    nia        = decoded['nia']
                    flags_byte = decoded['flags']
                    flag_str   = _flags_str(flags_byte)
                    ts_str     = time.strftime('%H:%M:%S', time.localtime())
                    ev_name    = _EV_NAMES.get(ev_type, f'EV_0x{ev_type:02X}')
                    if ev_type in _EV_HAS_GT_PAYLOAD:
                        _gt_label = _decode_gt_label(payload_gt)
                        gt_str    = (f'  GT=0x{payload_gt:08X}' +
                                     (f' ({_gt_label})' if _gt_label else ''))
                    else:
                        gt_str = ''
                    if decoded['fault_valid']:
                        fault_str = f'  FAULT={_fault_name(decoded["fault_code"])}'
                    else:
                        fault_str = ''
                    bp_str = '  [BP HIT]' if decoded['bp_hit'] else ''
                    location = _trace_location(nia)
                    if location:
                        where = f"{location['nia_label']} (NIA=0x{nia:08X})"
                        instruction = f"  {location['disasm']}"
                    else:
                        where = f"NIA=0x{nia:08X}"
                        instruction = "  <instruction unavailable>"
                    print(f'[{ts_str}] HW: {where}{instruction}  {ev_name}{gt_str}'
                          f'  flags={flag_str}{fault_str}{bp_str}')
                    i += TRACE_LEN

                elif b in (BOOT_SENTINEL_V1, BOOT_SENTINEL_V2):
                    # Flush pending ASCII first (arrival-order preservation).
                    _console_flush(ide_base, verify_tls)
                    # Delegate to the shared sentinel parser so the bridge and
                    # the smoke test always interpret the byte stream identically.
                    sentinel = parse_boot_sentinel(buf, i)
                    if sentinel is False:
                        # Magic byte seen but not enough bytes buffered yet.
                        break
                    if not sync.locked:
                        # Unaligned stream: only trust the sentinel to acquire
                        # the lock when its fields validate — sentinel magic
                        # bytes also appear inside trace-packet payloads.
                        if not validate_boot_sentinel(sentinel, expected_n_init):
                            sync.drop_byte()
                            i += 1
                            continue
                        sync.lock('boot sentinel')

                    board_n_init_byte = sentinel['n_init_byte']
                    tu_version        = sentinel['tu_version']   # None for V1
                    build_version     = sentinel.get('build_version')  # None for V1
                    tu_str            = (f'  TU_VERSION=0x{tu_version:02X}'
                                         if tu_version is not None else '')
                    bv_str            = (f'  BUILD=v{build_version}'
                                         if build_version is not None else '')

                    if expected_n_init is not None:
                        expected_byte = expected_n_init & 0xFF
                        if board_n_init_byte == expected_byte:
                            print(f'BOOT: board ready — N_INIT={expected_n_init} '
                                  f'(0x{expected_byte:02X}) matches source  ✓{tu_str}{bv_str}')
                        else:
                            print(f'BOOT WARNING: N_INIT mismatch — '
                                  f'board sent 0x{board_n_init_byte:02X} '
                                  f'but source expects 0x{expected_byte:02X} '
                                  f'(N_INIT={expected_n_init}){tu_str}{bv_str}',
                                  file=sys.stderr)
                            print('  The bitstream was built with a different '
                                  'WUKONG_DEMO_NAMESPACE / WUKONG_DEMO_CLIST.',
                                  file=sys.stderr)
                            print('  Run: python3 hardware/check_dmem_count.py --check',
                                  file=sys.stderr)
                            # Notify the IDE so the mismatch is visible in the
                            # console event log, not just the bridge's stderr.
                            try:
                                requests.post(
                                    f'{ide_base}/hardware/wukong/console',
                                    json={'text': ('⚠ Board bitstream may be stale — '
                                                   'N_INIT mismatch (board sent '
                                                   f'0x{board_n_init_byte:02X}, expected '
                                                   f'0x{expected_byte:02X}). Reflash the '
                                                   'bitstream.'),
                                          'ts': time.time()},
                                    timeout=1, verify=verify_tls)
                            except Exception as exc:
                                print(f'  [console POST error] {exc}')
                    else:
                        print(f'BOOT: board ready — N_INIT byte=0x{board_n_init_byte:02X} '
                              f'(validation skipped: boot_rom not importable){tu_str}{bv_str}')

                    # Send 'h' immediately so the board enters step mode as soon
                    # as the bridge attaches.  This means any fault that fires
                    # during free-run (before the user clicks ▶ HW) will be
                    # visible rather than running past unnoticed.
                    try:
                        ser.write(b'h')
                    except Exception as exc:
                        print(f'  [halt send error] {exc}')

                    if sentinel['stale']:
                        if tu_version is None:
                            # V1 sentinel — TraceUnit FSM predates 3-packet CALL.
                            print('BITSTREAM WARNING: old sentinel (0xBB) — '
                                  'stale TraceUnit FSM detected.',
                                  file=sys.stderr)
                        else:
                            # V2 sentinel but TU_VERSION too low.
                            print(f'BITSTREAM WARNING: TU_VERSION=0x{tu_version:02X} is below '
                                  f'required 0x{TU_VERSION_CALL_3PKT:02X}.',
                                  file=sys.stderr)
                        print('  ELOADCALL and XLOADLAMBDA emit a single RESULT packet instead of',
                              file=sys.stderr)
                        print('  the 3-packet CALL sequence (CALL_CR6 + CALL_CR14 + CALL_PUSH).',
                              file=sys.stderr)
                        print('  CR6 and CR14 state shown in the IDE will be wrong after any',
                              file=sys.stderr)
                        print('  ELOADCALL or XLOADLAMBDA instruction executes.',
                              file=sys.stderr)
                        print('  Rebuild and reflash the bitstream to get the current TraceUnit.',
                              file=sys.stderr)
                        # Notify the IDE so it can show a visible warning banner.
                        post_tu = tu_version if tu_version is not None else 0x01
                        try:
                            requests.post(
                                f'{ide_base}/hardware/wukong/boot-info',
                                json={'stale_tu': True, 'tu_version': post_tu,
                                      'build_version': build_version},
                                timeout=1, verify=verify_tls)
                        except Exception as exc:
                            print(f'  [boot-info POST error] {exc}')
                    else:
                        # Current bitstream — clear any previous stale warning in the IDE.
                        try:
                            requests.post(
                                f'{ide_base}/hardware/wukong/boot-info',
                                json={'stale_tu': False, 'tu_version': tu_version,
                                      'build_version': build_version},
                                timeout=1, verify=verify_tls)
                        except Exception as exc:
                            print(f'  [boot-info POST error] {exc}')

                    i += sentinel['length']

                else:
                    ch = buf[i]
                    if not sync.locked:
                        # Unaligned stream (mid-run attach or byte slip):
                        # count and drop instead of spraying payload bytes
                        # as console text.
                        sync.drop_byte()
                        i += 1
                        continue
                    if not is_console_plausible(ch):
                        # Locked, but this byte cannot be genuine ASCII console
                        # output.  A dropped 0xAA magic byte (UART overrun)
                        # leaves the stream shifted with the lock still held;
                        # the shifted bytes start with NIA high bytes (0x00),
                        # so treat the first implausible byte as a slip: drop
                        # the lock and discard quietly until resync.
                        sync.unlock('implausible console byte — probable slip')
                        sync.drop_byte()
                        i += 1
                        continue
                    print(chr(ch) if 32 <= ch < 128 else '.', end='', flush=True)
                    # Accumulate printable UART bytes into a line buffer so the
                    # IDE's /fpga page can show the raw ASCII output too.
                    if ch in (0x0A, 0x0D):
                        _console_flush(ide_base, verify_tls)
                    elif 32 <= ch < 128:
                        _console_line.append(chr(ch))
                        _console_last[0] = time.time()
                        if len(_console_line) >= 200:   # runaway line safety
                            _console_flush(ide_base, verify_tls)
                    i += 1

            del buf[:i]

            now = time.time()
            # Idle flush: a partial line with no newline (e.g. a banner that
            # ends without \n) is forwarded after 0.5 s of UART silence.
            if _console_line and now - _console_last[0] >= 0.5:
                _console_flush(ide_base, verify_tls)
            if now - last_poll >= 0.05:
                last_poll = now
                try:
                    r = requests.get(
                        f'{ide_base}/hardware/wukong/command',
                        timeout=0.1, verify=verify_tls)
                    if r.status_code == 200:
                        data = r.json() or {}
                        cmd = data.get('cmd')
                        if cmd in ('s', 'r', 'h', 'b', 'f'):
                            ser = execute_board_command(
                                cmd, data, ser, _reopen_serial, buf,
                                ide_base, verify_tls)
                        elif cmd == 'u':
                            try:
                                _leftover = _handle_upload(
                                    data, ser, ide_base, verify_tls)
                                if _leftover:
                                    # Bytes read during the ACK wait that are
                                    # NOT the 0x06 ACK byte (e.g. trace packets
                                    # emitted the moment the board starts
                                    # executing the new image).  Prepend them
                                    # back into the main receive buffer so the
                                    # trace parser sees them on the next loop.
                                    buf[0:0] = _leftover
                            except Exception as _upload_exc:
                                print(f'  [upload] ERROR: unexpected handler '
                                      f'failure: {_upload_exc}', flush=True)
                                try:
                                    requests.post(
                                        f'{ide_base}/hardware/wukong/upload-ack',
                                        json={'ok': False,
                                              'error': f'handler exception: {_upload_exc}'},
                                        timeout=2, verify=verify_tls)
                                except Exception:
                                    pass
                except Exception:
                    pass

    except KeyboardInterrupt:
        print('\nBridge stopped.')
    finally:
        ser.close()


def _handle_upload(data, ser, ide_base, verify_tls):
    """Decode a base64 boot-image payload and write it to the board over UART.

    Protocol sent to the board (framing that the RTL upload FSM expects):
        1. Magic byte 0x75 ('u') — upload start
        2. 4-byte big-endian payload length in bytes
        3. Raw boot-image bytes

    After writing, posts the result to /hardware/wukong/upload-ack so the
    IDE can poll for completion before issuing a step/run command.

    Parameters
    ----------
    data : dict
        Command payload from the server (must contain 'data' key with the
        base64-encoded boot image).
    ser : serial.Serial
        Open serial port connected to the Wukong board.
    ide_base : str
        Base URL of the IDE server (e.g. 'https://...replit.dev').
    verify_tls : bool
        Whether to verify the TLS certificate on IDE requests.
    """
    # Bytes read from the serial port during the ACK wait that are NOT the 0x06
    # ACK byte (e.g. trace packets the board emits as soon as it starts executing
    # the freshly loaded image).  The caller must prepend these back into the
    # main receive buffer so the trace parser can process them normally.
    leftover = bytearray()

    b64_payload = data.get('data', '')
    if not b64_payload:
        print('  [upload] ERROR: empty data payload', flush=True)
        try:
            requests.post(f'{ide_base}/hardware/wukong/upload-ack',
                          json={'ok': False, 'error': 'empty payload'},
                          timeout=2, verify=verify_tls)
        except Exception:
            pass
        return leftover

    try:
        raw = base64.b64decode(b64_payload)
    except Exception as exc:
        print(f'  [upload] ERROR: base64 decode failed: {exc}', flush=True)
        try:
            requests.post(f'{ide_base}/hardware/wukong/upload-ack',
                          json={'ok': False, 'error': f'base64 decode: {exc}'},
                          timeout=2, verify=verify_tls)
        except Exception:
            pass
        return leftover

    # boot-image.bin stores each 32-bit word little-endian (struct.pack('<...I')).
    # The RTL upload FSM assembles the first received byte as the MSByte of each
    # DMEM word (big-endian on the wire).  Byte-swap every complete word so the
    # board reconstructs the same word values the generator wrote.
    n_words = len(raw) // 4
    if n_words > 0:
        raw = (struct.pack(f'>{n_words}I',
                           *struct.unpack(f'<{n_words}I', raw[:n_words * 4]))
               + raw[n_words * 4:])   # trailing partial word (if any) passed as-is

    n_bytes = len(raw)

    # Drain any stale bytes already in the UART RX buffer BEFORE sending the
    # upload frame.  These are pre-upload trace events queued in the hardware
    # FIFO (e.g. from a previous run before the 'u' command was issued).
    # Draining now — before any bytes are sent — guarantees the drain window is
    # clear of any byte we ourselves write.  After the frame is sent, the board
    # is already halted (RTL sets step_mode=1 / step_halted=1 on 'u' reception)
    # so no new trace bytes arrive during the upload or the subsequent ACK wait.
    # This makes the board's 0x06 ACK (UPLOAD_ACK state) unambiguous: the only
    # byte that can arrive between the end of the write and the ACK timeout is
    # the RTL's completion signal.
    _stale = ser.read(ser.in_waiting) if ser.in_waiting else b''
    if _stale:
        print(f'  [upload] drained {len(_stale)} stale RX byte(s) before upload '
              f'frame', flush=True)
        leftover.extend(_stale)

    print(f'  [upload] writing {n_bytes} bytes to UART (LE→BE swapped)…', flush=True)
    try:
        # Frame: magic(1) + length(4 BE) + byte-swapped payload
        # The RTL upload FSM (UPLOAD_LEN / UPLOAD_DATA / UPLOAD_ACK states in
        # wukong_top.py) receives this frame, writes words to DMEM, then sends
        # a single 0x06 ACK byte back via UART TX.
        header = b'\x75' + struct.pack('>I', n_bytes)
        ser.write(header + raw)
        ser.flush()
        print(f'  [upload] write complete ({n_bytes} bytes) — waiting for board ACK…',
              flush=True)
    except Exception as exc:
        print(f'  [upload] ERROR: UART write failed: {exc}', flush=True)
        try:
            requests.post(f'{ide_base}/hardware/wukong/upload-ack',
                          json={'ok': False, 'error': f'UART write: {exc}'},
                          timeout=2, verify=verify_tls)
        except Exception:
            pass
        return leftover

    # Wait for the single unambiguous 0x06 ACK byte.
    # The CM is halted (RTL guarantees step_mode=1 from 'u' reception), so the
    # only byte that can arrive after draining + sending the frame is the board's
    # 0x06 ACK.  Any unexpected bytes are preserved in leftover as a safety net.
    _ACK_TIMEOUT_S = max(10.0, n_bytes * 0.0002)   # ≥10 s, 0.2 ms/byte headroom
    ack_deadline = time.time() + _ACK_TIMEOUT_S
    ack_found = False
    while time.time() < ack_deadline:
        avail = ser.in_waiting
        chunk = ser.read(avail if avail > 0 else 1)
        for idx, b in enumerate(chunk):
            if b == 0x06:
                ack_found = True
                # Bytes after the ACK in the same read are also preserved.
                leftover.extend(chunk[idx + 1:])
                break
            leftover.append(b)
        if ack_found:
            break
        time.sleep(0.005)

    if ack_found:
        print('  [upload] board ACK received — upload successful', flush=True)
        try:
            requests.post(f'{ide_base}/hardware/wukong/upload-ack',
                          json={'ok': True},
                          timeout=2, verify=verify_tls)
        except Exception as exc:
            print(f'  [upload] WARNING: could not POST upload-ack: {exc}', flush=True)
    else:
        errmsg = f'board ACK timeout after {_ACK_TIMEOUT_S:.0f} s'
        print(f'  [upload] ERROR: {errmsg}', flush=True)
        try:
            requests.post(f'{ide_base}/hardware/wukong/upload-ack',
                          json={'ok': False, 'error': errmsg},
                          timeout=2, verify=verify_tls)
        except Exception as exc:
            print(f'  [upload] WARNING: could not POST upload-ack (timeout): {exc}',
                  flush=True)

    return leftover


if __name__ == '__main__':
    main()
