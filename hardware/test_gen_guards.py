"""Tests for gen_verilog.py generation-time guards.

Two guard families are tested here:

1. Boot-state CR assignment guard (_check_boot_thrd_cr)
   Verifies that the INIT_THRD boot state writes the thread GT into CR12
   (not CR8).  Relies on Amaranth emitting actively-driven signals as
   ``reg`` and constant-zero defaults as ``wire ... assign ... = 1'h0``.

2. Perm-check signal width guard (_check_perm_check_widths /
   _validate_perm_check_widths)
   Verifies that ChurchPermCheck.gt_seq / stored_gt_seq are \u2265 9 bits and
   ChurchPermCheck.calculated_seal / stored_seal are \u2265 32 bits.  The check
   reads the Python Signal() declarations directly because Amaranth may
   optimise away unconnected signals in the generated .v file.

Run with:  python -m pytest hardware/test_gen_guards.py -v
       or:  python -m hardware.test_gen_guards
"""

import os
import sys
import pytest

from .gen_verilog import (
    _check_boot_thrd_cr,
    _BOOT_THRD_MUST_HAVE,
    _BOOT_THRD_MUST_NOT,
    _check_perm_check_widths,
    _validate_perm_check_widths,
    _PERM_CHECK_GT_SEQ_MIN_BITS,
    _PERM_CHECK_SEAL_MIN_BITS,
)


# ---------------------------------------------------------------------------
# Synthetic Verilog fragments that mirror the structure Amaranth actually emits
# ---------------------------------------------------------------------------

# Correct build: CR12 is a reg (actively driven by the boot state machine);
# CR8 is only a wire tied to 1'h0.
_CORRECT_VERILOG = """\
module top(input clk, input rst);
  reg boot_cap12_wr_en;
  reg [31:0] boot_cap12_wr_gt;
  wire boot_cap8_wr_en;
  assign boot_cap8_wr_en = 1'h0;
  assign cr12_gt_wr_en = boot_cap12_wr_en;
  always @(posedge clk) begin
    boot_cap12_wr_en = 1'h0;
    case (boot_state)
      3'h3: boot_cap12_wr_en = 1'h1;
    endcase
  end
endmodule
"""

# Regression: CR8 is now a reg (actively driven); CR12 has been demoted to
# a wire tied to 1'h0.  This is the exact pattern the guard must catch.
_REGRESSED_CR8_VERILOG = """\
module top(input clk, input rst);
  reg boot_cap8_wr_en;
  reg [31:0] boot_cap8_wr_gt;
  wire boot_cap12_wr_en;
  assign boot_cap12_wr_en = 1'h0;
  assign cr8_gt_wr_en = boot_cap8_wr_en;
  always @(posedge clk) begin
    boot_cap8_wr_en = 1'h0;
    case (boot_state)
      3'h3: boot_cap8_wr_en = 1'h1;
    endcase
  end
endmodule
"""

# Neither CR12 nor CR8 is a reg — INIT_THRD block was accidentally removed
# entirely.
_MISSING_THRD_VERILOG = """\
module top(input clk, input rst);
  wire boot_cap12_wr_en;
  wire boot_cap8_wr_en;
  assign boot_cap12_wr_en = 1'h0;
  assign boot_cap8_wr_en  = 1'h0;
  assign cr14_gt_wr_en = boot_cap14_wr_en;
endmodule
"""

_FAKE_PATH = "build/church_core.v"


# ---------------------------------------------------------------------------
# Tests — guard passes on correct Verilog
# ---------------------------------------------------------------------------

class TestBootThrdCrGuardPasses:
    def test_correct_verilog_does_not_exit(self):
        """No SystemExit when reg CR12 is present and reg CR8 is absent."""
        _check_boot_thrd_cr(_CORRECT_VERILOG, _FAKE_PATH)

    def test_real_generated_verilog_passes(self):
        """Guard passes on the actual church_core.v if it exists in build/."""
        build_path = os.path.join(
            os.path.dirname(os.path.dirname(__file__)), "build", "church_core.v"
        )
        if not os.path.exists(build_path):
            pytest.skip("build/church_core.v not present — run gen_verilog first")
        with open(build_path) as f:
            verilog_text = f.read()
        _check_boot_thrd_cr(verilog_text, build_path)

    def test_real_generated_iot_verilog_passes(self):
        """Guard passes on the actual church_core_iot.v if it exists in build/."""
        build_path = os.path.join(
            os.path.dirname(os.path.dirname(__file__)), "build", "church_core_iot.v"
        )
        if not os.path.exists(build_path):
            pytest.skip("build/church_core_iot.v not present — run gen_verilog first")
        with open(build_path) as f:
            verilog_text = f.read()
        _check_boot_thrd_cr(verilog_text, build_path)


# ---------------------------------------------------------------------------
# Tests — guard fires on mutated / incorrect Verilog
# ---------------------------------------------------------------------------

class TestBootThrdCrGuardFires:
    def test_fires_when_cr12_is_wire_not_reg(self):
        """SystemExit(1) when boot_cap12_wr_en is only a wire (never driven)."""
        with pytest.raises(SystemExit) as exc_info:
            _check_boot_thrd_cr(_MISSING_THRD_VERILOG, _FAKE_PATH)
        assert exc_info.value.code == 1

    def test_fires_when_cr8_is_reg(self):
        """SystemExit(1) when boot_cap8_wr_en is a reg (driven by state machine)."""
        with pytest.raises(SystemExit) as exc_info:
            _check_boot_thrd_cr(_REGRESSED_CR8_VERILOG, _FAKE_PATH)
        assert exc_info.value.code == 1


# ---------------------------------------------------------------------------
# Tests — module-level constants use the reg-prefix form
# ---------------------------------------------------------------------------

class TestGuardConstants:
    def test_must_have_constant(self):
        assert _BOOT_THRD_MUST_HAVE == "reg boot_cap12_wr_en"

    def test_must_not_constant(self):
        assert _BOOT_THRD_MUST_NOT == "reg boot_cap8_wr_en"


# ---------------------------------------------------------------------------
# Tests — perm-check width guard passes on correct widths
# ---------------------------------------------------------------------------

class TestPermCheckWidthGuardPasses:
    def test_exact_minimum_widths_do_not_exit(self):
        """No SystemExit when all four signals are exactly at their minimum."""
        _validate_perm_check_widths(9, 9, 32, 32, _FAKE_PATH)

    def test_wider_than_minimum_also_passes(self):
        """No SystemExit when signals are generously wider than the minimum."""
        _validate_perm_check_widths(16, 16, 64, 64, _FAKE_PATH)

    def test_real_perm_check_class_passes(self):
        """Guard passes on the actual ChurchPermCheck Python class."""
        _check_perm_check_widths("", _FAKE_PATH)

    def test_real_generated_verilog_passes(self):
        """Guard passes when called during a real build/church_core.v generation.

        Skipped if build/church_core.v is absent — run gen_verilog first.
        The guard is already called by generate_core_verilog(); this test
        exercises the integration path via _check_perm_check_widths directly.
        """
        build_path = os.path.join(
            os.path.dirname(os.path.dirname(__file__)), "build", "church_core.v"
        )
        if not os.path.exists(build_path):
            pytest.skip("build/church_core.v not present — run gen_verilog first")
        with open(build_path) as f:
            verilog_text = f.read()
        _check_perm_check_widths(verilog_text, build_path)


# ---------------------------------------------------------------------------
# Tests — perm-check width guard fires on narrowed signals
# ---------------------------------------------------------------------------

class TestPermCheckWidthGuardFires:
    def test_fires_when_gt_seq_narrowed(self):
        """SystemExit(1) when gt_seq is narrower than 9 bits."""
        with pytest.raises(SystemExit) as exc_info:
            _validate_perm_check_widths(8, 9, 32, 32, _FAKE_PATH)
        assert exc_info.value.code == 1

    def test_fires_when_stored_gt_seq_narrowed(self):
        """SystemExit(1) when stored_gt_seq is narrower than 9 bits."""
        with pytest.raises(SystemExit) as exc_info:
            _validate_perm_check_widths(9, 8, 32, 32, _FAKE_PATH)
        assert exc_info.value.code == 1

    def test_fires_when_calculated_seal_narrowed(self):
        """SystemExit(1) when calculated_seal is narrower than 32 bits."""
        with pytest.raises(SystemExit) as exc_info:
            _validate_perm_check_widths(9, 9, 16, 32, _FAKE_PATH)
        assert exc_info.value.code == 1

    def test_fires_when_stored_seal_narrowed(self):
        """SystemExit(1) when stored_seal is narrower than 32 bits."""
        with pytest.raises(SystemExit) as exc_info:
            _validate_perm_check_widths(9, 9, 32, 16, _FAKE_PATH)
        assert exc_info.value.code == 1

    def test_fires_when_both_seals_narrowed(self):
        """SystemExit(1) when both seal signals are narrower than 32 bits."""
        with pytest.raises(SystemExit) as exc_info:
            _validate_perm_check_widths(9, 9, 16, 16, _FAKE_PATH)
        assert exc_info.value.code == 1

    def test_fires_when_all_signals_narrowed(self):
        """SystemExit(1) when every signal is below its minimum width."""
        with pytest.raises(SystemExit) as exc_info:
            _validate_perm_check_widths(8, 8, 16, 16, _FAKE_PATH)
        assert exc_info.value.code == 1

    def test_fires_when_gt_seq_is_zero_width(self):
        """SystemExit(1) even for a 0-bit gt_seq (degenerate narrowing)."""
        with pytest.raises(SystemExit) as exc_info:
            _validate_perm_check_widths(0, 9, 32, 32, _FAKE_PATH)
        assert exc_info.value.code == 1


# ---------------------------------------------------------------------------
# Tests — ChurchPermCheck Python Signal() declarations meet the spec
# ---------------------------------------------------------------------------

class TestPermCheckSignalShapes:
    """Directly verify that perm_check.py declares signals at the required width.

    These tests are the primary regression guard: if someone accidentally
    narrows Signal(9) to Signal(8) or Signal(32) to Signal(16) in
    hardware/perm_check.py these tests will fail before any Verilog is
    generated.
    """

    def test_gt_seq_is_at_least_9_bits(self):
        from .perm_check import ChurchPermCheck
        assert ChurchPermCheck().gt_seq.shape().width >= _PERM_CHECK_GT_SEQ_MIN_BITS, (
            f"ChurchPermCheck.gt_seq must be >= {_PERM_CHECK_GT_SEQ_MIN_BITS} bits"
        )

    def test_stored_gt_seq_is_at_least_9_bits(self):
        from .perm_check import ChurchPermCheck
        assert ChurchPermCheck().stored_gt_seq.shape().width >= _PERM_CHECK_GT_SEQ_MIN_BITS, (
            f"ChurchPermCheck.stored_gt_seq must be >= {_PERM_CHECK_GT_SEQ_MIN_BITS} bits"
        )

    def test_calculated_seal_is_at_least_32_bits(self):
        from .perm_check import ChurchPermCheck
        assert ChurchPermCheck().calculated_seal.shape().width >= _PERM_CHECK_SEAL_MIN_BITS, (
            f"ChurchPermCheck.calculated_seal must be >= {_PERM_CHECK_SEAL_MIN_BITS} bits"
        )

    def test_stored_seal_is_at_least_32_bits(self):
        from .perm_check import ChurchPermCheck
        assert ChurchPermCheck().stored_seal.shape().width >= _PERM_CHECK_SEAL_MIN_BITS, (
            f"ChurchPermCheck.stored_seal must be >= {_PERM_CHECK_SEAL_MIN_BITS} bits"
        )


# ---------------------------------------------------------------------------
# Tests — perm-check guard module-level constants
# ---------------------------------------------------------------------------

class TestPermCheckGuardConstants:
    def test_gt_seq_min_bits_constant(self):
        assert _PERM_CHECK_GT_SEQ_MIN_BITS == 9

    def test_seal_min_bits_constant(self):
        assert _PERM_CHECK_SEAL_MIN_BITS == 32


# ---------------------------------------------------------------------------
# Direct invocation
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
