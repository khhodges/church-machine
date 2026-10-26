"""Check Tcl selection/timestamps only, not Vivado object visibility."""
from pathlib import Path
import subprocess
import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize("available", [True, False])
def test_selection_and_times(tmp_path, available):
    names = "/implemented_boot_tb/dut/fault_valid /implemented_boot_tb/dut/unrelated"
    if available:
        names += (" /implemented_boot_tb/dut/core.boot_metadata.error"
                  " /implemented_boot_tb/dut/core.boot_metadata.error_reg_i_1_n_0"
                  " {/implemented_boot_tb/dut/\\core.namespace_error_reg[3] }"
                  " {/implemented_boot_tb/dut/\\core.u_call.fault_type }")
    wrapper = tmp_path / "check.tcl"
    wrapper.write_text(
        f"proc get_objects {{args}} {{return {{{names}}}}}\n"
        "proc get_value {args} {return 8}\n"
        "set time_ps 0\n"
        "proc run {duration unit} {"
        "if {$unit ne \"ps\"} {error \"Wrong unit\"}; "
        "incr ::time_ps $duration; puts \"SAMPLE_TIME=$::time_ps\"}\n"
        "if {[catch {source {" +
        str(ROOT / "scripts/inspect_implemented_boot_admission.tcl") +
        "}} message]} {puts stderr $message; exit 1}\n"
    )
    result = subprocess.run(["tclsh", str(wrapper)], capture_output=True,
                            text=True, timeout=10)
    assert (result.returncode == 0) == available, result.stdout + result.stderr
    if available:
        assert "SAMPLE_TIME=1365310999" in result.stdout
        assert "SAMPLE_TIME=1365350999" in result.stdout
        assert "SAMPLE_TIME=1365390999" in result.stdout
        assert result.stdout.count("core.boot_metadata.error = 8") == 3
        assert result.stdout.count("core.namespace_error_reg[3]  = 8") == 3
        assert result.stdout.count("core.u_call.fault_type  = 8") == 3
        assert "_i_1_n_0" not in result.stdout
        assert "unrelated" not in result.stdout
        assert "BOOT_ADMISSION_DIAGNOSTIC_COMPLETE" in result.stdout
    else:
        assert "No admission signals" in result.stderr
        assert "SAMPLE_TIME" not in result.stdout
