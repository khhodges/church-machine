"""Tests for _extract_perm_check_module_body and _validate_verilog_perm_check_widths.

Both helpers are tested directly (bypassing gen_verilog.py's imports of
hardware.core / Amaranth) so the suite runs quickly and without FPGA tooling.

Observability model
-------------------
When check_seal or check_version are wired to constant 1'h0 in hardware/core.py,
Amaranth constant-folds the comparison and emits narrowed placeholder wire
declarations for the now-dead operands (e.g. ``wire [15:0] calculated_seal``
instead of ``wire [31:0] calculated_seal``).  The guard detects this case by
looking for the literal constant assignment::

    assign check_seal    = 1'h0;
    assign check_version = 1'h0;

When those lines appear, the width check for the corresponding signal family is
skipped (no false positives on current builds).  When those lines are absent,
the enable is driven by real logic and the correct declarations are enforced.

Coverage
--------
- Module body extraction: found / not-found / multiple-module Verilog texts
- Seal signals [31:0]:
    correct (no constant assign) → pass
    narrowed (no constant assign) → fail
    constant-zero assign present → skip (no error)
    only one of the pair present in body → correct behaviour per signal
- gt_seq signals [8:0]: same categories
- Combined seal + version observable simultaneously
- Empty / absent module body is always a no-op
- Round-trip: _extract → _validate with realistic Verilog text
"""

import sys
import pytest

sys.path.insert(0, ".")
from hardware.gen_verilog import (
    _extract_perm_check_module_body,
    _validate_verilog_perm_check_widths,
)


# ---------------------------------------------------------------------------
# Helpers — minimal Verilog fragments
# ---------------------------------------------------------------------------

def _perm_check_module(body_lines):
    """Wrap body lines in a syntactically minimal \\top.u_perm_check module."""
    inner = "\n".join(f"  {ln}" for ln in body_lines)
    return f"module \\top.u_perm_check (clk);\n{inner}\nendmodule\n"


def _surrounding_verilog(perm_check_body=""):
    """Return a Verilog snippet that includes the perm_check module plus noise."""
    prefix = (
        "module top (clk, rst);\n"
        "  input clk;\n"
        "  input rst;\n"
        "endmodule\n"
    )
    suffix = (
        "module \\top.u_decoder (clk);\n"
        "  input clk;\n"
        "endmodule\n"
    )
    return prefix + perm_check_body + suffix


def _seal_const_zero():
    return "assign check_seal = 1'h0;"


def _version_const_zero():
    return "assign check_version = 1'h0;"


# ---------------------------------------------------------------------------
# _extract_perm_check_module_body
# ---------------------------------------------------------------------------

class TestExtractPermCheckModuleBody:
    def test_returns_empty_when_module_absent(self):
        v = _surrounding_verilog()
        assert _extract_perm_check_module_body(v) == ""

    def test_returns_module_when_present(self):
        pc = _perm_check_module(["wire [31:0] calculated_seal;"])
        v = _surrounding_verilog(pc)
        body = _extract_perm_check_module_body(v)
        assert "u_perm_check" in body
        assert "calculated_seal" in body

    def test_does_not_include_other_modules(self):
        pc = _perm_check_module(["wire [31:0] stored_seal;"])
        v = _surrounding_verilog(pc)
        body = _extract_perm_check_module_body(v)
        assert "u_decoder" not in body

    def test_empty_string_input(self):
        assert _extract_perm_check_module_body("") == ""

    def test_returns_string_type(self):
        pc = _perm_check_module([])
        v = _surrounding_verilog(pc)
        result = _extract_perm_check_module_body(v)
        assert isinstance(result, str)


# ---------------------------------------------------------------------------
# _validate_verilog_perm_check_widths — empty / absent module
# ---------------------------------------------------------------------------

class TestValidateVerilogPermCheckWidthsEmpty:
    def test_empty_module_body_is_noop(self):
        _validate_verilog_perm_check_widths("", "dummy.v")

    def test_module_with_no_relevant_signals_is_noop(self):
        body = _perm_check_module(["wire perm_granted;", "wire fault_valid;"])
        _validate_verilog_perm_check_widths(body, "dummy.v")


# ---------------------------------------------------------------------------
# _validate_verilog_perm_check_widths — seal signals
# ---------------------------------------------------------------------------

class TestValidateVerilogSealSignals:
    def test_correct_seal_declarations_pass_when_observable(self):
        body = _perm_check_module([
            "wire [31:0] calculated_seal;",
            "wire [31:0] stored_seal;",
        ])
        _validate_verilog_perm_check_widths(body, "dummy.v")

    def test_narrowed_calculated_seal_fails_when_observable(self, capsys):
        body = _perm_check_module([
            "wire [15:0] calculated_seal;",
            "wire [31:0] stored_seal;",
        ])
        with pytest.raises(SystemExit) as exc_info:
            _validate_verilog_perm_check_widths(body, "dummy.v")
        assert exc_info.value.code == 1
        captured = capsys.readouterr()
        assert "calculated_seal" in captured.err
        assert "[31:0]" in captured.err

    def test_narrowed_stored_seal_fails_when_observable(self, capsys):
        body = _perm_check_module([
            "wire [31:0] calculated_seal;",
            "wire [15:0] stored_seal;",
        ])
        with pytest.raises(SystemExit) as exc_info:
            _validate_verilog_perm_check_widths(body, "dummy.v")
        assert exc_info.value.code == 1
        captured = capsys.readouterr()
        assert "stored_seal" in captured.err

    def test_both_seal_signals_narrowed_both_reported(self, capsys):
        body = _perm_check_module([
            "wire [7:0] calculated_seal;",
            "wire [7:0] stored_seal;",
        ])
        with pytest.raises(SystemExit):
            _validate_verilog_perm_check_widths(body, "dummy.v")
        captured = capsys.readouterr()
        assert "calculated_seal" in captured.err
        assert "stored_seal" in captured.err

    def test_narrowed_seal_signals_skipped_when_check_seal_constant_zero(self):
        """Amaranth-emitted narrowed placeholders must not false-positive when check_seal=1'h0."""
        body = _perm_check_module([
            "wire [15:0] calculated_seal;",
            "wire [15:0] stored_seal;",
            "wire check_seal;",
            _seal_const_zero(),
            "assign calculated_seal = 16'h0000;",
            "assign stored_seal = 16'h0000;",
        ])
        _validate_verilog_perm_check_widths(body, "dummy.v")

    def test_only_calculated_seal_in_body_correct_declaration(self):
        body = _perm_check_module(["wire [31:0] calculated_seal;"])
        _validate_verilog_perm_check_widths(body, "dummy.v")

    def test_only_stored_seal_in_body_correct_declaration(self):
        body = _perm_check_module(["wire [31:0] stored_seal;"])
        _validate_verilog_perm_check_widths(body, "dummy.v")


# ---------------------------------------------------------------------------
# _validate_verilog_perm_check_widths — gt_seq signals
# ---------------------------------------------------------------------------

class TestValidateVerilogGtSeqSignals:
    def test_correct_gt_seq_declarations_pass_when_observable(self):
        body = _perm_check_module([
            "wire [8:0] gt_seq;",
            "wire [8:0] stored_gt_seq;",
        ])
        _validate_verilog_perm_check_widths(body, "dummy.v")

    def test_narrowed_gt_seq_fails_when_observable(self, capsys):
        body = _perm_check_module([
            "wire [7:0] gt_seq;",
            "wire [8:0] stored_gt_seq;",
        ])
        with pytest.raises(SystemExit) as exc_info:
            _validate_verilog_perm_check_widths(body, "dummy.v")
        assert exc_info.value.code == 1
        captured = capsys.readouterr()
        assert "gt_seq" in captured.err
        assert "[8:0]" in captured.err

    def test_narrowed_stored_gt_seq_fails_when_observable(self, capsys):
        body = _perm_check_module([
            "wire [8:0] gt_seq;",
            "wire [7:0] stored_gt_seq;",
        ])
        with pytest.raises(SystemExit) as exc_info:
            _validate_verilog_perm_check_widths(body, "dummy.v")
        assert exc_info.value.code == 1
        captured = capsys.readouterr()
        assert "stored_gt_seq" in captured.err

    def test_narrowed_gt_seq_skipped_when_check_version_constant_zero(self):
        """Amaranth-emitted narrowed placeholders must not false-positive when check_version=1'h0."""
        body = _perm_check_module([
            "wire [6:0] gt_seq;",
            "wire [6:0] stored_gt_seq;",
            "wire check_version;",
            _version_const_zero(),
            "assign gt_seq = 7'h00;",
            "assign stored_gt_seq = 7'h00;",
        ])
        _validate_verilog_perm_check_widths(body, "dummy.v")

    def test_only_gt_seq_in_body_correct_declaration(self):
        body = _perm_check_module(["wire [8:0] gt_seq;"])
        _validate_verilog_perm_check_widths(body, "dummy.v")

    def test_only_stored_gt_seq_in_body_correct_declaration(self):
        body = _perm_check_module(["wire [8:0] stored_gt_seq;"])
        _validate_verilog_perm_check_widths(body, "dummy.v")


# ---------------------------------------------------------------------------
# _validate_verilog_perm_check_widths — combined families
# ---------------------------------------------------------------------------

class TestValidateVerilogCombined:
    def test_all_four_signals_correct_and_observable_pass(self):
        body = _perm_check_module([
            "wire [31:0] calculated_seal;",
            "wire [31:0] stored_seal;",
            "wire [8:0] gt_seq;",
            "wire [8:0] stored_gt_seq;",
        ])
        _validate_verilog_perm_check_widths(body, "dummy.v")

    def test_one_seal_one_seq_narrowed_both_reported(self, capsys):
        body = _perm_check_module([
            "wire [15:0] calculated_seal;",
            "wire [31:0] stored_seal;",
            "wire [7:0] gt_seq;",
            "wire [8:0] stored_gt_seq;",
        ])
        with pytest.raises(SystemExit):
            _validate_verilog_perm_check_widths(body, "dummy.v")
        captured = capsys.readouterr()
        assert "calculated_seal" in captured.err
        assert "gt_seq" in captured.err

    def test_both_const_zero_skips_all_width_checks(self):
        """Current build with both enables constant-zero: no false positives."""
        body = _perm_check_module([
            "wire [15:0] calculated_seal;",
            "wire [15:0] stored_seal;",
            "wire [6:0] gt_seq;",
            "wire [6:0] stored_gt_seq;",
            "wire check_seal;",
            "wire check_version;",
            _seal_const_zero(),
            _version_const_zero(),
            "assign calculated_seal = 16'h0000;",
            "assign stored_seal = 16'h0000;",
            "assign gt_seq = 7'h00;",
            "assign stored_gt_seq = 7'h00;",
        ])
        _validate_verilog_perm_check_widths(body, "dummy.v")

    def test_only_seal_const_zero_still_checks_gt_seq(self, capsys):
        """Seal skipped (constant), gt_seq observable and narrowed — must fail."""
        body = _perm_check_module([
            "wire [15:0] calculated_seal;",
            "wire [15:0] stored_seal;",
            "wire [7:0] gt_seq;",
            "wire [7:0] stored_gt_seq;",
            _seal_const_zero(),
        ])
        with pytest.raises(SystemExit) as exc_info:
            _validate_verilog_perm_check_widths(body, "dummy.v")
        assert exc_info.value.code == 1
        captured = capsys.readouterr()
        assert "gt_seq" in captured.err
        assert "calculated_seal" not in captured.err

    def test_only_version_const_zero_still_checks_seal(self, capsys):
        """gt_seq skipped (constant), seal observable and narrowed — must fail."""
        body = _perm_check_module([
            "wire [15:0] calculated_seal;",
            "wire [15:0] stored_seal;",
            "wire [6:0] gt_seq;",
            "wire [6:0] stored_gt_seq;",
            _version_const_zero(),
        ])
        with pytest.raises(SystemExit) as exc_info:
            _validate_verilog_perm_check_widths(body, "dummy.v")
        assert exc_info.value.code == 1
        captured = capsys.readouterr()
        assert "calculated_seal" in captured.err
        assert "gt_seq" not in captured.err

    def test_error_message_names_output_path(self, capsys):
        body = _perm_check_module(["wire [7:0] calculated_seal;"])
        with pytest.raises(SystemExit):
            _validate_verilog_perm_check_widths(body, "build/church_core.v")
        captured = capsys.readouterr()
        assert "build/church_core.v" in captured.err


# ---------------------------------------------------------------------------
# Integration: _extract → _validate round-trip
# ---------------------------------------------------------------------------

class TestExtractThenValidateRoundtrip:
    def test_absent_module_means_no_op(self):
        v = _surrounding_verilog()
        body = _extract_perm_check_module_body(v)
        _validate_verilog_perm_check_widths(body, "dummy.v")

    def test_current_build_pattern_is_noop(self):
        """Simulate the exact pattern Amaranth emits today (check_* = 1'h0, narrowed wires)."""
        pc = _perm_check_module([
            "wire [15:0] calculated_seal;",
            "wire [15:0] stored_seal;",
            "wire [6:0] gt_seq;",
            "wire [6:0] stored_gt_seq;",
            "wire check_seal;",
            "wire check_version;",
            "assign check_seal = 1'h0;",
            "assign check_version = 1'h0;",
            "assign calculated_seal = 16'h0000;",
            "assign stored_seal = 16'h0000;",
            "assign gt_seq = 7'h00;",
            "assign stored_gt_seq = 7'h00;",
        ])
        v = _surrounding_verilog(pc)
        body = _extract_perm_check_module_body(v)
        _validate_verilog_perm_check_widths(body, "dummy.v")

    def test_active_seal_correct_widths_pass(self):
        """Simulates a future build where check_seal is connected to real logic."""
        pc = _perm_check_module([
            "input check_seal;",
            "wire [31:0] calculated_seal;",
            "wire [31:0] stored_seal;",
        ])
        v = _surrounding_verilog(pc)
        body = _extract_perm_check_module_body(v)
        _validate_verilog_perm_check_widths(body, "dummy.v")

    def test_active_seal_narrowed_fails(self, capsys):
        """Simulates a regression: check_seal active but seal signals still narrowed."""
        pc = _perm_check_module([
            "input check_seal;",
            "wire [15:0] calculated_seal;",
            "wire [15:0] stored_seal;",
        ])
        v = _surrounding_verilog(pc)
        body = _extract_perm_check_module_body(v)
        with pytest.raises(SystemExit) as exc_info:
            _validate_verilog_perm_check_widths(body, "dummy.v")
        assert exc_info.value.code == 1

    def test_active_version_narrowed_fails(self, capsys):
        """Simulates a regression: check_version active but gt_seq signals still narrowed."""
        pc = _perm_check_module([
            "input check_version;",
            "wire [7:0] gt_seq;",
            "wire [7:0] stored_gt_seq;",
        ])
        v = _surrounding_verilog(pc)
        body = _extract_perm_check_module_body(v)
        with pytest.raises(SystemExit) as exc_info:
            _validate_verilog_perm_check_widths(body, "dummy.v")
        assert exc_info.value.code == 1
        captured = capsys.readouterr()
        assert "gt_seq" in captured.err


# ---------------------------------------------------------------------------
# Integration: validate against the actual build artifact (if present)
# ---------------------------------------------------------------------------

class TestActualBuildArtifact:
    def test_real_generated_verilog_passes(self):
        """Guard must not fire on the current build/church_core.v output."""
        import os
        verilog_path = os.path.join(
            os.path.dirname(__file__), "..", "..", "build", "church_core.v"
        )
        if not os.path.exists(verilog_path):
            pytest.skip("build/church_core.v not present — run gen_verilog first")
        with open(verilog_path, encoding="utf-8") as f:
            verilog_text = f.read()
        body = _extract_perm_check_module_body(verilog_text)
        _validate_verilog_perm_check_widths(body, verilog_path)
