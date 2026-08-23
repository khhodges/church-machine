#!/usr/bin/env python3
"""hardware/wukong_bridge.py — UART bridge: Wukong board ↔ Church Machine IDE.

Usage
-----
    python3 hardware/wukong_bridge.py --ide=https://<your-replit-url>
    python3 hardware/wukong_bridge.py --port=/dev/ttyUSB0 --ide=http://localhost:5000 --insecure
    py hardware/wukong_bridge.py --port=COM3 --ide=https://<your-replit-url>

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
    {cmd: "u", data: "<base64>", reboot: true}
                                → decode board-native image, write 0x75+len(4 BE)+bytes
                                   to UART, reboot through the boot ladder, then POST result
                                   to /hardware/wukong/upload-ack

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
import uuid

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

# Complete architectural stop-state snapshot.  This is deliberately a
# different magic byte from TRACE_MAGIC so old bridges/IDEs can continue to
# consume the compact event stream.
SNAPSHOT_MAGIC   = 0xAC
SNAPSHOT_VERSION = 1
SNAPSHOT_HEADER_LEN = 6       # magic, version, payload length, sequence
SNAPSHOT_CRC_LEN = 2
SNAPSHOT_PAYLOAD_LEN = 284

# ── Boot trace packet gate ────────────────────────────────────────────────────
# On a cold board start the CM emits a fixed number of trace packets
# immediately after the sentinel (boot-thread CHANGE sequence + boot CALL
# sequence).  The breakdown is:
#   CHANGE.push + CHANGE.CR12 + CHANGE.CR5  →  3 packets  (thread context init)
#   CALL.CR6   + CALL.CR14   + CALL.push   →  3 packets  (boot CALL)
#   RESULT                                 →  1 packet   (SelfTest entry)
#   RESULT                                 →  1 packet   (first SelfTest step)
#                                             ─────────
#                                              8 packets total
#
# Race window: the bridge sends 'r' then 'q' after the sentinel.  If 'q'
# arrives at the hardware before the boot CALL packet has been processed,
# the resulting snapshot captures misleading mid-boot register state
# (e.g. CR6/CR14 not yet updated).  The fix: arm a deferred-'q' gate on
# every sentinel; send 'q' only after BOOT_TRACE_PACKET_COUNT packets
# have been received, or BOOT_Q_TIMEOUT seconds have elapsed (whichever
# comes first).
BOOT_TRACE_PACKET_COUNT = 8    # trace packets expected before 'q' is safe
BOOT_Q_TIMEOUT          = 2.0  # seconds; timeout fallback for slow boards

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
        from hardware.boot_rom import (
            WUKONG_DEMO_NAMESPACE, WUKONG_DEMO_CLIST, WUKONG_SELFTEST_WORDS,
            WUKONG_SELFTEST_BASE_WORD, WUKONG_WCH_BASE_WORD, WUKONG_WCH_CLIST,
            WUKONG_WCH_CLIST_WORD, WUKONG_NUC_PROGRAM, WUKONG_THREAD_BASE_WORD,
            WUKONG_THREAD_HEADER, WUKONG_THREAD_STO_WORD, WUKONG_THREAD_STO_INIT,
            WUKONG_THREAD_CAPS0_WORD, WUKONG_THREAD_CAPS12_WORD,
            wukong_wch_header,
        )
        from hardware.hw_types import GT_TYPE_INFORM, PERM_MASK_S, make_gt
    except (ImportError, OSError, struct.error):
        return None

    dmem_init = list(WUKONG_DEMO_NAMESPACE)
    while len(dmem_init) < 256:
        dmem_init.append(0)
    dmem_init += list(WUKONG_DEMO_CLIST)
    while len(dmem_init) < 16384:
        dmem_init.append(0)
    for _i, _v in enumerate(WUKONG_SELFTEST_WORDS):
        dmem_init[WUKONG_SELFTEST_BASE_WORD + _i] = _v
    for _i, _v in enumerate(
        [wukong_wch_header(len(WUKONG_NUC_PROGRAM))] + list(WUKONG_NUC_PROGRAM)
    ):
        dmem_init[WUKONG_WCH_BASE_WORD + _i] = _v
    for _i, _v in enumerate(WUKONG_WCH_CLIST):
        dmem_init[WUKONG_WCH_CLIST_WORD + _i] = _v
    dmem_init[WUKONG_THREAD_BASE_WORD] = WUKONG_THREAD_HEADER
    dmem_init[WUKONG_THREAD_STO_WORD] = WUKONG_THREAD_STO_INIT
    dmem_init[WUKONG_THREAD_CAPS0_WORD] = 0x4A000006
    dmem_init[WUKONG_THREAD_CAPS12_WORD] = make_gt(
        GT_TYPE_INFORM, PERM_MASK_S, 1, 0
    )
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
_STANDALONE_BOOT_DISASSEMBLY = (
    'LOAD NAMESPACE CD15',
    'LOAD THREAD+HEAP CR12+, CR5',
)
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


def _standalone_boot_disassemble(offset, entry_pet_name='SelfTest'):
    if offset == 0 or offset == 1:
        return _STANDALONE_BOOT_DISASSEMBLY[offset]
    if offset == 2:
        return f'CALL CR[0] {entry_pet_name}'
    return None


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
            'disasm': _standalone_boot_disassemble(offset),
            'source_map': 'reference-bitstream',
        }
    # Factory SelfTest is the resident default; WukongCallHome is the
    # selectable resident program at 0x1200.
    if 0x600 <= nia < 0x600 + 512 * 4 and nia % 4 == 0:
        offset = (nia - 0x600) // 4
        return {
            'pet_name': 'SelfTest',
            'offset': offset,
            'nia_label': f'SelfTest.{offset}',
            'disasm': ('LUMP_HEADER' if offset == 0
                       else 'SelfTest resident instruction'),
            'source_map': 'reference-bitstream',
        }
    if 0x1200 <= nia < 0x1200 + (len(_STANDALONE_WUKONG_WORDS) + 1) * 4 and nia % 4 == 0:
        offset = (nia - 0x1200) // 4
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
    0x18: 'OUTFORM_HDR',   0x19: 'OUTFORM_TIMEOUT', 0x1A: 'OUTFORM_UNAUTH',
    0x1B: 'IMMUTABLE_SELF_CAP', 0x1C: 'STRUCTURAL_REG',
}
MAX_FAULT_CODE = max(_FAULT_NAMES)   # highest defined FaultType


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

# ev_types whose payload carries the new GT value for a *known* CR register.
# Used to maintain the rolling CR GT cache for hardware fault snapshots.
# LOAD_NEW (0x02) is excluded because the destination CR is not encoded in the
# ev_type — it would require instruction decoding to identify the target CR.
_EV_TO_CR = {
    TRACE_EV_CHANGE_CR5:  5,
    TRACE_EV_CALL_CR6:    6,
    TRACE_EV_CHANGE_CR12: 12,
    TRACE_EV_CALL_CR14:   14,
    TRACE_EV_RETURN_CR6:  6,
    TRACE_EV_RETURN_CR14: 14,
}


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


def _is_turing_only_result(decoded):
    """Return True for bare Turing RESULT packets that --church-only suppresses.

    A packet is a "bare Turing result" when all three conditions hold:
      1. ev_type == TRACE_EV_RESULT  (not a CALL/RETURN sub-packet)
      2. fault_valid is False        (no fault — must always be visible)
      3. payload_gt == 0             (no GT payload — LOAD/CHANGE carry one)

    ADD, SUB, CMP, BRANCH, and similar arithmetic/control-flow instructions
    all satisfy this predicate; Church-level CALL, RETURN, LOAD, and CHANGE
    instructions do not (they either carry a non-zero GT or emit non-RESULT
    ev_types).
    """
    return (decoded['ev_type'] == TRACE_EV_RESULT
            and not decoded['fault_valid']
            and not decoded['payload_gt'])


def _crc16_ccitt(data, crc=0xFFFF):
    """CRC-16-CCITT used by the complete architectural snapshot frame."""
    for byte in data:
        crc ^= (byte & 0xFF) << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return crc


def decode_snapshot_frame(frame):
    """Decode and integrity-check one complete architectural snapshot frame.

    Wire format:
      AC version payload_len_hi payload_len_lo seq_hi seq_lo
      payload[284] crc_hi crc_lo

    Payload is:
      reason, flags, m_flag, reserved,
      live nia/sto/thread_base/stored_cr12_gt/packed_pc/stored_mflag,
      CR0..CR15 × 3 words, DR0..DR15.
    """
    if len(frame) < SNAPSHOT_HEADER_LEN + SNAPSHOT_CRC_LEN:
        raise ValueError('snapshot frame is truncated')
    if frame[0] != SNAPSHOT_MAGIC:
        raise ValueError('snapshot frame has bad magic')
    if frame[1] != SNAPSHOT_VERSION:
        raise ValueError(f'unsupported snapshot version {frame[1]}')
    payload_len = struct.unpack('>H', bytes(frame[2:4]))[0]
    expected_len = SNAPSHOT_HEADER_LEN + payload_len + SNAPSHOT_CRC_LEN
    if payload_len != SNAPSHOT_PAYLOAD_LEN or len(frame) != expected_len:
        raise ValueError(f'snapshot length mismatch: payload={payload_len}, frame={len(frame)}')
    received_crc = struct.unpack('>H', bytes(frame[-2:]))[0]
    calculated_crc = _crc16_ccitt(bytes(frame[:-2]))
    if received_crc != calculated_crc:
        raise ValueError(
            f'snapshot CRC mismatch: got 0x{received_crc:04X}, '
            f'expected 0x{calculated_crc:04X}')

    payload = bytes(frame[SNAPSHOT_HEADER_LEN:-2])
    reason, flags, m_flag, _reserved = payload[:4]
    words = [
        struct.unpack('>I', payload[offset:offset + 4])[0]
        for offset in range(4, 28, 4)
    ]
    cr_start = 28
    cr_words = [
        list(struct.unpack('>III', payload[cr_start + i * 12:cr_start + (i + 1) * 12]))
        for i in range(16)
    ]
    dr_start = cr_start + 16 * 12
    dr_words = list(struct.unpack('>16I', payload[dr_start:dr_start + 64]))
    return {
        'snapshot': True,
        'version': frame[1],
        'payload_len': payload_len,
        'seq': struct.unpack('>H', bytes(frame[4:6]))[0],
        'reason': reason,
        'flags': flags & 0x0F,
        'm_flag': bool(m_flag & 1),
        'nia': words[0],
        'sto': words[1],
        'thread_base': words[2],
        'stored_cr12_gt': words[3],
        'stored_packed_pc': words[4],
        'stored_mflag': words[5],
        'cr': cr_words,
        'dr': dr_words,
        'crc16': received_crc,
    }


def try_parse_snapshot_frame(buf, i=0):
    """Return decoded snapshot, False for incomplete, None for invalid."""
    if i >= len(buf) or buf[i] != SNAPSHOT_MAGIC:
        return None
    if len(buf) - i < SNAPSHOT_HEADER_LEN:
        return False
    payload_len = struct.unpack('>H', bytes(buf[i + 2:i + 4]))[0]
    total_len = SNAPSHOT_HEADER_LEN + payload_len + SNAPSHOT_CRC_LEN
    if payload_len != SNAPSHOT_PAYLOAD_LEN:
        return None
    if len(buf) - i < total_len:
        return False
    try:
        return decode_snapshot_frame(bytes(buf[i:i + total_len]))
    except ValueError:
        return None


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
      • fault byte reserved bit[5] zero, fault_code ≤ MAX_FAULT_CODE,
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
        self._ascii_run = []        # consecutive plausible bytes seen unlocked
        self._out = out if out is not None else print

    def lock(self, source='trace frame'):
        """Mark the stream aligned (a validated frame/sentinel was decoded)."""
        self._ascii_run = []
        if self.locked:
            return
        self.locked = True
        n = self.discarded
        self.discarded = 0
        self._out(f'[bridge] frame sync acquired ({source}) — '
                  f'discarded {n} unaligned byte(s)')

    def unlock(self, reason='byte slip'):
        """Drop the lock; subsequent non-magic bytes are dropped quietly."""
        self._ascii_run = []
        if not self.locked:
            return
        self.locked = False
        self._out(f'[bridge] frame sync lost ({reason}) — '
                  f'reacquiring quietly')

    def drop_byte(self):
        """Count one unaligned byte discarded while unlocked.

        Also resets the ASCII re-lock run: this is called for failed 0xAA
        candidates and invalid sentinels, both strong signs the surrounding
        bytes are shifted packet payload, not genuine console text.
        """
        self.discarded += 1
        self._ascii_run = []

    def note_unlocked_byte(self, b):
        """Feed one non-magic byte seen while *unlocked*; maybe re-lock.

        Genuine firmware output can legitimately contain a non-ASCII byte
        (e.g. UTF-8 box-drawing characters in a banner).  That byte trips
        the implausible-console-byte slip heuristic and drops the lock; on
        an idle board no trace frame or boot sentinel may arrive for a long
        time, so without this path the console would stay muted forever.

        A sustained run of CONSOLE_RELOCK_RUN consecutive plausible ASCII
        bytes is extremely unlikely in shifted packet payload (NIA high
        bytes are 0x00, GT words are byte-sparse), so it re-acquires the
        lock.  Returns the list of buffered run bytes to emit as console
        output when the lock is re-acquired, else an empty list.
        """
        if is_console_plausible(b):
            self._ascii_run.append(b)
            if len(self._ascii_run) >= CONSOLE_RELOCK_RUN:
                run = self._ascii_run
                self._ascii_run = []
                self.lock('sustained ASCII run')
                return run
        else:
            # Implausible byte breaks the run; count it plus the (now
            # discarded) partial run.
            self.discarded += len(self._ascii_run) + 1
            self._ascii_run = []
        return []


class FaultRecovery:
    """Gate one authorized recovery on a complete hardware-fault snapshot.

    Trace packets identify a fault but contain only partial register state. The
    board emits a complete ``0xAC`` stop snapshot immediately afterwards. Keep
    it halted until that snapshot is accepted, then send the dedicated ``g``
    authorization. The RTL accepts it only after a reason-2 snapshot has fully
    drained, and then reboots with a fresh sentinel. Explicit snapshots use
    reason 3 and never satisfy this gate.
    """

    FAULT_SNAPSHOT_REASON = 2

    def __init__(self):
        self.awaiting_snapshot = False
        self.reboot_sent = False

    def note_trace(self, trace, trace_seq, server_boot_id):
        """Replace any pending correlation with this fault trace attempt."""
        self.clear_pending()
        if (trace.get('fault_valid') and isinstance(trace_seq, int) and
                trace_seq > 0 and isinstance(server_boot_id, str) and server_boot_id):
            self.awaiting_snapshot = True
            self.trace_seq = trace_seq
            self.server_boot_id = server_boot_id

    def clear_pending(self):
        """Discard a correlation that cannot safely authorize a reboot."""
        self.awaiting_snapshot = False
        self.trace_seq = None
        self.server_boot_id = None

    def should_reboot_after_snapshot(self, snapshot, accepted):
        return bool(
            accepted and self.awaiting_snapshot and not self.reboot_sent and
            int(snapshot.get('reason', 0)) == self.FAULT_SNAPSHOT_REASON
        )

    def mark_reboot_sent(self):
        self.reboot_sent = True
        self.clear_pending()

    def note_boot_sentinel(self):
        """A completed Boot.0 entry allows a later fault to recover once."""
        self.clear_pending()
        self.reboot_sent = False

    def snapshot_payload(self, snapshot):
        """Attach the exact fault event and server generation for correlation."""
        payload = dict(snapshot)
        if (self.awaiting_snapshot and getattr(self, 'trace_seq', None) and
                getattr(self, 'server_boot_id', None)):
            payload['fault_trace_seq'] = self.trace_seq
            payload['fault_boot_id'] = self.server_boot_id
        return payload


def _post_wukong_snapshot(ide_base, decoded, verify_tls):
    """POST a decoded snapshot and confirm it became the durable Last Fault."""
    try:
        response = requests.post(
            f'{ide_base}/hardware/wukong/snapshot',
            json=decoded, timeout=1, verify=verify_tls)
        if not 200 <= response.status_code < 300:
            return False
        return bool(response.json().get('promoted', False))
    except Exception as exc:
        print(f'  [snapshot POST error] {exc}', flush=True)
        return False


def _authorize_fault_recovery(ser):
    """Authorize recovery only after the complete fault snapshot is safe."""
    try:
        ser.write(b'g')
        ser.flush()
        return True
    except Exception as exc:
        print(f'  [fault recovery] authorization send error: {exc}', flush=True)
        return False


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


# Consecutive plausible ASCII bytes required to re-acquire the frame lock
# while unlocked (see StreamSync.note_unlocked_byte).  Shifted trace-packet
# payload never sustains a run this long (NIA high bytes are always 0x00),
# but a genuine text banner reaches it within a dozen characters.
CONSOLE_RELOCK_RUN = 8


def try_parse_utf8_sequence(buf, i):
    """Attempt to parse a valid multi-byte UTF-8 sequence at position *i*.

    Firmware banners legitimately contain multi-byte UTF-8 (box-drawing
    characters etc.).  While the stream is locked, such bytes should be
    decoded and forwarded as console output rather than treated as a byte
    slip.  Truly implausible bytes (0x00, stray continuation bytes, shifted
    packet payload) are not valid UTF-8 lead sequences and still trigger the
    slip heuristic.

    Returns
    -------
    None
        ``buf[i]`` is not a valid UTF-8 lead byte, or the bytes that follow
        do not form a valid UTF-8 sequence.  Caller should treat it as an
        implausible (slip) byte.
    False
        ``buf[i]`` is a valid lead byte but the buffer does not yet hold the
        full sequence.  Caller should wait for more data without advancing.
    (length, text)
        A valid sequence of *length* bytes decoding to *text* (str).
    """
    b0 = buf[i]
    if 0xC2 <= b0 <= 0xDF:
        n = 2
    elif 0xE0 <= b0 <= 0xEF:
        n = 3
    elif 0xF0 <= b0 <= 0xF4:
        n = 4
    else:
        return None
    if len(buf) - i < n:
        return False
    seq = bytes(buf[i:i + n])
    try:
        text = seq.decode('utf-8')
    except UnicodeDecodeError:
        return None
    return (n, text)


def post_command_ack(ide_base, verify_tls, cmd, ok, error='', cmd_id=None,
                      session_id=None):
    """Report the serial-write result for a dequeued command to the server.

    Delivery of the ack is best-effort; a failure to POST never interrupts
    the bridge loop.
    """
    try:
        payload = {'cmd': cmd, 'ok': ok, 'error': error, 'id': cmd_id}
        if session_id:
            payload['session_id'] = session_id
        requests.post(f'{ide_base}/hardware/wukong/command-ack',
                      json=payload,
                      timeout=1, verify=verify_tls)
    except Exception as exc:
        print(f'  [command-ack POST error] {exc}', flush=True)


def execute_board_command(cmd, data, ser, reopen_serial, buf,
                          ide_base, verify_tls, session_id=None):
    """Write a dequeued command ('s','r','h','q','b','f') to the board's UART.

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
            # Server normalizes nia to an int, but be defensive: accept
            # decimal/hex strings too, and NEVER coerce a parse failure to
            # 0xFFFFFFFF (that would silently CLEAR breakpoints in RTL).
            raw_nia = data.get('nia', 0xFFFFFFFF)
            try:
                nia_val = raw_nia if isinstance(raw_nia, int) \
                    else int(str(raw_nia).strip(), 0)
            except ValueError:
                try:
                    nia_val = int(str(raw_nia).strip(), 16)
                except ValueError:
                    post_command_ack(ide_base, verify_tls, cmd, False,
                                     f'unparseable breakpoint nia {raw_nia!r}',
                    cmd_id=cmd_id, session_id=session_id)
                    return ser
            if not (0 <= nia_val <= 0xFFFFFFFF):
                post_command_ack(ide_base, verify_tls, cmd, False,
                                 f'breakpoint nia out of range: {nia_val}',
                                 cmd_id=cmd_id, session_id=session_id)
                return ser
            ser.write(b'b' + struct.pack('>I', nia_val))
        elif cmd == 'f':
            # Reopen the serial port first — JTAG programming silently kills
            # the FTDI connection, so the port may be dead.  Reopening
            # restores it, then 'f' tells the FPGA to re-fire its boot
            # sentinel (FAULT_RST, top priority in hardware).
            ser = reopen_serial()
            buf.clear()
            ser.write(b'f')
        elif cmd in ('s', 'r', 'h', 'q'):
            ser.write(cmd.encode('ascii'))
        else:
            post_command_ack(ide_base, verify_tls, cmd, False,
                             f'bridge does not understand command {cmd!r}',
                             cmd_id=cmd_id, session_id=session_id)
            return ser
        post_command_ack(ide_base, verify_tls, cmd, True, cmd_id=cmd_id,
                         session_id=session_id)
    except Exception as exc:
        print(f'  [command] serial write FAILED for {cmd!r}: {exc}',
              flush=True)
        post_command_ack(ide_base, verify_tls, cmd, False,
                         f'serial write failed: {exc}', cmd_id=cmd_id,
                         session_id=session_id)
    return ser


def _available_serial_ports():
    """Return serial device names visible to pyserial on this host.

    ``/dev/ttyUSB*`` is not available on Windows, where the same USB-UART
    adapter is exposed as ``COM3``, ``COM4``, etc.  pyserial already provides
    the portable enumeration API, so the bridge should use it on both
    platforms instead of assuming a POSIX device path.
    """
    try:
        from serial.tools import list_ports
        return sorted(
            {str(info.device) for info in list_ports.comports()
             if getattr(info, 'device', None)},
            key=lambda device: device.lower(),
        )
    except Exception:
        # Keep explicit --port operation usable even if enumeration is not
        # available in a minimal pyserial installation.
        return []


def _find_serial_port(preferred=None):
    """Return *preferred* when present, otherwise the first visible port.

    The fallback is only used to produce a useful SerialException when no
    device is connected.  On Windows, COM3 is a conventional error hint; it
    is not claimed to exist and is never opened in preference to an
    enumerated port.
    """
    candidates = _available_serial_ports()
    if preferred and preferred in candidates:
        return preferred
    if candidates:
        return candidates[0]
    if preferred:
        return preferred
    return 'COM3' if os.name == 'nt' else '/dev/ttyUSB0'


def main():
    if serial is None:
        print("ERROR: pyserial not installed.  Run: pip install pyserial", file=sys.stderr)
        sys.exit(1)
    if requests is None:
        print("ERROR: requests not installed.  Run: pip install requests", file=sys.stderr)
        sys.exit(1)

    parser = argparse.ArgumentParser(description='Wukong UART ↔ IDE bridge')
    parser.add_argument('--port', default='auto',
                        help='Serial port (default: auto-detect; COMx on Windows, '
                             '/dev/ttyUSB* on Linux)')
    parser.add_argument('--baud', type=int, default=57600, help='Baud rate')
    parser.add_argument('--ide', default='http://localhost:5000', help='IDE base URL')
    parser.add_argument('--insecure', action='store_true',
                        help='Skip TLS certificate verification')
    parser.add_argument('--church-only', action='store_true',
                        help='Suppress bare Turing RESULT packets (no fault, no GT '
                             'payload).  CALL/RETURN sequences and any faulting '
                             'instruction always pass through.  Dramatically reduces '
                             'trace volume for programs like SelfTest that execute '
                             'many arithmetic steps between Church-level operations.')
    args = parser.parse_args()

    ide_base    = args.ide.rstrip('/')
    church_only = args.church_only

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
    port = args.port
    if port == 'auto':
        port = _find_serial_port()
        print(f'Wukong bridge: auto-detected {port} @ {args.baud} baud → {ide_base}')
    else:
        # os.path.exists('COM3') is not a reliable Windows serial-port
        # availability check. Ask pyserial instead, while still honoring an
        # explicitly supplied port when enumeration is unavailable.
        if port not in _available_serial_ports():
            alt = _find_serial_port()
            if alt != port:
                print(f'[bridge] {port} not found — trying {alt} instead')
                port = alt
        print(f'Wukong bridge: {port} @ {args.baud} baud → {ide_base}')
    if not verify_tls:
        print('SSL verification disabled — add a cert to enable')
    if church_only:
        print('[trace] church-only filter enabled — bare Turing RESULTs suppressed')

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
    session_id = uuid.uuid4().hex
    bridge_state = 'connected'
    last_read_ts = None
    last_write_ts = None

    def _bridge_status(event='heartbeat', state=None, reason='',
                       reconnect_attempt=0):
        """Best-effort health publication; never blocks the UART loop."""
        payload = {
            'session_id': session_id, 'serial_port': port,
            'event': event, 'state': state or bridge_state, 'reason': reason,
            'reconnect_attempt': reconnect_attempt,
            'last_read_ts': last_read_ts, 'last_write_ts': last_write_ts,
        }
        try:
            requests.post(f'{ide_base}/hardware/wukong/bridge-status',
                          json=payload, timeout=0.5, verify=verify_tls)
        except Exception as exc:
            print(f'[bridge] status POST failed: {exc}', flush=True)

    _bridge_status('session_started', 'connected')

    buf          = bytearray()
    last_poll    = 0.0
    resync_skips = 0   # bogus-0xAA candidates skipped by frame validation
    # Rolling cache of the most-recently-seen GT word0 for each CR register,
    # keyed by CR index.  Updated on every ev_type that unambiguously carries a
    # known CR's new GT value (CALL_CR6, CALL_CR14, RETURN_CR6, RETURN_CR14,
    # CHANGE_CR12, CHANGE_CR5).  Included in fault snapshot POSTs so the IDE's
    # Last Fault panel shows at least the call-path CRs rather than all-zero rows.
    _cr_gt_cache = {}   # {cr_index: gt_word0}
    # Fault recovery is deliberately bridge-owned: this process is the sole
    # serial writer and can prove that the board's complete stop snapshot was
    # accepted before it asks the RTL to re-enter the boot ladder.
    fault_recovery = FaultRecovery()

    # Deferred 'q' (snapshot) gate — set on each boot sentinel and cleared
    # once BOOT_TRACE_PACKET_COUNT trace packets have been received or
    # BOOT_Q_TIMEOUT seconds have elapsed.  Prevents the snapshot from racing
    # with in-flight boot trace packets on a cold board start (see the
    # BOOT_TRACE_PACKET_COUNT constant block above for the full race analysis).
    _boot_q_pending   = False
    _boot_q_remaining = 0
    _boot_q_deadline  = 0.0

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
            _bridge_status('reconnect_attempt', 'reconnecting',
                           'waiting for serial port', attempt + 1)
            found = _find_serial_port(port)
            try:
                s = serial.Serial(found, args.baud, timeout=0.05)
                if found != port:
                    print(f'[bridge] USB renumbered: {port} → {found}', flush=True)
                    port = found
                print(f'[bridge] serial port reopened ({port})', flush=True)
                _bridge_status('reconnected', 'connected',
                               f'serial port available: {port}')
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
        _bridge_status('reconnect_failed', 'serial_error',
                       'could not reopen serial port after 15 attempts', 15)
        return ser  # return old object; read loop will keep failing gracefully

    try:
        while True:
            try:
                chunk = ser.read(128)
                if chunk:
                    last_read_ts = time.time()
            except (serial.SerialException, OSError) as exc:
                print(f'[bridge] serial read error: {exc} — reopening port', flush=True)
                bridge_state = 'serial_error'
                _bridge_status('serial_read_error', bridge_state, str(exc))
                ser = _reopen_serial()
                buf.clear()
                continue
            if chunk:
                buf.extend(chunk)

            i = 0
            while i < len(buf):
                b = buf[i]

                if b == SNAPSHOT_MAGIC:
                    decoded = try_parse_snapshot_frame(buf, i)
                    if decoded is False:
                        break
                    if decoded is None:
                        sync.unlock('invalid snapshot frame')
                        sync.drop_byte()
                        i += 1
                        continue
                    sync.lock('snapshot frame')
                    _console_flush(ide_base, verify_tls)
                    decoded['ts'] = time.time()
                    snapshot_accepted = _post_wukong_snapshot(
                        ide_base, fault_recovery.snapshot_payload(decoded), verify_tls)
                    if fault_recovery.should_reboot_after_snapshot(
                            decoded, snapshot_accepted):
                        if _authorize_fault_recovery(ser):
                            fault_recovery.mark_reboot_sent()
                            print('  [fault recovery] complete fault snapshot '
                                  'stored — authorizing Boot.0 recovery', flush=True)
                        else:
                            fault_recovery.clear_pending()
                    else:
                        # A snapshot is terminal for the preceding stop.  If it
                        # was clean, uncorrelated, or failed promotion, never
                        # let its old trace id authorize a later fault.
                        fault_recovery.clear_pending()
                    i += SNAPSHOT_HEADER_LEN + decoded['payload_len'] + SNAPSHOT_CRC_LEN
                    continue

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
                    # Boot trace packet gate: count down toward the deferred
                    # 'q' snapshot.  Run BEFORE the church-only filter so that
                    # filtered bare-Turing RESULT packets still contribute to
                    # the count — the boot sequence may be entirely composed of
                    # such packets and the gate must fire at the right time
                    # regardless of filtering mode.
                    if _boot_q_pending:
                        _boot_q_remaining -= 1
                        if _boot_q_remaining <= 0:
                            _boot_q_pending = False
                            try:
                                ser.write(b'q')
                                last_write_ts = time.time()
                                print('  [boot] all boot trace packets received'
                                      ' — snapshot requested', flush=True)
                            except Exception as _qe:
                                print(f'  [boot] snapshot send error: {_qe}',
                                      flush=True)
                    # church-only filter: suppress bare Turing RESULT packets
                    # (no fault, no GT payload).  The frame is still consumed
                    # (i advances by TRACE_LEN) but nothing is forwarded to the
                    # IDE and nothing is printed to the terminal.
                    if church_only and _is_turing_only_result(decoded):
                        i += TRACE_LEN
                        continue
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

                    trace_accepted = False
                    trace_seq = None
                    trace_boot_id = None
                    try:
                        response = requests.post(
                            f'{ide_base}/hardware/wukong/trace',
                            json=decoded, timeout=1, verify=verify_tls)
                        trace_accepted = 200 <= response.status_code < 300
                        if trace_accepted:
                            trace_reply = response.json()
                            trace_seq = int(trace_reply.get('seq', 0))
                            trace_boot_id = trace_reply.get('boot_id')
                            trace_accepted = (
                                trace_seq > 0 and isinstance(trace_boot_id, str) and
                                bool(trace_boot_id))
                        if not trace_accepted:
                            print(f'  [trace POST rejected or unsequenced] HTTP '
                                  f'{response.status_code}', flush=True)
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

                    # Update rolling CR GT cache from packets that unambiguously
                    # carry a known CR's new GT value.  Done after the trace POST
                    # so the packet is already delivered before we mutate state,
                    # but before the fault check so a fault in the same packet
                    # captures the register update that caused it.
                    _cr_idx = _EV_TO_CR.get(ev_type)
                    if _cr_idx is not None:
                        _cr_gt_cache[_cr_idx] = payload_gt

                    if decoded['fault_valid']:
                        # The server correlates a reason-2 snapshot with the
                        # latest accepted fault trace.  If that trace did not
                        # reach it, leave the physical board halted instead of
                        # rebooting into Boot.0 with a stale fault record.
                        fault_recovery.note_trace(
                            decoded, trace_seq, trace_boot_id)
                        fault_str = f'  FAULT={_fault_name(decoded["fault_code"])}'
                        # Post a fault snapshot to the IDE so the Last Fault panel
                        # appears even when the hardware resets before the user polls.
                        # Include cached GT word0 values for all CRs seen so far in
                        # this session (word1/word2 are not carried by trace packets
                        # and are zeroed).  The IDE panel shows these as partial
                        # register state rather than all-zero rows.
                        try:
                            _cr_rows = [[_cr_gt_cache.get(i, 0), 0, 0]
                                        for i in range(16)]
                            _fault_snap = {
                                'fault_code':    decoded['fault_code'],
                                'fault_message': _fault_name(decoded['fault_code']),
                                'nia':           decoded['nia'],
                                'pc':            decoded['nia'],
                                'flags':         decoded.get('flags', 0),
                                'call_depth':    0,
                                'led_bits':      0,
                                'abstraction_label': str(decoded.get('gt_label', '') or ''),
                                'abstraction_slot': None,
                                'source':        'hardware',
                                # The compact trace packet cannot carry all
                                # CR/DR words.  The reason-2 AC snapshot that
                                # follows is promoted by the server and must
                                # remain authoritative if this partial POST
                                # arrives late from another browser client.
                                'snapshot_complete': False,
                                'cr':            _cr_rows,
                            }
                            _fault_snap.update({k: decoded[k] for k in
                                ('pet_name', 'nia_label') if k in decoded})
                            requests.post(
                                f'{ide_base}/api/fault-snapshot',
                                json=_fault_snap, timeout=1, verify=verify_tls)
                        except Exception as _fse:
                            print(f'  [fault-snapshot POST error] {_fse}')
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
                    # A new boot sentinel means the previous recovery finished;
                    # permit exactly one automatic recovery for a later fault.
                    fault_recovery.note_boot_sentinel()
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

                    # Send 'r' so the CM keeps running freely after the bridge
                    # attaches.  The hardware fault_halt mechanism (reason=2)
                    # will pause the CM automatically on any actual fault retire,
                    # so an unconditional 'h' here is no longer needed.
                    #
                    # 'q' (snapshot request) is NOT sent immediately here.
                    # On a cold board start the CM emits BOOT_TRACE_PACKET_COUNT
                    # trace packets right after the sentinel (boot-thread CHANGE +
                    # boot CALL sequence).  Sending 'q' back-to-back with 'r'
                    # races with those packets: 'q' can arrive at the hardware
                    # before the boot CALL has been processed, so the snapshot
                    # captures partial mid-boot register state (CR6/CR14 not yet
                    # updated) rather than the final settled boot state.
                    #
                    # Mitigation: arm the deferred-'q' gate here.  The main
                    # receive loop sends 'q' after BOOT_TRACE_PACKET_COUNT
                    # trace packets have been observed — or after BOOT_Q_TIMEOUT
                    # seconds — whichever comes first.  This guarantees the
                    # snapshot always reflects post-boot register state.
                    try:
                        ser.write(b'r')
                        last_write_ts = time.time()
                        _bridge_status('automatic_run_after_sentinel', 'connected',
                                       'intentional run after boot sentinel')
                        _boot_q_pending   = True
                        _boot_q_remaining = BOOT_TRACE_PACKET_COUNT
                        _boot_q_deadline  = time.time() + BOOT_Q_TIMEOUT
                        print(f'  [boot] deferring snapshot until '
                              f'{BOOT_TRACE_PACKET_COUNT} boot trace packets '
                              f'received (timeout={BOOT_Q_TIMEOUT:.1f}s)',
                              flush=True)
                    except Exception as exc:
                        print(f'  [run send error] {exc}')
                        _bridge_status('automatic_run_failed', 'serial_error', str(exc))

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
                                      'build_version': build_version,
                                      'session_id': session_id},
                                timeout=1, verify=verify_tls)
                        except Exception as exc:
                            print(f'  [boot-info POST error] {exc}')
                    else:
                        # Current bitstream — clear any previous stale warning in the IDE.
                        try:
                            requests.post(
                                f'{ide_base}/hardware/wukong/boot-info',
                                json={'stale_tu': False, 'tu_version': tu_version,
                                      'build_version': build_version,
                                      'session_id': session_id},
                                timeout=1, verify=verify_tls)
                        except Exception as exc:
                            print(f'  [boot-info POST error] {exc}')

                    i += sentinel['length']

                else:
                    ch = buf[i]
                    if not sync.locked:
                        # Unaligned stream (mid-run attach or byte slip):
                        # count and drop instead of spraying payload bytes
                        # as console text.  A sustained run of plausible
                        # ASCII re-acquires the lock (genuine banner text
                        # after a UTF-8 byte tripped the slip heuristic);
                        # the buffered run is then emitted so the banner
                        # is not clipped.
                        for rb in sync.note_unlocked_byte(ch):
                            print(chr(rb) if 32 <= rb < 128 else '.',
                                  end='', flush=True)
                            if rb in (0x0A, 0x0D):
                                _console_flush(ide_base, verify_tls)
                            elif 32 <= rb < 128:
                                _console_line.append(chr(rb))
                                _console_last[0] = time.time()
                                if len(_console_line) >= 200:
                                    _console_flush(ide_base, verify_tls)
                        i += 1
                        continue
                    if not is_console_plausible(ch):
                        # Could be a genuine multi-byte UTF-8 sequence in
                        # firmware output (box-drawing banner characters).
                        u = try_parse_utf8_sequence(buf, i)
                        if u is False:
                            # Valid lead byte, sequence incomplete — wait for
                            # more data before deciding.
                            break
                        if u is not None:
                            n_bytes, text = u
                            print(text, end='', flush=True)
                            _console_line.append(text)
                            _console_last[0] = time.time()
                            if len(_console_line) >= 200:
                                _console_flush(ide_base, verify_tls)
                            i += n_bytes
                            continue
                        # Locked, but this byte cannot be genuine console
                        # output (not ASCII, not valid UTF-8).  A dropped 0xAA
                        # magic byte (UART overrun) leaves the stream shifted
                        # with the lock still held; the shifted bytes start
                        # with NIA high bytes (0x00), so treat the first
                        # implausible byte as a slip: drop the lock and
                        # discard quietly until resync.
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
            # Deferred snapshot timeout: if the expected boot trace packets
            # have not all arrived within BOOT_Q_TIMEOUT seconds, send 'q'
            # anyway so the IDE still gets a register snapshot on boards that
            # emit fewer packets than expected (e.g. older bitstreams).
            if _boot_q_pending and now >= _boot_q_deadline:
                _boot_q_pending = False
                try:
                    ser.write(b'q')
                    last_write_ts = now
                    print(f'  [boot] snapshot timeout — requesting snapshot '
                          f'({_boot_q_remaining} boot packet(s) still pending)',
                          flush=True)
                except Exception as _qe:
                    print(f'  [boot] snapshot send error (timeout): {_qe}',
                          flush=True)

            # Idle flush: a partial line with no newline (e.g. a banner that
            # ends without \n) is forwarded after 0.5 s of UART silence.
            if _console_line and now - _console_last[0] >= 0.5:
                _console_flush(ide_base, verify_tls)
            if now - last_poll >= 0.05:
                last_poll = now
                try:
                    r = requests.get(
                        f'{ide_base}/hardware/wukong/command',
                        headers={'X-Wukong-Session': session_id},
                        timeout=0.1, verify=verify_tls)
                    if r.status_code == 200:
                        data = r.json() or {}
                        cmd = data.get('cmd')
                        if cmd in ('s', 'r', 'h', 'q', 'b', 'f'):
                            ser = execute_board_command(
                                cmd, data, ser, _reopen_serial, buf,
                                ide_base, verify_tls, session_id)
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
                except Exception as exc:
                    bridge_state = 'network_error'
                    _bridge_status('http_error', bridge_state, str(exc))

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
        # A complete DMEM replacement must restart from the boot ROM so it
        # consumes the newly written Namespace descriptor and Thread.caps[0].
        # The server requests this only for the Wukong-native projection; leave
        # older/manual upload commands backward compatible.
        if data.get('reboot'):
            try:
                ser.write(b'f')
                ser.flush()
                print('  [upload] rebooted board into uploaded boot entry', flush=True)
            except Exception as exc:
                errmsg = f'uploaded image but reboot command failed: {exc}'
                print(f'  [upload] ERROR: {errmsg}', flush=True)
                try:
                    requests.post(f'{ide_base}/hardware/wukong/upload-ack',
                                  json={'ok': False, 'error': errmsg},
                                  timeout=2, verify=verify_tls)
                except Exception:
                    pass
                return leftover
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
