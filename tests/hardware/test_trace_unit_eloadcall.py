"""Focused production-RTL trace decoder regressions."""

import sys
import os
import pytest
from amaranth.sim import Simulator

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT)

from hardware.hw_types import ChurchOpcode
from hardware.wukong_top import TraceEventDecoder
from shared.architecture_contracts import PROFILES as ARCH_PROFILES, TRACE_UNITS

# ── Canonical trace event identifiers ─────────────────────────────────────────
_WUKONG_TOP_PATH = os.path.join(ROOT, "hardware", "wukong_top.py")
_WUKONG_PROFILE = ARCH_PROFILES["wukong-uart-upload-v2"]
_TRACE_EVENTS = TRACE_UNITS[_WUKONG_PROFILE["traceUnit"]]["eventIds"]

_TRACE_EV_RESULT      = _TRACE_EVENTS["RESULT"]
_TRACE_EV_LOAD_SHADOW = _TRACE_EVENTS["LOAD_SHADOW"]
_TRACE_EV_LOAD_NEW    = _TRACE_EVENTS["LOAD_NEW"]
_TRACE_EV_CHANGE_PUSH = _TRACE_EVENTS["CHANGE_PUSH"]
_TRACE_EV_CHANGE_CR12 = _TRACE_EVENTS["CHANGE_CR12"]
_TRACE_EV_CHANGE_CR5  = _TRACE_EVENTS["CHANGE_CR5"]
_TRACE_EV_CALL_CR6    = _TRACE_EVENTS["CALL_CR6"]
_TRACE_EV_CALL_CR14   = _TRACE_EVENTS["CALL_CR14"]
_TRACE_EV_CALL_PUSH   = _TRACE_EVENTS["CALL_PUSH"]
_TRACE_EV_RETURN_POP  = _TRACE_EVENTS["RETURN_POP"]
_TRACE_EV_RETURN_CR6  = _TRACE_EVENTS["RETURN_CR6"]
_TRACE_EV_RETURN_CR14 = _TRACE_EVENTS["RETURN_CR14"]

_CORE_PY_PATH = os.path.join(ROOT, "hardware", "core.py")


# ── Decode model ──────────────────────────────────────────────────────────────

def _trace_unit_decode(retire_instr: int) -> dict:
    """Python model of the TraceUnit FSM opcode switch.

    Returns a dict with keys: tq_len, tq_type (list of 3 ints).
    Mirrors the m.Switch(core.retire_instr[27:32]) block in wukong_top.py.
    """
    opcode = (retire_instr >> 27) & 0x1F  # bits[31:27], full 5-bit field

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
    # Bits[31:27]=opcode, bits[26:23]=cond.
    return ((opcode & 0x1F) << 27) | ((cond & 0xF) << 23)


@pytest.mark.parametrize(
    ("opcode", "expected_count", "expected_types", "expected_data"),
    [
        pytest.param(
            ChurchOpcode.LOAD,
            2,
            [_TRACE_EV_LOAD_SHADOW, _TRACE_EV_LOAD_NEW, 0],
            [0x11111111, 0x22222222, 0],
            id="load",
        ),
        pytest.param(
            ChurchOpcode.CHANGE,
            3,
            [_TRACE_EV_CHANGE_PUSH, _TRACE_EV_CHANGE_CR12, _TRACE_EV_CHANGE_CR5],
            [0, 0x33333333, 0x44444444],
            id="change",
        ),
        pytest.param(
            ChurchOpcode.CALL,
            3,
            [_TRACE_EV_CALL_CR6, _TRACE_EV_CALL_CR14, _TRACE_EV_CALL_PUSH],
            [0x55555555, 0x66666666, 0],
            id="call",
        ),
        pytest.param(
            ChurchOpcode.ELOADCALL,
            3,
            [_TRACE_EV_CALL_CR6, _TRACE_EV_CALL_CR14, _TRACE_EV_CALL_PUSH],
            [0x55555555, 0x66666666, 0],
            id="eloadcall",
        ),
        pytest.param(
            ChurchOpcode.XLOADLAMBDA,
            3,
            [_TRACE_EV_CALL_CR6, _TRACE_EV_CALL_CR14, _TRACE_EV_CALL_PUSH],
            [0x55555555, 0x66666666, 0],
            id="xloadlambda",
        ),
        pytest.param(
            ChurchOpcode.RETURN,
            3,
            [_TRACE_EV_RETURN_POP, _TRACE_EV_RETURN_CR6, _TRACE_EV_RETURN_CR14],
            [0, 0x55555555, 0x66666666],
            id="return",
        ),
        pytest.param(
            16,  # Turing DREAD: full 5-bit decode must not alias Church LOAD.
            1,
            [_TRACE_EV_RESULT, 0, 0],
            [0, 0, 0],
            id="dread-result-fallback",
        ),
    ],
)
def test_production_trace_decoder_queue(
    opcode, expected_count, expected_types, expected_data
):
    """Actual production signals preserve event count, order, and fallback."""
    dut = TraceEventDecoder()
    observed = {}

    async def bench(ctx):
        ctx.set(dut.instr, _encode_instr(opcode))
        # Distinct sentinels prove each occupied queue slot uses its intended
        # production payload source; zero-payload slots are asserted as well.
        ctx.set(dut.load_shadow_gt, 0x11111111)
        ctx.set(dut.load_new_gt, 0x22222222)
        ctx.set(dut.cr12_gt, 0x33333333)
        ctx.set(dut.cr5_gt, 0x44444444)
        ctx.set(dut.cr6_gt, 0x55555555)
        ctx.set(dut.cr14_gt, 0x66666666)
        await ctx.delay(1e-9)
        observed["count"] = ctx.get(dut.event_count)
        observed["types"] = [ctx.get(signal) for signal in dut.event_type]
        observed["data"] = [ctx.get(signal) for signal in dut.event_data]

    sim = Simulator(dut)
    sim.add_testbench(bench)
    sim.run()

    assert observed["count"] == expected_count
    assert observed["types"] == expected_types
    assert observed["data"] == expected_data


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
        """The canonical contract preserves the CALL-sequence event identifiers."""
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

class TestReturnCr14Trace:
    """RETURN trace: RETURN_CR14 event carries the restored *caller* CR14, not the callee's.

    The fix is a two-part mechanism:
      1. core.py exposes retire_trace_return_cr14_valid / retire_trace_return_cr14_gt,
         which pulse when u_cload commits the restored caller CR14 into CR14 (i.e. when
         u_cload.cr_wr_en fires with cr_wr_addr == CR_CLOOMC==14).
      2. The TraceUnit SEND state in wukong_top.py updates tq_data[2] on that pulse,
         before it reaches the RETURN_CR14 packet (events 0+1 take 24 UART bytes first).
    """

    # ── RETURN event-type constants ────────────────────────────────────────────

    def test_return_ev_constants_values(self):
        """RETURN_POP=0x09, RETURN_CR6=0x0A, RETURN_CR14=0x0B."""
        assert _TRACE_EV_RETURN_POP  == 0x09
        assert _TRACE_EV_RETURN_CR6  == 0x0A
        assert _TRACE_EV_RETURN_CR14 == 0x0B

    # ── Decode model: RETURN maps to 3-event sequence ─────────────────────────

    def test_return_emits_3_events(self):
        """RETURN retire_instr decodes to tq_len=3."""
        instr = _encode_instr(ChurchOpcode.RETURN)
        result = _trace_unit_decode(instr)
        assert result["tq_len"] == 3, (
            f"RETURN should emit 3 events, got tq_len={result['tq_len']}"
        )

    def test_return_event0_is_return_pop(self):
        """RETURN event[0] = RETURN_POP (0x09)."""
        instr = _encode_instr(ChurchOpcode.RETURN)
        result = _trace_unit_decode(instr)
        assert result["tq_type"][0] == _TRACE_EV_RETURN_POP, (
            f"RETURN event[0] should be RETURN_POP (0x09), got 0x{result['tq_type'][0]:02X}"
        )

    def test_return_event1_is_return_cr6(self):
        """RETURN event[1] = RETURN_CR6 (0x0A)."""
        instr = _encode_instr(ChurchOpcode.RETURN)
        result = _trace_unit_decode(instr)
        assert result["tq_type"][1] == _TRACE_EV_RETURN_CR6, (
            f"RETURN event[1] should be RETURN_CR6 (0x0A), got 0x{result['tq_type'][1]:02X}"
        )

    def test_return_event2_is_return_cr14(self):
        """RETURN event[2] = RETURN_CR14 (0x0B)."""
        instr = _encode_instr(ChurchOpcode.RETURN)
        result = _trace_unit_decode(instr)
        assert result["tq_type"][2] == _TRACE_EV_RETURN_CR14, (
            f"RETURN event[2] should be RETURN_CR14 (0x0B), got 0x{result['tq_type'][2]:02X}"
        )

    def test_return_not_result(self):
        """RETURN must NOT fall through to the Default RESULT case."""
        instr = _encode_instr(ChurchOpcode.RETURN)
        result = _trace_unit_decode(instr)
        assert result["tq_type"][0] != _TRACE_EV_RESULT, (
            "RETURN must NOT emit a RESULT packet — it fell through to Default"
        )

    def test_dread_emits_one_result_not_load_sequence(self):
        """DREAD (opcode 16) must not alias Church LOAD (opcode 0)."""
        instr = _encode_instr(16)  # Turing DREAD
        result = _trace_unit_decode(instr)
        assert result == {"tq_len": 1, "tq_type": [_TRACE_EV_RESULT, 0, 0]}

    # ── core.py: retire_trace_return_cr14_valid / _gt signals exist ───────────

    def test_core_has_return_cr14_valid_signal(self):
        """core.py declares retire_trace_return_cr14_valid Signal."""
        with open(_CORE_PY_PATH) as fh:
            src = fh.read()
        assert "retire_trace_return_cr14_valid" in src, (
            "core.py must declare retire_trace_return_cr14_valid for the RETURN CR14 fix"
        )

    def test_core_has_return_cr14_gt_signal(self):
        """core.py declares retire_trace_return_cr14_gt Signal."""
        with open(_CORE_PY_PATH) as fh:
            src = fh.read()
        assert "retire_trace_return_cr14_gt" in src, (
            "core.py must declare retire_trace_return_cr14_gt for the RETURN CR14 fix"
        )

    def test_core_wires_return_cr14_valid_to_cload(self):
        """core.py wires retire_trace_return_cr14_valid via u_cload.cr_wr_en + CR_CLOOMC."""
        with open(_CORE_PY_PATH) as fh:
            src = fh.read()
        # Search for the .eq() assignment form — unique to the elaborate() wiring block
        wire_idx = src.find("retire_trace_return_cr14_valid.eq(")
        assert wire_idx != -1, (
            "core.py must have a .eq() assignment for retire_trace_return_cr14_valid"
        )
        ctx = src[wire_idx: wire_idx + 200]
        assert "cr_wr_en" in ctx, (
            "retire_trace_return_cr14_valid wiring must reference u_cload.cr_wr_en"
        )
        assert "CR_CLOOMC" in ctx, (
            "retire_trace_return_cr14_valid wiring must gate on CR_CLOOMC (==14)"
        )

    def test_core_wires_return_cr14_gt_to_cload_wr_data(self):
        """core.py wires retire_trace_return_cr14_gt from u_cload.cr_wr_data."""
        with open(_CORE_PY_PATH) as fh:
            src = fh.read()
        # Search for the .eq() assignment form — unique to the elaborate() wiring block
        wire_idx = src.find("retire_trace_return_cr14_gt.eq(")
        assert wire_idx != -1, (
            "core.py must have a .eq() assignment for retire_trace_return_cr14_gt"
        )
        ctx = src[wire_idx: wire_idx + 150]
        assert "cr_wr_data" in ctx, (
            "retire_trace_return_cr14_gt must be sourced from u_cload.cr_wr_data"
        )

    # ── wukong_top.py: SEND state patches tq_data[2] on the pulse ─────────────

    def test_wukong_top_send_state_patches_tq_data2(self):
        """wukong_top.py SEND state updates tq_data[2] when return_cr14_valid fires."""
        with open(_WUKONG_TOP_PATH) as fh:
            src = fh.read()
        send_idx = src.find('"SEND"')
        assert send_idx != -1, "SEND state not found in wukong_top.py"
        # retire_trace_return_cr14_valid must appear after the SEND state marker
        valid_in_send = src.find("retire_trace_return_cr14_valid", send_idx)
        assert valid_in_send != -1, (
            "wukong_top.py SEND state must reference retire_trace_return_cr14_valid "
            "to patch tq_data[2] with the restored caller CR14"
        )
        # tq_data[2] assignment must appear near the signal reference
        ctx = src[valid_in_send: valid_in_send + 200]
        assert "tq_data[2]" in ctx, (
            "wukong_top.py must assign tq_data[2] when retire_trace_return_cr14_valid fires"
        )

    def test_wukong_top_send_patches_with_return_cr14_gt(self):
        """wukong_top.py patches tq_data[2] with retire_trace_return_cr14_gt."""
        with open(_WUKONG_TOP_PATH) as fh:
            src = fh.read()
        send_idx = src.find('"SEND"')
        assert send_idx != -1
        valid_in_send = src.find("retire_trace_return_cr14_valid", send_idx)
        assert valid_in_send != -1
        ctx = src[valid_in_send: valid_in_send + 200]
        assert "retire_trace_return_cr14_gt" in ctx, (
            "wukong_top.py tq_data[2] patch must use core.retire_trace_return_cr14_gt"
        )
