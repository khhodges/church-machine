"""Validate the external-pin replay observer, not production RTL behavior."""
from pathlib import Path
import shutil
import subprocess
import pytest

ROOT = Path(__file__).resolve().parents[2]
pytestmark = pytest.mark.skipif(
    not all(shutil.which(x) for x in ("iverilog", "iverilog-vpi", "vvp")),
    reason="Icarus and VPI compiler required",
)


@pytest.mark.parametrize("fault_value,valid,pc,instr,expected", [
    ("count>=5", "count>=2", "32'h3504", "32'h27010000", "FAULT cycle=5 code=8 nia=00002e08"),
    ("1'bx", "count>=2", "32'h3504", "32'h27010000", "UNKNOWN_CONTROL cycle=1"),
    ("0", "1'bx", "32'h3504", "32'h27010000", "UNKNOWN_RETIRE cycle=1 field=valid"),
    ("0", "1'bz", "32'h3504", "32'h27010000", "UNKNOWN_RETIRE cycle=1 field=valid"),
    ("0", "count>=2", "32'hxxxxxxxx", "32'h27010000", "nia_unknown=1 opcode_unknown=0"),
    ("0", "count>=2", "32'h3504", "32'hxxxxxxxx", "nia_unknown=0 opcode_unknown=1"),
    ("count>=5", "count>=2", "32'h3504", "32'b00100xxxxxxxxxxxxxxxxxxxxxxxxxxx", "FAULT cycle=5"),
    ("count>=5", "count>=2", "32'h3504", "32'b00100zzzzzzzzzzzzzzzzzzzzzzzzzzz", "FAULT cycle=5"),
    ("0", "count>=2", "32'h3504", "32'bx0100000000000000000000000000000", "nia_unknown=0 opcode_unknown=1"),
    ("count>=10005", "count==2", "32'h3504", "32'h27010000", "FAULT cycle=10005"),
])
@pytest.mark.parametrize("probe", [False, True, "boot", "program"])
def test_observer_clocks_and_reports_four_state_controls(tmp_path, fault_value, valid, pc, instr, expected, probe):
    subprocess.run(
        ["iverilog-vpi", str(ROOT / "scripts/replay_guarded_top_vpi.c")],
        cwd=tmp_path, capture_output=True, text=True, check=True, timeout=30)
    fixture = r"""
module church_wukong_xc7a100t(input clk, rst_n, uart_rx_pin);
reg [31:0] count=0;
always @(posedge clk) count<=count+1;
wire hw_init_done = count>=1;
wire \core.boot_complete = count>=2;
wire \core.fault_valid = FAULT_VALUE;
wire [4:0] \core.fault = 8;
wire [31:0] \core.nia = 32'h2e08;
wire \core.retire_valid = VALID_VALUE;
wire [31:0] \core.retire_nia = PC_VALUE;
wire [31:0] \core.retire_instr = INSTR_VALUE;
wire [31:0] \core.imem_addr = 0;
wire [31:0] \core.imem_fetch_address = 0;
wire \core.imem_valid = 1;
wire [31:0] \core.imem_data = 32'h27010000;
wire imem_from_dmem = 0;
wire [31:0] imem_rd__data = 0;
wire [9:0] \boot_rom.addr = 0;
wire [31:0] \boot_rom.data = 32'h27010000;
wire [2:0] \core.boot_state = 3;
wire \core.boot_thread_activated = 1;
wire \core.guarded_call_ready = 1;
wire \core.halt_req = 0;
wire step_mode = 0;
wire step_halted = 0;
wire trace_stall = 0;
wire [1:0] tq_len = 3;
wire [1:0] tq_ptr = 0;
wire [3:0] tq_bidx = 0;
wire trace_tx_ack = 0;
wire tx_free = 1;
wire \uart_tx.busy = 0;
wire sentinel_req = 0;
wire \fault_recovery.fault_pending = 0;
wire imem_settled = 1;
wire \core.thread_switch_busy = 0;
wire \core.u_dread.start = 0;
wire \core.u_dread.done = 0;
endmodule
"""
    if valid == "1'bz":
        # Icarus drops a constant high-impedance wire from VPI iteration.
        # A stored Z remains observable and exercises the bval/aval=1/0 case.
        fixture = fixture.replace(r"wire \core.retire_valid", r"reg \core.retire_valid")
    (tmp_path / "fixture.v").write_text(fixture.replace("FAULT_VALUE", fault_value)
        .replace("VALID_VALUE", valid).replace("PC_VALUE", pc).replace("INSTR_VALUE", instr))
    subprocess.run(["iverilog", "-g2012", "-s", "church_wukong_xc7a100t",
                    "-o", "fixture.vvp", "fixture.v"], cwd=tmp_path,
                   capture_output=True, text=True, check=True, timeout=30)
    result = subprocess.run(
        ["vvp", "-M", str(tmp_path), "-m", "replay_guarded_top_vpi", "fixture.vvp"]
        + (["+program-trial"] if probe == "program" else
           ["+stop-at-boot"] if probe == "boot" else ["+handoff-probe"] if probe else []),
        cwd=tmp_path, capture_output=True, text=True, check=True, timeout=30)
    assert "INITIALIZED cycle=1" in result.stdout
    early_boot = probe == "boot" and fault_value in ("count>=5", "count>=10005")
    if early_boot:
        assert "BOOT_HANDOFF_OBSERVED cycle=2" in result.stdout
        assert "FAULT cycle=" not in result.stdout
    else:
        assert expected in result.stdout
        assert "BOOT_HANDOFF_OBSERVED" not in result.stdout
    assert "MISSING_" not in result.stdout
    assert "field=core.imem_data width=32 aval=27010000 xz_mask=00000000" in result.stdout
    if probe is True and fault_value == "count>=10005":
        assert "HANDOFF_SAMPLE cycle=10000" in result.stdout
        assert "field=tq_len width=2 aval=00000003 xz_mask=00000000" in result.stdout
        assert "field=uart_tx.busy width=1 aval=00000000 xz_mask=00000000" in result.stdout
    if fault_value == "count>=5":
        assert "BOOT_COMPLETE cycle=2" in result.stdout
        assert "RETIRE_PENDING cycle=2 nia=00003504 opcode=04 lower27=unavailable" in result.stdout
