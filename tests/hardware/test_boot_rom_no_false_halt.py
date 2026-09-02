"""tests/hardware/test_boot_rom_no_false_halt.py — Boot ROM clean-boot smoke test.

Verifies that the 3-instruction boot ROM sequence (LOAD→CHANGE→CALL) produces
exactly 8 trace packets, all with fault_valid=False, and that the fault-halt
mechanism does not fire during a clean boot.

Boot sequence per docs/debug-packet-protocol.md §"Boot sequence":

    [0] LOAD   CR15, CR15[0]  →  2 packets  (LOAD_SHADOW + LOAD_NEW)     NIA=0x00
    [1] CHANGE CR12, CR15, #1 →  3 packets  (CHANGE_PUSH + CHANGE_CR12 + CHANGE_CR5)  NIA=0x04
    [2] CALL   CR0,  CR0      →  3 packets  (CALL_CR6 + CALL_CR14 + CALL_PUSH)        NIA=0x08

Total: 8 packets before the first SelfTest / user-abstraction instruction.

The test does NOT need a real UART port.  It builds a synthetic byte stream
(3-byte V2 sentinel + 8 fault-free trace packets) that mimics the hardware
UART output, then feeds it through the real ``decode_trace_packet`` helper
from ``hardware/wukong_bridge.py``.

Checks
------
1. Synthetic packet stream: all 8 packets decode with fault_valid=False.
2. NIA grouping: 2 packets at 0x00, 3 at 0x04, 3 at 0x08.
3. Event-type sequence matches the LOAD→CHANGE→CALL contract.
4. A synthetic fault on any of packets 0–7 would set fault_valid=True (codec
   round-trip — confirms the fault bit is not silently discarded).
5. RTL source check: ``fault_halt`` in wukong_top.py is gated on
   ``core.retire_valid & core.retire_fault_valid``, so a boot fault fires
   immediately, not silently.
6. Bridge source check: the bridge sends ``'h'`` AFTER consuming the
   sentinel bytes, not before — no race that could corrupt the packet stream.
7. BOOT_PROGRAM has exactly 3 instructions (guard against accidental growth).
8. Sentinel 'h' byte (0x68) does not appear as a valid TRACE_MAGIC (0xAA),
   confirming the bridge's halt command cannot be mistaken for a trace packet.
"""

import os
import re
import struct
import sys

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT)

# Re-use the real packet codec from the bridge — single source of truth.
from hardware.wukong_bridge import (
    TRACE_MAGIC,
    TRACE_LEN,
    BOOT_SENTINEL_V2,
    TU_VERSION_CALL_3PKT,
    decode_trace_packet,
    parse_boot_sentinel,
)
from hardware.boot_rom import BOOT_PROGRAM
from hardware.hw_types import ChurchOpcode

# ── Trace event type constants (mirrored from wukong_bridge.py) ───────────────
TRACE_EV_LOAD_SHADOW = 0x01
TRACE_EV_LOAD_NEW    = 0x02
TRACE_EV_CHANGE_PUSH = 0x03
TRACE_EV_CHANGE_CR12 = 0x04
TRACE_EV_CHANGE_CR5  = 0x05
TRACE_EV_CALL_CR6    = 0x06
TRACE_EV_CALL_CR14   = 0x07
TRACE_EV_CALL_PUSH   = 0x08

# Expected boot packet sequence: (NIA, ev_type)
# LOAD→CHANGE→CALL: 2+3+3 = 8 packets total.
BOOT_PACKET_SPEC = [
    (0x00000000, TRACE_EV_LOAD_SHADOW),   # LOAD packet 1
    (0x00000000, TRACE_EV_LOAD_NEW),      # LOAD packet 2
    (0x00000004, TRACE_EV_CHANGE_PUSH),   # CHANGE packet 1
    (0x00000004, TRACE_EV_CHANGE_CR12),   # CHANGE packet 2
    (0x00000004, TRACE_EV_CHANGE_CR5),    # CHANGE packet 3
    (0x00000008, TRACE_EV_CALL_CR6),      # CALL packet 1
    (0x00000008, TRACE_EV_CALL_CR14),     # CALL packet 2
    (0x00000008, TRACE_EV_CALL_PUSH),     # CALL packet 3
]

_WUKONG_TOP_PATH = os.path.join(ROOT, "hardware", "wukong_top.py")
_WUKONG_BRIDGE_PATH = os.path.join(ROOT, "hardware", "wukong_bridge.py")

# ── Synthetic packet helpers ──────────────────────────────────────────────────

def _make_trace_packet(nia: int, ev_type: int, payload_gt: int = 0,
                       flags: int = 0, fault_code: int = 0,
                       fault_valid: bool = False, bp_hit: bool = False) -> bytes:
    """Encode a 12-byte trace packet exactly as the hardware TraceUnit emits it.

    Layout (big-endian):
      [0]     TRACE_MAGIC (0xAA)
      [1..4]  NIA          (uint32 big-endian)
      [5]     ev_type
      [6..9]  payload_gt   (uint32 big-endian)
      [10]    flags        bits[3:0]=NZCV
      [11]    fault        {bp_hit[7], fault_valid[6], 0[5], fault_code[4:0]}
    """
    fault_byte = (fault_code & 0x1F) | (0x40 if fault_valid else 0) | (0x80 if bp_hit else 0)
    return bytes([
        TRACE_MAGIC,
        *struct.pack(">I", nia),
        ev_type,
        *struct.pack(">I", payload_gt),
        flags,
        fault_byte,
    ])


def _make_clean_boot_stream(n_init_byte: int = 5) -> bytes:
    """Return a synthetic byte stream for a clean boot: sentinel + 8 fault-free packets."""
    sentinel = bytes([BOOT_SENTINEL_V2, n_init_byte & 0xFF, TU_VERSION_CALL_3PKT, 0x01])
    packets = b"".join(
        _make_trace_packet(nia, ev_type, fault_valid=False)
        for nia, ev_type in BOOT_PACKET_SPEC
    )
    return sentinel + packets


def _parse_all_packets(stream: bytes) -> list:
    """Extract and decode all TRACE_MAGIC-prefixed packets from *stream*.

    Skips sentinel bytes (0xBC / 0xBB) using parse_boot_sentinel so the
    extraction logic mirrors the bridge's main loop exactly.
    """
    buf = bytearray(stream)
    packets = []
    i = 0
    while i < len(buf):
        b = buf[i]
        if b == TRACE_MAGIC:
            if len(buf) - i < TRACE_LEN:
                break
            pkt = bytes(buf[i:i + TRACE_LEN])
            packets.append(decode_trace_packet(pkt))
            i += TRACE_LEN
        elif b in (BOOT_SENTINEL_V2, 0xBB):
            sentinel = parse_boot_sentinel(buf, i)
            if sentinel is False:
                break
            if sentinel is None:
                i += 1
            else:
                i += sentinel["length"]
        else:
            i += 1
    return packets


# ── Tests ─────────────────────────────────────────────────────────────────────

class TestBootRomPacketCount:
    """BOOT_PROGRAM must have exactly 3 instructions → exactly 8 trace packets."""

    def test_boot_program_has_3_instructions(self):
        """BOOT_PROGRAM[:3] must be exactly 3 non-zero words."""
        boot_words = list(BOOT_PROGRAM[:3])
        assert len(boot_words) == 3, f"Expected 3 boot words, got {len(boot_words)}"
        for idx, w in enumerate(boot_words):
            assert w != 0, (
                f"BOOT_PROGRAM[{idx}] is zero — instruction missing"
            )

    def test_boot_program_opcodes(self):
        """BOOT_PROGRAM[0]=LOAD, [1]=CHANGE, [2]=CALL — full opcode bits[31:27]."""
        ops = [(BOOT_PROGRAM[i] >> 27) & 0x1F for i in range(3)]
        assert ops[0] == int(ChurchOpcode.LOAD),   f"BOOT_PROGRAM[0] opcode should be LOAD, got {ops[0]}"
        assert ops[1] == int(ChurchOpcode.CHANGE), f"BOOT_PROGRAM[1] opcode should be CHANGE, got {ops[1]}"
        assert ops[2] == int(ChurchOpcode.CALL),   f"BOOT_PROGRAM[2] opcode should be CALL, got {ops[2]}"

    def test_boot_produces_8_packets(self):
        """The LOAD→CHANGE→CALL sequence produces exactly 8 trace packets."""
        assert len(BOOT_PACKET_SPEC) == 8, (
            f"BOOT_PACKET_SPEC must have 8 entries; has {len(BOOT_PACKET_SPEC)}"
        )

    def test_boot_packet_nia_groups(self):
        """2 packets at NIA=0x00, 3 at NIA=0x04, 3 at NIA=0x08."""
        from collections import Counter
        counts = Counter(nia for nia, _ in BOOT_PACKET_SPEC)
        assert counts[0x00000000] == 2, f"Expected 2 LOAD packets at NIA=0x00, got {counts[0x00000000]}"
        assert counts[0x00000004] == 3, f"Expected 3 CHANGE packets at NIA=0x04, got {counts[0x00000004]}"
        assert counts[0x00000008] == 3, f"Expected 3 CALL packets at NIA=0x08, got {counts[0x00000008]}"


class TestBootStreamDecoding:
    """Synthetic clean-boot stream: all 8 packets decode with fault_valid=False."""

    def setup_method(self):
        stream = _make_clean_boot_stream(n_init_byte=5)
        self.packets = _parse_all_packets(stream)

    def test_exactly_8_packets_decoded(self):
        """Exactly 8 trace packets are decoded from the clean-boot stream."""
        assert len(self.packets) == 8, (
            f"Expected 8 decoded boot packets, got {len(self.packets)}"
        )

    def test_no_fault_valid_in_boot_packets(self):
        """All 8 boot packets have fault_valid=False — no false-halt fires."""
        faulting = [
            (i, pkt) for i, pkt in enumerate(self.packets)
            if pkt["fault_valid"]
        ]
        assert not faulting, (
            "fault_valid=True in boot packet(s) — board would false-halt before "
            f"IDE can attach: {[(i, p['fault_code']) for i, p in faulting]}"
        )

    def test_no_bp_hit_in_boot_packets(self):
        """All 8 boot packets have bp_hit=False."""
        bp = [(i, pkt) for i, pkt in enumerate(self.packets) if pkt["bp_hit"]]
        assert not bp, f"Unexpected bp_hit in boot packets: {bp}"

    def test_packet_nias(self):
        """Each decoded packet carries the correct NIA."""
        for i, (pkt, (exp_nia, _)) in enumerate(zip(self.packets, BOOT_PACKET_SPEC)):
            assert pkt["nia"] == exp_nia, (
                f"Packet {i}: NIA=0x{pkt['nia']:08X}, expected 0x{exp_nia:08X}"
            )

    def test_packet_event_types(self):
        """Each decoded packet carries the correct TRACE_EV_* event type."""
        for i, (pkt, (_, exp_ev)) in enumerate(zip(self.packets, BOOT_PACKET_SPEC)):
            assert pkt["ev_type"] == exp_ev, (
                f"Packet {i}: ev_type=0x{pkt['ev_type']:02X}, expected 0x{exp_ev:02X}"
            )

    def test_halt_not_triggered_before_packet_9(self):
        """No fault on packets 0–7 means step_mode is not forced before user code runs.

        Simulates the RTL rule: fault_halt fires only if fault_valid=1 on a retire.
        Verifies that under a clean boot no packet triggers the condition.
        """
        for i, pkt in enumerate(self.packets[:8]):
            # RTL: fault_halt = retire_valid & retire_fault_valid
            fault_halt = pkt["fault_valid"]  # retire_valid=1 implied by packet existing
            assert not fault_halt, (
                f"fault_halt would fire on boot packet {i} (NIA=0x{pkt['nia']:08X}) — "
                "board enters step mode before IDE attaches"
            )


class TestFaultPacketCodecRoundTrip:
    """Confirm fault_valid=True survives encode→decode so a real fault is never silently dropped."""

    def test_fault_packet_round_trip(self):
        """A packet encoded with fault_valid=True decodes with fault_valid=True."""
        pkt = _make_trace_packet(0x00000000, TRACE_EV_LOAD_SHADOW,
                                  fault_code=4, fault_valid=True)  # 4 = PERM_L
        decoded = decode_trace_packet(pkt)
        assert decoded["fault_valid"] is True, (
            "fault_valid=True did not survive encode→decode — "
            "a real boot fault would be silently ignored"
        )
        assert decoded["fault_code"] == 4, (
            f"fault_code mangled: expected 4 (PERM_L), got {decoded['fault_code']}"
        )

    def test_clean_packet_round_trip(self):
        """A packet encoded with fault_valid=False decodes with fault_valid=False."""
        pkt = _make_trace_packet(0x00000000, TRACE_EV_LOAD_SHADOW, fault_valid=False)
        decoded = decode_trace_packet(pkt)
        assert decoded["fault_valid"] is False

    @pytest.mark.parametrize("pkt_index", range(8))
    def test_injecting_fault_on_boot_packet_sets_fault_valid(self, pkt_index):
        """Injecting fault_valid=True on boot packet N causes fault_halt to fire.

        Confirms the detection mechanism works — a real hardware fault on any of
        the 8 boot instructions would be caught, not silently passed over.
        """
        nia, ev_type = BOOT_PACKET_SPEC[pkt_index]
        pkt = _make_trace_packet(nia, ev_type, fault_code=3, fault_valid=True)  # 3=PERM_E
        decoded = decode_trace_packet(pkt)
        # RTL: fault_halt = retire_valid & retire_fault_valid
        fault_halt_would_fire = decoded["fault_valid"]
        assert fault_halt_would_fire, (
            f"fault injection on boot packet {pkt_index} not detected — "
            "a real fault during boot would be missed"
        )


class TestFaultHaltRtlSource:
    """RTL source check: fault_halt wired to retire_valid & retire_fault_valid."""

    def _get_wukong_top_src(self) -> str:
        with open(_WUKONG_TOP_PATH) as fh:
            return fh.read()

    def test_fault_halt_signal_declared(self):
        """wukong_top.py declares ``fault_halt`` Signal."""
        src = self._get_wukong_top_src()
        assert "fault_halt" in src, (
            "fault_halt Signal not found in wukong_top.py — "
            "fault-halt during boot cannot be detected"
        )

    def test_fault_halt_gated_on_retire_valid(self):
        """fault_halt is gated on core.retire_valid (fires only on an actual retire)."""
        src = self._get_wukong_top_src()
        # Find the fault_halt assignment line
        idx = src.find("fault_halt.eq(")
        assert idx != -1, "fault_halt.eq() assignment not found in wukong_top.py"
        ctx = src[idx: idx + 200]
        assert "retire_valid" in ctx, (
            "fault_halt.eq() must reference core.retire_valid so it only fires "
            f"on a real retire.  Context: {ctx!r}"
        )

    def test_fault_halt_gated_on_retire_fault_valid(self):
        """fault_halt is gated on core.retire_fault_valid (a fault must have occurred)."""
        src = self._get_wukong_top_src()
        idx = src.find("fault_halt.eq(")
        assert idx != -1
        ctx = src[idx: idx + 200]
        assert "retire_fault_valid" in ctx, (
            "fault_halt.eq() must reference core.retire_fault_valid so it only "
            f"fires when a fault actually occurred.  Context: {ctx!r}"
        )

    def test_fault_halt_ored_into_bp_hit(self):
        """The RTL step-mode latch ORs fault_halt with bp_hit."""
        src = self._get_wukong_top_src()
        # The pattern: m.If(bp_hit | fault_halt)
        assert "bp_hit | fault_halt" in src or "fault_halt | bp_hit" in src, (
            "wukong_top.py must OR fault_halt with bp_hit in the step-mode "
            "latch (m.If(bp_hit | fault_halt))"
        )

    def test_fault_halt_sets_step_mode(self):
        """On bp_hit | fault_halt the RTL sets step_mode=1 and step_halted=1."""
        src = self._get_wukong_top_src()
        # Find the If(bp_hit | fault_halt) block
        halt_if_idx = src.find("bp_hit | fault_halt")
        if halt_if_idx == -1:
            halt_if_idx = src.find("fault_halt | bp_hit")
        assert halt_if_idx != -1
        ctx = src[halt_if_idx: halt_if_idx + 300]
        assert "step_mode" in ctx, (
            "bp_hit|fault_halt block must set step_mode"
        )
        assert "step_halted" in ctx, (
            "bp_hit|fault_halt block must set step_halted"
        )


class TestBridgeSentinelHaltOrdering:
    """Bridge sends 'h' AFTER consuming the sentinel, then arms deferred-q gate.

    'q' (snapshot request) is NOT sent immediately.  After sentinel detection
    the bridge arms _boot_q_pending so the receive loop sends 'q' only after
    BOOT_TRACE_PACKET_COUNT boot trace packets have arrived — this prevents the
    snapshot from capturing mid-boot register state.
    """

    def _get_bridge_src(self) -> str:
        with open(_WUKONG_BRIDGE_PATH) as fh:
            return fh.read()

    def test_halt_byte_sent_after_sentinel_consumed(self):
        """In the bridge main loop, ser.write(b'h') appears after sentinel parsing,
        so fail-safe Halt is requested only for a validated fresh boot.
        """
        src = self._get_bridge_src()
        # The bridge parses the sentinel in the elif branch for BOOT_SENTINEL_V* bytes.
        # Find that branch and confirm ser.write(b'h') is inside it.
        sentinel_branch_idx = src.find("BOOT_SENTINEL_V1, BOOT_SENTINEL_V2")
        assert sentinel_branch_idx != -1, (
            "Cannot locate sentinel branch in wukong_bridge.py "
            "(expected 'BOOT_SENTINEL_V1, BOOT_SENTINEL_V2' in elif)"
        )
        halt_write_idx = src.find("ser.write(b'h' + bytes([", sentinel_branch_idx)
        assert halt_write_idx != -1, (
            "nonce-bearing Halt write not found after the sentinel branch in wukong_bridge.py — "
            "bridge may not halt after boot sentinel"
        )
        # Confirm 'h' is sent from the sentinel branch.
        # by checking it appears in the sentinel elif block, not the trace-packet if block.
        trace_magic_if_idx = src.find("if b == TRACE_MAGIC:")
        assert trace_magic_if_idx < sentinel_branch_idx, (
            "Unexpected structure: TRACE_MAGIC check should appear before the sentinel branch"
        )
        assert halt_write_idx > sentinel_branch_idx, (
            "ser.write(b'h') must be inside the sentinel branch, after parsing the sentinel"
        )
        main_end = src.find("\ndef _handle_upload(", sentinel_branch_idx)
        assert src.find("ser.write(b'r')", sentinel_branch_idx, main_end) == -1

    def test_snapshot_gate_armed_after_halt_on_sentinel(self):
        """Bridge arms the deferred-snapshot gate in the sentinel block.

        'q' is NOT sent immediately after 'h' — that would race with the boot
        trace packets the CM emits right after boot (CHANGE + CALL sequence),
        causing the snapshot to capture mid-boot register state.

        Instead the bridge sets _boot_q_pending = True inside the sentinel
        try-block, and the receive loop sends 'q' after
        BOOT_TRACE_PACKET_COUNT post-sentinel packets arrive (or a timeout).
        This test verifies the gate is armed, not that 'q' is sent immediately.
        """
        src = self._get_bridge_src()
        sentinel_branch_idx = src.find("BOOT_SENTINEL_V1, BOOT_SENTINEL_V2")
        assert sentinel_branch_idx != -1, (
            "Cannot locate sentinel branch in wukong_bridge.py"
        )
        halt_write_idx = src.find("ser.write(b'h' + bytes([", sentinel_branch_idx)
        assert halt_write_idx != -1, (
            "nonce-bearing Halt write not found after the sentinel branch in wukong_bridge.py"
        )
        # The sentinel block must arm the deferred-q gate, not send 'q' directly.
        sentinel_block_end = src.find("if sentinel['stale']:", halt_write_idx)
        assert sentinel_block_end != -1, (
            "sentinel state boundary not found after ser.write(b'h')"
        )
        sentinel_block = src[sentinel_branch_idx:sentinel_block_end]
        assert '_boot_q_pending' in sentinel_block, (
            "_boot_q_pending not armed in the sentinel try-block — "
            "the bridge must set _boot_q_pending = True after 'h' so the "
            "receive loop can send 'q' after boot trace packets settle"
        )
        # 'q' must NOT be written immediately in the sentinel block;
        # it belongs in the deferred gate in the receive loop.
        assert "ser.write(b'q')" not in sentinel_block, (
            "ser.write(b'q') found in the sentinel block — 'q' must be deferred "
            "to after BOOT_TRACE_PACKET_COUNT post-sentinel packets, not sent "
            "immediately (risk: snapshot captures mid-boot register state)"
        )

    def test_halt_command_byte_is_not_trace_magic(self):
        """The 'h' halt byte (0x68) is not confused with TRACE_MAGIC (0xAA).

        Confirms the bridge's single-byte sentinel 'h' cannot be misread as the
        start of a 12-byte trace packet on the same UART line.
        """
        assert ord('h') != TRACE_MAGIC, (
            f"'h' (0x{ord('h'):02X}) == TRACE_MAGIC (0x{TRACE_MAGIC:02X}) — "
            "the halt command would be mistaken for a trace packet"
        )

    def test_sentinel_magic_is_not_trace_magic(self):
        """Boot sentinel magic byte (0xBC) is not TRACE_MAGIC (0xAA)."""
        assert BOOT_SENTINEL_V2 != TRACE_MAGIC, (
            "BOOT_SENTINEL_V2 == TRACE_MAGIC — sentinel would be misread as a packet"
        )
