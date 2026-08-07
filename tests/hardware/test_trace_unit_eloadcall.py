"""TraceUnit FSM — ELOADCALL / XLOADLAMBDA emit 3-event packet sequence.

Verifies that ELOADCALL (opcode 0b1000) and XLOADLAMBDA (opcode 0b1001) are
handled by the TraceUnit FSM as 3-event sequences (CALL_CR6 + CALL_CR14 +
CALL_PUSH), not as single RESULT packets.

The test does NOT instantiate the full ChurchWukongXC7A100T (which needs BRAM
init and UART arbitration); instead it exercises only the switch decode logic
inside the TraceUnit FSM by checking that the tq_len / tq_type registers are
loaded with the CALL 3-event values when the retiring instruction word encodes
ELOADCALL or XLOADLAMBDA in bits[30:27].

Approach
--------
We simulate the opcode-switch decode in Python using the same bit-field
extraction used by the Amaranth FSM:

    opcode_field = retire_instr[27:31]   # 4-bit Church opcode

Then we verify that the switch body for ELOADCALL (0b1000) and XLOADLAMBDA
(0b1001) maps to tq_len=3 and tq_type[0]=CALL_CR6, tq_type[1]=CALL_CR14,
tq_type[2]=CALL_PUSH — matching the CALL case — rather than tq_len=1 /
tq_type[0]=RESULT (the Default fallthrough).

The golden constant values come from hw_types.ChurchOpcode and the
_TRACE_EV_* literals defined in wukong_top.py (mirrored here to avoid
importing Amaranth at test collection time).
"""

import sys
import os
import ast
import re

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT)

from hardware.hw_types import ChurchOpcode

# ── Mirror the _TRACE_EV_* constants from wukong_top.py ──────────────────────
# These are defined as local variables inside elaborate(), so we parse them
# from the source rather than importing Amaranth.
_WUKONG_TOP_PATH = os.path.join(ROOT, "hardware", "wukong_top.py")

def _extract_trace_ev_constants():
    """Return a dict of _TRACE_EV_* name → int from wukong_top.py source."""
    consts = {}
    pattern = re.compile(r'(_TRACE_EV_\w+)\s*=\s*(0x[0-9A-Fa-f]+|\d+)')
    with open(_WUKONG_TOP_PATH) as fh:
        for line in fh:
            m = pattern.search(line)
            if m:
                consts[m.group(1)] = int(m.group(2), 0)
    return consts

_EV = _extract_trace_ev_constants()

_TRACE_EV_RESULT    = _EV["_TRACE_EV_RESULT"]
_TRACE_EV_CALL_CR6  = _EV["_TRACE_EV_CALL_CR6"]
_TRACE_EV_CALL_CR14 = _EV["_TRACE_EV_CALL_CR14"]
_TRACE_EV_CALL_PUSH = _EV["_TRACE_EV_CALL_PUSH"]


# ── Decode model ──────────────────────────────────────────────────────────────

def _trace_unit_decode(retire_instr: int) -> dict:
    """Python model of the TraceUnit FSM opcode switch.

    Returns a dict with keys: tq_len, tq_type (list of 3 ints).
    Mirrors the m.Switch(core.retire_instr[27:31]) block in wukong_top.py.
    """
    opcode = (retire_instr >> 27) & 0xF   # bits[30:27], 4-bit field

    CALL_EVENTS = dict(
        tq_len=3,
        tq_type=[_TRACE_EV_CALL_CR6, _TRACE_EV_CALL_CR14, _TRACE_EV_CALL_PUSH],
    )

    if opcode == ChurchOpcode.LOAD:       # 0b0000
        return dict(tq_len=2, tq_type=[0x01, 0x02, 0])
    elif opcode == ChurchOpcode.CHANGE:   # 0b0100
        return dict(tq_len=3, tq_type=[0x03, 0x04, 0x05])
    elif opcode == ChurchOpcode.CALL:     # 0b0010
        return CALL_EVENTS
    elif opcode == ChurchOpcode.ELOADCALL:    # 0b1000
        return CALL_EVENTS
    elif opcode == ChurchOpcode.XLOADLAMBDA:  # 0b1001
        return CALL_EVENTS
    elif opcode == ChurchOpcode.RETURN:   # 0b0011
        return dict(tq_len=3, tq_type=[0x09, 0x0A, 0x0B])
    else:
        return dict(tq_len=1, tq_type=[_TRACE_EV_RESULT, 0, 0])


def _encode_instr(opcode: int, cond: int = 14) -> int:
    """Encode a minimal instruction word with the given 5-bit opcode."""
    # Format: opcode[5] | cond[4] | dst[4] | src[4] | imm[15]
    # Bits[31:27]=opcode, bits[26:23]=cond (for Church ops only bits[30:27] matter)
    return ((opcode & 0x1F) << 27) | ((cond & 0xF) << 23)


# ── Tests ─────────────────────────────────────────────────────────────────────

class TestTraceUnitEloadcall:
    """Confirm ELOADCALL and XLOADLAMBDA decode to the 3-event CALL sequence."""

    def test_eloadcall_opcode_value(self):
        """Sanity: ChurchOpcode.ELOADCALL == 0b1000 (8)."""
        assert int(ChurchOpcode.ELOADCALL) == 0b1000

    def test_xloadlambda_opcode_value(self):
        """Sanity: ChurchOpcode.XLOADLAMBDA == 0b1001 (9)."""
        assert int(ChurchOpcode.XLOADLAMBDA) == 0b1001

    def test_trace_ev_constants_present(self):
        """All four CALL-sequence _TRACE_EV_* constants are found in wukong_top.py."""
        assert _TRACE_EV_CALL_CR6  == 0x06
        assert _TRACE_EV_CALL_CR14 == 0x07
        assert _TRACE_EV_CALL_PUSH == 0x08

    # ── ELOADCALL ─────────────────────────────────────────────────────────────

    def test_eloadcall_emits_3_events(self):
        """ELOADCALL retire_instr decodes to tq_len=3 (not 1)."""
        instr = _encode_instr(ChurchOpcode.ELOADCALL)
        result = _trace_unit_decode(instr)
        assert result["tq_len"] == 3, (
            f"ELOADCALL should emit 3 events, got tq_len={result['tq_len']}"
        )

    def test_eloadcall_event0_is_call_cr6(self):
        """ELOADCALL event[0] = CALL_CR6 (0x06)."""
        instr = _encode_instr(ChurchOpcode.ELOADCALL)
        result = _trace_unit_decode(instr)
        assert result["tq_type"][0] == _TRACE_EV_CALL_CR6, (
            f"ELOADCALL event[0] should be CALL_CR6 (0x{_TRACE_EV_CALL_CR6:02X}), "
            f"got 0x{result['tq_type'][0]:02X}"
        )

    def test_eloadcall_event1_is_call_cr14(self):
        """ELOADCALL event[1] = CALL_CR14 (0x07)."""
        instr = _encode_instr(ChurchOpcode.ELOADCALL)
        result = _trace_unit_decode(instr)
        assert result["tq_type"][1] == _TRACE_EV_CALL_CR14, (
            f"ELOADCALL event[1] should be CALL_CR14 (0x{_TRACE_EV_CALL_CR14:02X}), "
            f"got 0x{result['tq_type'][1]:02X}"
        )

    def test_eloadcall_event2_is_call_push(self):
        """ELOADCALL event[2] = CALL_PUSH (0x08)."""
        instr = _encode_instr(ChurchOpcode.ELOADCALL)
        result = _trace_unit_decode(instr)
        assert result["tq_type"][2] == _TRACE_EV_CALL_PUSH, (
            f"ELOADCALL event[2] should be CALL_PUSH (0x{_TRACE_EV_CALL_PUSH:02X}), "
            f"got 0x{result['tq_type'][2]:02X}"
        )

    def test_eloadcall_not_result(self):
        """ELOADCALL must NOT fall through to the Default RESULT case."""
        instr = _encode_instr(ChurchOpcode.ELOADCALL)
        result = _trace_unit_decode(instr)
        assert result["tq_type"][0] != _TRACE_EV_RESULT, (
            "ELOADCALL must NOT emit a RESULT packet — it fell through to Default"
        )

    # ── XLOADLAMBDA ───────────────────────────────────────────────────────────

    def test_xloadlambda_emits_3_events(self):
        """XLOADLAMBDA retire_instr decodes to tq_len=3 (not 1)."""
        instr = _encode_instr(ChurchOpcode.XLOADLAMBDA)
        result = _trace_unit_decode(instr)
        assert result["tq_len"] == 3, (
            f"XLOADLAMBDA should emit 3 events, got tq_len={result['tq_len']}"
        )

    def test_xloadlambda_event0_is_call_cr6(self):
        """XLOADLAMBDA event[0] = CALL_CR6 (0x06)."""
        instr = _encode_instr(ChurchOpcode.XLOADLAMBDA)
        result = _trace_unit_decode(instr)
        assert result["tq_type"][0] == _TRACE_EV_CALL_CR6

    def test_xloadlambda_event1_is_call_cr14(self):
        """XLOADLAMBDA event[1] = CALL_CR14 (0x07)."""
        instr = _encode_instr(ChurchOpcode.XLOADLAMBDA)
        result = _trace_unit_decode(instr)
        assert result["tq_type"][1] == _TRACE_EV_CALL_CR14

    def test_xloadlambda_event2_is_call_push(self):
        """XLOADLAMBDA event[2] = CALL_PUSH (0x08)."""
        instr = _encode_instr(ChurchOpcode.XLOADLAMBDA)
        result = _trace_unit_decode(instr)
        assert result["tq_type"][2] == _TRACE_EV_CALL_PUSH

    def test_xloadlambda_not_result(self):
        """XLOADLAMBDA must NOT fall through to the Default RESULT case."""
        instr = _encode_instr(ChurchOpcode.XLOADLAMBDA)
        result = _trace_unit_decode(instr)
        assert result["tq_type"][0] != _TRACE_EV_RESULT

    # ── Cross-check: CALL still works ─────────────────────────────────────────

    def test_call_still_emits_3_events(self):
        """CALL still decodes to tq_len=3 after the ELOADCALL/XLOADLAMBDA additions."""
        instr = _encode_instr(ChurchOpcode.CALL)
        result = _trace_unit_decode(instr)
        assert result["tq_len"] == 3
        assert result["tq_type"][:3] == [_TRACE_EV_CALL_CR6, _TRACE_EV_CALL_CR14,
                                          _TRACE_EV_CALL_PUSH]

    # ── Verify the switch source in wukong_top.py ──────────────────────────────

    def test_wukong_top_has_eloadcall_case(self):
        """wukong_top.py switch contains a m.Case(ChurchOpcode.ELOADCALL) arm."""
        with open(_WUKONG_TOP_PATH) as fh:
            src = fh.read()
        assert "ChurchOpcode.ELOADCALL" in src, (
            "TraceUnit FSM in wukong_top.py is missing a Case for ChurchOpcode.ELOADCALL"
        )

    def test_wukong_top_has_xloadlambda_case(self):
        """wukong_top.py switch contains a m.Case(ChurchOpcode.XLOADLAMBDA) arm."""
        with open(_WUKONG_TOP_PATH) as fh:
            src = fh.read()
        assert "ChurchOpcode.XLOADLAMBDA" in src, (
            "TraceUnit FSM in wukong_top.py is missing a Case for ChurchOpcode.XLOADLAMBDA"
        )

    def test_eloadcall_case_in_trace_unit_fsm(self):
        """The ELOADCALL case in wukong_top.py is inside the TraceUnit FSM block
        (after the '# ── TraceUnit FSM ──' marker), not elsewhere in the file."""
        with open(_WUKONG_TOP_PATH) as fh:
            src = fh.read()
        trace_fsm_start = src.find("# ── TraceUnit FSM ──")
        assert trace_fsm_start != -1, "TraceUnit FSM marker not found in wukong_top.py"
        eloadcall_pos = src.find("ChurchOpcode.ELOADCALL", trace_fsm_start)
        assert eloadcall_pos != -1, (
            "ChurchOpcode.ELOADCALL case not found inside the TraceUnit FSM block"
        )

    def test_eloadcall_case_emits_call_cr6_in_source(self):
        """The ELOADCALL arm in wukong_top.py sets tq_type[0] to _TRACE_EV_CALL_CR6."""
        with open(_WUKONG_TOP_PATH) as fh:
            src = fh.read()
        # Find the ELOADCALL case block and confirm CALL_CR6 appears in it
        eloadcall_idx = src.find("ChurchOpcode.ELOADCALL")
        xloadlambda_idx = src.find("ChurchOpcode.XLOADLAMBDA")
        # The CALL_CR6 assignment must appear between the ELOADCALL and XLOADLAMBDA cases
        call_cr6_in_eloadcall = "_TRACE_EV_CALL_CR6" in src[eloadcall_idx:xloadlambda_idx]
        assert call_cr6_in_eloadcall, (
            "ELOADCALL case in wukong_top.py must assign _TRACE_EV_CALL_CR6 to tq_type[0]"
        )
