#!/usr/bin/env python3
"""
test_callhome_parser.py — CI dry-run parser tests for callhome_bridge.py
=========================================================================

Imports the parser functions from callhome_bridge and validates them against
the canned transcript in test_ti60_uart_transcript.txt.

Run with:
    python -m pytest scripts/test_callhome_parser.py -v

No serial hardware required — this is a pure-Python CI test.

Test groups
-----------
  TestGreetingParser      — is_greeting()
  TestNiaParser           — parse_nia()
  TestCallhomeParser      — parse_callhome() + validate_callhome()
  TestTraceParser         — parse_trace()
  TestFaultEventParser    — parse_fault_event()
  TestHungParser          — parse_hung()
  TestTranscriptCoverage  — all 6 line types appear in the canned transcript
  TestNegativeCases       — malformed JSON, unknown prefixes, missing fields
"""

import os
import sys
import json
import pytest

# ---------------------------------------------------------------------------
# Import bridge parsers
# ---------------------------------------------------------------------------
_SCRIPTS_DIR = os.path.dirname(os.path.abspath(__file__))
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)

from callhome_bridge import (
    is_greeting,
    parse_nia,
    parse_callhome,
    validate_callhome,
    parse_trace,
    parse_fault_event,
    parse_hung,
    _GREETING_MARKER,
)

# ---------------------------------------------------------------------------
# Load the canned transcript
# ---------------------------------------------------------------------------
_TRANSCRIPT_PATH = os.path.join(_SCRIPTS_DIR, "test_ti60_uart_transcript.txt")

def _load_transcript():
    """Return all non-blank, non-comment lines from the transcript file."""
    lines = []
    with open(_TRANSCRIPT_PATH, encoding="utf-8") as fh:
        for raw in fh:
            stripped = raw.rstrip("\n")
            if stripped and not stripped.startswith("#"):
                lines.append(stripped)
    return lines

TRANSCRIPT_LINES = _load_transcript()


# ===========================================================================
# TestGreetingParser
# ===========================================================================

class TestGreetingParser:

    def test_greeting_detected_in_transcript(self):
        greetings = [l for l in TRANSCRIPT_LINES if is_greeting(l)]
        assert len(greetings) >= 1, "No GREETING line found in transcript"

    def test_exact_greeting_string(self):
        assert is_greeting("CM:WUKONG")

    def test_greeting_future_version(self):
        assert is_greeting("WUKONG\r\n")

    def test_non_greeting_lines_rejected(self):
        assert not is_greeting("NIA=0x00000042")
        assert not is_greeting("CALLHOME:{}")
        assert not is_greeting("TRACE:[]")
        assert not is_greeting("")
        assert not is_greeting("CHURCH MACHINE v1")

    def test_greeting_case_sensitive(self):
        assert not is_greeting("wukong")

    # ------------------------------------------------------------------
    # Auto-detect byte-stream coverage
    # ------------------------------------------------------------------

    def test_rtl_banner_byte_stream_triggers_detection(self):
        """RTL boot FSM banner b"WUKONG\r\n" must match _GREETING_MARKER."""
        buf = b"WUKONG\r\n"
        assert _GREETING_MARKER in buf

    def test_firmware_banner_byte_stream_triggers_detection(self):
        """Sapphire SoC firmware banner b"CM:WUKONG\r\n" must match _GREETING_MARKER."""
        buf = b"CM:WUKONG\r\n"
        assert _GREETING_MARKER in buf

    def test_both_banners_in_combined_buffer_trigger_detection(self):
        """When both banners arrive in the same serial read, detection still fires."""
        buf = b"WUKONG\r\nUID=c0ffee0100000001\r\nCM:WUKONG\r\n"
        assert _GREETING_MARKER in buf

    def test_unrelated_device_output_does_not_trigger_detection(self):
        """Noise from another USB-serial device must not match _GREETING_MARKER."""
        buf = b"AT OK\r\nCOMMAND READY\r\n"
        assert _GREETING_MARKER not in buf

    def test_rtl_banner_is_greeting_str(self):
        """is_greeting() accepts the decoded RTL banner string."""
        assert is_greeting("WUKONG")

    def test_firmware_banner_is_greeting_str(self):
        """is_greeting() accepts the decoded firmware banner string."""
        assert is_greeting("CM:WUKONG")


# ===========================================================================
# TestNiaParser
# ===========================================================================

class TestNiaParser:

    def test_nia_found_in_transcript(self):
        nias = [parse_nia(l) for l in TRANSCRIPT_LINES if parse_nia(l) is not None]
        assert len(nias) >= 1, "No NIA= line found in transcript"

    def test_nia_value_extraction(self):
        assert parse_nia("NIA=0x00000042") == "0x00000042"

    def test_nia_different_address(self):
        assert parse_nia("NIA=0x0000abcd") == "0x0000abcd"

    def test_nia_rejects_non_nia_lines(self):
        assert parse_nia("CALLHOME:{}") is None
        assert parse_nia("TRACE:[]") is None
        assert parse_nia("NIA without hex") is None
        assert parse_nia("") is None

    def test_nia_requires_hex_prefix(self):
        assert parse_nia("NIA=12345") is None


# ===========================================================================
# TestCallhomeParser
# ===========================================================================

class TestCallhomeParser:

    def _good_callhome_lines(self):
        return [l for l in TRANSCRIPT_LINES
                if l.startswith("CALLHOME:") and parse_callhome(l) is not None]

    def test_at_least_one_valid_callhome_in_transcript(self):
        assert len(self._good_callhome_lines()) >= 1

    def test_callhome_with_ns_manifest_parsed(self):
        line = next(
            l for l in TRANSCRIPT_LINES
            if l.startswith("CALLHOME:") and "ns_manifest" in l
        )
        pkt = parse_callhome(line)
        assert pkt is not None
        assert pkt["board"] == "Ti60F225"
        assert pkt["uid"] == "c0ffee0100000001"
        assert pkt["nia"] == "0x00000042"
        assert pkt["boot_ok"] == 1
        assert pkt["fault"] == 0
        assert pkt["fault_code"] == 0
        manifest = pkt.get("ns_manifest")
        assert isinstance(manifest, list) and len(manifest) == 2

    def test_callhome_without_ns_manifest_parsed(self):
        line = next(
            l for l in TRANSCRIPT_LINES
            if l.startswith("CALLHOME:") and "ns_manifest" not in l
               and parse_callhome(l) is not None
        )
        pkt = parse_callhome(line)
        assert pkt is not None
        assert pkt["fw_major"] == 2

    def test_callhome_with_fault_set_parsed(self):
        line = next(
            l for l in TRANSCRIPT_LINES
            if l.startswith("CALLHOME:") and '"fault":1' in l
        )
        pkt = parse_callhome(line)
        assert pkt is not None
        assert pkt["fault"] == 1
        assert pkt["fault_code"] == 3
        assert pkt["fault_name"] == "PERM_X"

    def test_callhome_required_fields(self):
        for line in self._good_callhome_lines():
            pkt = parse_callhome(line)
            for field in ("board", "uid", "nia", "boot_ok", "fault", "fault_code"):
                assert field in pkt, f"Required field {field!r} missing"

    def test_validate_callhome_good_packet(self):
        line = self._good_callhome_lines()[0]
        pkt = parse_callhome(line)
        errors = validate_callhome(pkt)
        assert errors == [], f"Unexpected validation errors: {errors}"

    def test_callhome_rejects_non_prefix(self):
        assert parse_callhome("NIA=0x42") is None
        assert parse_callhome("TRACE:[]") is None
        assert parse_callhome("") is None

    def test_callhome_rejects_malformed_json(self):
        assert parse_callhome("CALLHOME:{not valid json at all") is None

    def test_callhome_rejects_missing_required_fields(self):
        line = 'CALLHOME:{"board":"Ti60F225","uid":"c0ffee0100000001"}'
        assert parse_callhome(line) is None

    def test_validate_callhome_wrong_boot_ok_type(self):
        pkt = {
            "board": "Ti60F225", "uid": "c0ffee01",
            "nia": "0x42", "boot_ok": "yes",
            "fault": 0, "fault_code": 0,
        }
        errors = validate_callhome(pkt)
        assert any("boot_ok" in e for e in errors)

    def test_validate_callhome_fault_code_out_of_range(self):
        pkt = {
            "board": "Ti60F225", "uid": "c0ffee01",
            "nia": "0x42", "boot_ok": 1,
            "fault": 0, "fault_code": 99,
        }
        errors = validate_callhome(pkt)
        assert any("fault_code" in e for e in errors)

    def test_validate_callhome_invalid_uid_length(self):
        pkt = {
            "board": "Ti60F225", "uid": "short",
            "nia": "0x42", "boot_ok": 1,
            "fault": 0, "fault_code": 0,
        }
        errors = validate_callhome(pkt)
        assert any("uid" in e for e in errors)

    def test_validate_callhome_nia_without_0x(self):
        pkt = {
            "board": "Ti60F225", "uid": "c0ffee01",
            "nia": "12345", "boot_ok": 1,
            "fault": 0, "fault_code": 0,
        }
        errors = validate_callhome(pkt)
        assert any("nia" in e for e in errors)


# ===========================================================================
# TestTraceParser
# ===========================================================================

class TestTraceParser:

    def test_trace_found_in_transcript(self):
        traces = [parse_trace(l) for l in TRANSCRIPT_LINES if parse_trace(l) is not None]
        assert len(traces) >= 1, "No TRACE: line found in transcript"

    def test_trace_returns_list(self):
        line = next(l for l in TRANSCRIPT_LINES if l.startswith("TRACE:") and parse_trace(l))
        result = parse_trace(line)
        assert isinstance(result, list)
        assert len(result) > 0

    def test_trace_entries_are_hex_strings(self):
        line = next(l for l in TRANSCRIPT_LINES if l.startswith("TRACE:") and parse_trace(l))
        result = parse_trace(line)
        for entry in result:
            assert isinstance(entry, str), f"Expected str, got {type(entry)}"
            assert entry.startswith("0x"), f"Expected 0x prefix, got {entry!r}"

    def test_trace_ten_samples(self):
        line = next(l for l in TRANSCRIPT_LINES if l.startswith("TRACE:") and parse_trace(l))
        result = parse_trace(line)
        assert len(result) == 10

    def test_trace_rejects_non_prefix(self):
        assert parse_trace("CALLHOME:{}") is None
        assert parse_trace("NIA=0x42") is None
        assert parse_trace("") is None

    def test_trace_rejects_malformed_json(self):
        assert parse_trace("TRACE:[1,2,missing-quote") is None

    def test_trace_rejects_empty_array(self):
        assert parse_trace("TRACE:[]") is None

    def test_trace_rejects_non_array_json(self):
        assert parse_trace('TRACE:{"key":"value"}') is None


# ===========================================================================
# TestFaultEventParser
# ===========================================================================

class TestFaultEventParser:

    def _good_fault_lines(self):
        return [l for l in TRANSCRIPT_LINES
                if l.startswith("FAULT_EVENT:") and parse_fault_event(l) is not None]

    def test_fault_event_found_in_transcript(self):
        assert len(self._good_fault_lines()) >= 1, \
            "No FAULT_EVENT: line found in transcript"

    def test_fault_event_full_fields_parsed(self):
        line = next(l for l in TRANSCRIPT_LINES
                    if l.startswith("FAULT_EVENT:") and "fault_gt" in l)
        pkt = parse_fault_event(line)
        assert pkt is not None
        assert pkt["uid"] == "c0ffee0100000001"
        assert pkt["nia"] == "0x0000004c"
        assert pkt["fault_code"] == 3
        assert pkt["fault_name"] == "PERM_X"
        assert pkt["fault_gt"] == "0x01800003"
        assert pkt["fault_instr"] == "0x12345678"
        assert pkt["fault_cr14"] == "0x00000010"
        assert pkt["fault_stage"] == 2

    def test_fault_event_minimal_fields_parsed(self):
        line = next(l for l in TRANSCRIPT_LINES
                    if l.startswith("FAULT_EVENT:") and "fault_name" in l
                    and "fault_gt" not in l and parse_fault_event(l) is not None)
        pkt = parse_fault_event(line)
        assert pkt is not None
        assert pkt["fault_name"] == "BOUNDS"

    def test_fault_event_required_fields(self):
        for line in self._good_fault_lines():
            pkt = parse_fault_event(line)
            for field in ("uid", "nia", "fault_code", "fault_name"):
                assert field in pkt, f"Required field {field!r} missing"

    def test_fault_event_rejects_non_prefix(self):
        assert parse_fault_event("CALLHOME:{}") is None
        assert parse_fault_event("HUNG:{}") is None
        assert parse_fault_event("") is None

    def test_fault_event_rejects_malformed_json(self):
        assert parse_fault_event("FAULT_EVENT:{uid: missing_quotes}") is None

    def test_fault_event_rejects_missing_required_fields(self):
        line = 'FAULT_EVENT:{"uid":"c0ffee0100000001","nia":"0x00000042"}'
        assert parse_fault_event(line) is None


# ===========================================================================
# TestFaultEventGTSnapshot — v1.2 §3 gt_snapshot and pet_names extension
# ===========================================================================

class TestFaultEventGTSnapshot:
    """Tests for the additive gt_snapshot and pet_names fields in FAULT_EVENT."""

    def _gt_snapshot_line(self):
        """Return the transcript line that carries gt_snapshot and pet_names."""
        return next(
            l for l in TRANSCRIPT_LINES
            if l.startswith("FAULT_EVENT:") and "gt_snapshot" in l
        )

    def test_gt_snapshot_line_present_in_transcript(self):
        lines = [l for l in TRANSCRIPT_LINES
                 if l.startswith("FAULT_EVENT:") and "gt_snapshot" in l]
        assert len(lines) >= 1, "No FAULT_EVENT with gt_snapshot found in transcript"

    def test_gt_snapshot_parsed_as_dict(self):
        pkt = parse_fault_event(self._gt_snapshot_line())
        assert pkt is not None
        snap = pkt.get("gt_snapshot")
        assert isinstance(snap, dict), f"gt_snapshot should be dict, got {type(snap)}"

    def test_gt_snapshot_contains_expected_registers(self):
        pkt = parse_fault_event(self._gt_snapshot_line())
        snap = pkt["gt_snapshot"]
        assert "CR0" in snap
        assert "CR6" in snap
        assert "CR14" in snap

    def test_gt_snapshot_values_are_hex_strings(self):
        pkt = parse_fault_event(self._gt_snapshot_line())
        for reg, val in pkt["gt_snapshot"].items():
            assert isinstance(val, str), f"{reg} value should be string"
            assert val.startswith("0x"), f"{reg} value should start with 0x, got {val!r}"

    def test_pet_names_parsed_as_dict(self):
        pkt = parse_fault_event(self._gt_snapshot_line())
        assert pkt is not None
        pnames = pkt.get("pet_names")
        assert isinstance(pnames, dict), f"pet_names should be dict, got {type(pnames)}"

    def test_pet_names_contains_expected_entries(self):
        pkt = parse_fault_event(self._gt_snapshot_line())
        pnames = pkt["pet_names"]
        assert pnames.get("CR3") == "LED"
        assert pnames.get("DR0") == "counter"

    def test_required_fields_still_present_with_extension(self):
        pkt = parse_fault_event(self._gt_snapshot_line())
        for field in ("uid", "nia", "fault_code", "fault_name"):
            assert field in pkt, f"Required field {field!r} missing alongside extension fields"

    def test_extension_fields_absent_in_minimal_record(self):
        """A minimal FAULT_EVENT without gt_snapshot/pet_names still parses fine."""
        line = 'FAULT_EVENT:{"uid":"c0ffee0100000001","nia":"0x00000099","fault_code":1,"fault_name":"BOUNDS"}'
        pkt = parse_fault_event(line)
        assert pkt is not None
        assert pkt.get("gt_snapshot") is None
        assert pkt.get("pet_names") is None

    def test_inline_gt_snapshot_without_transcript(self):
        """Inline round-trip: build a line with gt_snapshot and verify parse."""
        payload = {
            "uid": "deadbeefdeadbeef",
            "nia": "0x00000100",
            "fault_code": 5,
            "fault_name": "PERM_L",
            "gt_snapshot": {"CR0": "0x4A000006", "CR14": "0x52000003"},
            "pet_names": {"CR0": "myAbstr", "DR1": "loopCount"},
        }
        line = "FAULT_EVENT:" + json.dumps(payload)
        pkt = parse_fault_event(line)
        assert pkt is not None
        assert pkt["gt_snapshot"] == {"CR0": "0x4A000006", "CR14": "0x52000003"}
        assert pkt["pet_names"] == {"CR0": "myAbstr", "DR1": "loopCount"}


# ===========================================================================
# TestHungParser
# ===========================================================================

class TestHungParser:

    def test_hung_found_in_transcript(self):
        hungs = [parse_hung(l) for l in TRANSCRIPT_LINES if parse_hung(l) is not None]
        assert len(hungs) >= 1, "No HUNG: line found in transcript"

    def test_hung_fields_parsed(self):
        line = next(l for l in TRANSCRIPT_LINES if l.startswith("HUNG:") and parse_hung(l))
        pkt = parse_hung(line)
        assert pkt is not None
        assert pkt["uid"] == "c0ffee0100000001"
        assert pkt["nia"] == "0x0000abcd"
        assert pkt["loops"] == 3

    def test_hung_rejects_non_prefix(self):
        assert parse_hung("FAULT_EVENT:{}") is None
        assert parse_hung("CALLHOME:{}") is None
        assert parse_hung("") is None

    def test_hung_rejects_malformed_json(self):
        assert parse_hung("HUNG:{uid:no_quotes}") is None

    def test_hung_rejects_missing_required_fields(self):
        line = 'HUNG:{"uid":"c0ffee0100000001"}'
        assert parse_hung(line) is None


# ===========================================================================
# TestTranscriptCoverage — verify all 6 line types are in the transcript
# ===========================================================================

class TestTranscriptCoverage:
    """Assert that the canned transcript exercises every protocol line type."""

    def test_greeting_line_present(self):
        assert any(is_greeting(l) for l in TRANSCRIPT_LINES)

    def test_nia_line_present(self):
        assert any(parse_nia(l) is not None for l in TRANSCRIPT_LINES)

    def test_callhome_line_present(self):
        assert any(parse_callhome(l) is not None for l in TRANSCRIPT_LINES)

    def test_callhome_with_ns_manifest_present(self):
        assert any(
            parse_callhome(l) is not None and parse_callhome(l).get("ns_manifest")
            for l in TRANSCRIPT_LINES
        )

    def test_trace_line_present(self):
        assert any(parse_trace(l) is not None for l in TRANSCRIPT_LINES)

    def test_fault_event_line_present(self):
        assert any(parse_fault_event(l) is not None for l in TRANSCRIPT_LINES)

    def test_hung_line_present(self):
        assert any(parse_hung(l) is not None for l in TRANSCRIPT_LINES)

    def test_transcript_has_negative_cases(self):
        """At least one line in the transcript must be an unrecognised prefix."""
        unrecognised = [
            l for l in TRANSCRIPT_LINES
            if not is_greeting(l)
            and parse_nia(l) is None
            and not l.startswith("CALLHOME:")
            and not l.startswith("TRACE:")
            and not l.startswith("FAULT_EVENT:")
            and not l.startswith("HUNG:")
            and not l.startswith("UID=")
        ]
        assert len(unrecognised) >= 1, \
            "Transcript has no unrecognised / negative-case lines"


# ===========================================================================
# TestNegativeCases — parsers must reject bad input cleanly
# ===========================================================================

class TestNegativeCases:
    """All parsers must return None for malformed or irrelevant input."""

    _MALFORMED = [
        "CALLHOME:{not valid json at all",
        "TRACE:[1,2,missing-quote",
        "FAULT_EVENT:{uid: missing_quotes}",
        "HUNG:{uid:no_quotes}",
    ]

    _UNKNOWN_PREFIXES = [
        'UNKNOWN:{"some":"data"}',
        "DEBUG: internal message",
        "  leading whitespace line",
        "raw text with no prefix",
    ]

    def test_callhome_rejects_all_malformed(self):
        for line in self._MALFORMED:
            assert parse_callhome(line) is None, \
                f"parse_callhome should reject {line!r}"

    def test_trace_rejects_all_malformed(self):
        for line in self._MALFORMED:
            assert parse_trace(line) is None, \
                f"parse_trace should reject {line!r}"

    def test_fault_event_rejects_all_malformed(self):
        for line in self._MALFORMED:
            assert parse_fault_event(line) is None, \
                f"parse_fault_event should reject {line!r}"

    def test_hung_rejects_all_malformed(self):
        for line in self._MALFORMED:
            assert parse_hung(line) is None, \
                f"parse_hung should reject {line!r}"

    def test_all_parsers_reject_unknown_prefixes(self):
        for line in self._UNKNOWN_PREFIXES:
            assert not is_greeting(line), f"is_greeting false-positive: {line!r}"
            assert parse_nia(line) is None, f"parse_nia false-positive: {line!r}"
            assert parse_callhome(line) is None, f"parse_callhome false-positive: {line!r}"
            assert parse_trace(line) is None, f"parse_trace false-positive: {line!r}"
            assert parse_fault_event(line) is None, \
                f"parse_fault_event false-positive: {line!r}"
            assert parse_hung(line) is None, f"parse_hung false-positive: {line!r}"

    def test_all_parsers_handle_empty_string(self):
        assert not is_greeting("")
        assert parse_nia("") is None
        assert parse_callhome("") is None
        assert parse_trace("") is None
        assert parse_fault_event("") is None
        assert parse_hung("") is None

    def test_callhome_missing_fields_from_transcript(self):
        """Lines in the transcript tagged as MISSING_FIELDS must be rejected."""
        missing_line = 'CALLHOME:{"board":"Ti60F225","uid":"c0ffee0100000001"}'
        assert parse_callhome(missing_line) is None

    def test_fault_event_missing_fields_from_transcript(self):
        missing_line = 'FAULT_EVENT:{"uid":"c0ffee0100000001","nia":"0x00000042"}'
        assert parse_fault_event(missing_line) is None

    def test_hung_missing_fields_from_transcript(self):
        missing_line = 'HUNG:{"uid":"c0ffee0100000001"}'
        assert parse_hung(missing_line) is None
