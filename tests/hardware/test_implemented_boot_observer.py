"""Tests the observer, not the vendor netlist or physical FPGA."""
from pathlib import Path
import subprocess
import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize("scenario,success,marker", [
    ("handoff", True, "IMPLEMENTED_BOOT_HANDOFF_OBSERVED"),
    ("stuck", False, "IMPLEMENTED_BOOT_TIMEOUT"),
    ("fault", False, "Fault or unknown"),
    ("unknown", False, "Fault or unknown"),
    ("no_trigger", False, "Boot complete without observed trigger"),
])
def test_observer(tmp_path, scenario, success, marker):
    trigger = "0" if scenario == "no_trigger" else "1"
    complete = "1" if scenario in ("handoff", "no_trigger") else "0"
    fault = "1" if scenario == "fault" else "1'bx" if scenario == "unknown" else "0"
    fixture = tmp_path / "fixture.v"
    fixture.write_text(f"""`timescale 1ns/1ps
module church_wukong_xc7a100t(input clk, rst_n, uart_rx_pin,
                            output uart_tx_pin, led0, led1);
reg boot_triggered=0, boot_complete=0, fault_valid=0;
initial begin
  #1000; boot_triggered={trigger};
  #100; fault_valid={fault}; boot_complete={complete};
end
assign uart_tx_pin=1; assign led0=0; assign led1=0;
endmodule
""")
    executable = tmp_path / "observer.vvp"
    subprocess.run(["iverilog", "-g2012", "-s", "implemented_boot_tb", "-o",
                    str(executable), str(fixture),
                    str(ROOT / "tests/hardware/wukong_implemented_boot_tb.v")],
                   check=True, capture_output=True, timeout=30)
    result = subprocess.run(["vvp", str(executable)], capture_output=True,
                            text=True, timeout=30)
    assert (result.returncode == 0) == success, result.stdout + result.stderr
    assert marker in result.stdout
