"""Tests for gen_verilog.py boot-state CR assignment guard.

Verifies that _check_boot_thrd_cr() catches regressions where the INIT_THRD
boot state writes the thread GT into the wrong capability register.

The guard relies on a structural property of Amaranth-generated Verilog:
  - Signals driven from a procedural always-block are emitted as ``reg``.
  - Signals that are never actively driven (only assigned a constant default)
    are emitted as ``wire ... assign ... = 1'h0``.
In a correct build ``reg boot_cap12_wr_en`` appears; ``boot_cap8_wr_en`` is
only a ``wire``.  A regression (CR8 instead of CR12) flips this.

Run with:  python -m pytest hardware/test_gen_guards.py -v
       or:  python -m hardware.test_gen_guards
"""

import os
import sys
import pytest

from .gen_verilog import _check_boot_thrd_cr, _BOOT_THRD_MUST_HAVE, _BOOT_THRD_MUST_NOT


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
# Direct invocation
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
