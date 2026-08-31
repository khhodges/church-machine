"""Regression tests for the syntax of generated standalone core Verilog."""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

import pytest

from hardware.gen_verilog import _sanitize_empty_attributed_case_arms


ROOT = Path(__file__).resolve().parents[2]
GENERATED_CORE_FILES = (
    ROOT / "build" / "church_core.v",
    ROOT / "build" / "church_core_iot.v",
    ROOT / "verilog" / "church_core.v",
)


def test_empty_attributed_case_arm_is_rewritten_as_a_noop():
    """The backend workaround must remove only the dangling attribute arm."""
    invalid = """\
always @* begin
  casez (state)
    3'h0:
      result = 1'b0;
    3'h1:
      (* full_case = 32'd1 *)

  endcase
end
"""

    fixed = _sanitize_empty_attributed_case_arms(invalid)

    assert "(* full_case = 32'd1 *)" not in fixed
    assert re.search(r"3'h1:\n\s*/\* empty \*/;\n\s*endcase", fixed)


@pytest.mark.parametrize("path", GENERATED_CORE_FILES, ids=lambda path: str(path))
def test_tracked_core_verilog_parses_with_yosys(path: Path):
    """All committed standalone core outputs must remain parser-valid."""
    yosys = shutil.which("yosys")
    if yosys is None:
        pytest.skip("yosys is not installed")
    if not path.exists():
        pytest.fail(f"generated Verilog artifact is missing: {path}")

    result = subprocess.run(
        [yosys, "-Q", "-p", f"read_verilog -sv {path}"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, (
        f"Yosys rejected {path}:\n{result.stderr}\n{result.stdout}"
    )