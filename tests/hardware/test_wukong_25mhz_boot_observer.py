"""Observer fail-closed tests using a tiny fixture, not full-top replay evidence."""
from pathlib import Path
import subprocess
import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize("case,nia,fault,period,locked,success", [
    ("valid", "32'h3504", "1'b0", 20, "1'b1", True),
    ("wrong_entry", "32'h3508", "1'b0", 20, "1'b1", False),
    ("unknown_entry", "32'hxxxxxxxx", "1'b0", 20, "1'b1", False),
    ("fault", "32'h3504", "1'b1", 20, "1'b1", False),
    ("unknown_fault", "32'h3504", "1'bx", 20, "1'b1", False),
    ("wrong_clock", "32'h3504", "1'b0", 10, "1'b1", False),
    ("unlocked", "32'h3504", "1'b0", 20, "1'b0", False),
    ("initial_settle", "32'h3504", "1'b0", 20, "($time >= 100)", True),
    ("lost_lock", "32'h3504", "1'b0", 20, "($time < 100)", False),
])
def test_observer(tmp_path, case, nia, fault, period, locked, success):
    fixture = tmp_path / "fixture.v"
    clock_driver = (
        f"reg \\boot_rom.clk ;\ninitial #0 \\boot_rom.clk = 0;\n"
        f"always #{period} if ($time >= 100) \\boot_rom.clk = ~\\boot_rom.clk ;"
        if case == "initial_settle" else
        f"reg \\boot_rom.clk = 0;\nalways #{period} \\boot_rom.clk = ~\\boot_rom.clk ;")
    lock_driver = (
        "reg \\phase1_clock.locked = 0;\ninitial #90 \\phase1_clock.locked = 1;"
        if case == "initial_settle" else
        "reg \\phase1_clock.locked = 1;\ninitial #90 \\phase1_clock.locked = 0;"
        if case == "lost_lock" else
        f"wire \\phase1_clock.locked = {locked};")
    fixture.write_text(f"""`timescale 1ns/1ps
module church_wukong_xc7a100t(input clk, rst_n, uart_rx_pin,
                            output uart_tx_pin, led0, led1);
{clock_driver}
{lock_driver}
wire hw_init_done = 1;
wire \\core.fault_valid = {fault};
wire [31:0] \\core.nia = {nia};
reg [3:0] count = 0;
always @(posedge \\boot_rom.clk ) count <= count + 1;
wire \\core.boot_complete = count > 3;
assign uart_tx_pin = 1;
assign led0 = 0;
assign led1 = 0;
endmodule
""")
    exe = tmp_path / "observer.vvp"
    subprocess.run(["iverilog", "-g2012", "-s", "wukong_25mhz_boot_tb",
                    "-o", str(exe), str(fixture),
                    str(ROOT / "tests/hardware/wukong_25mhz_boot_tb.v")],
                   check=True, capture_output=True, text=True, timeout=30)
    run = subprocess.run(["vvp", str(exe)], capture_output=True, text=True, timeout=30)
    assert (run.returncode == 0) == success, run.stdout + run.stderr
    assert ("BOOT25_PASS:" in run.stdout) == success
