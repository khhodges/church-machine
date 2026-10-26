"""Cheap regression checks for the separate export and boot-test oracle."""
from pathlib import Path
import subprocess

import pytest

from scripts.prepare_initializer_full_boot import candidate_module
from scripts.prepare_initializer_full_boot_observer import nia_outputs, render

ROOT = Path(__file__).resolve().parents[1]


def mapped_fixture():
    wires = "\n".join("wire " + n + " ;" for n in (
        "boot_triggered", "dbg_fault_valid", "dbg_boot_complete",
        r"\boot_rom.clk", r"\phase1_clock.locked"))
    cells = "\n".join(
        f"FDRE #(.INIT(1'b0)) \\core.nia_reg_reg[{i}] (.C(clk),.D(d),.Q(n{i}),.R(1'b0));"
        for i in range(32))
    return wires + "\n" + cells


def test_complete_q_mapping():
    assert nia_outputs(mapped_fixture()) == [f"n{i}" for i in range(32)]


def test_missing_bit_is_not_zero_filled():
    with pytest.raises(ValueError, match="complete"):
        nia_outputs(mapped_fixture().replace(r"\core.nia_reg_reg[31]", r"\other[31]"))


def test_missing_control_net_fails():
    with pytest.raises(ValueError, match="Missing"):
        render(mapped_fixture().replace("wire dbg_fault_valid ;", ""))


def test_overlay_preserves_base_and_uses_candidate():
    base = (ROOT / "hardware/sparse_memory_init.py").read_text()
    candidate = (ROOT / "hardware/sparse_memory_init_candidate.py").read_text()
    combined = candidate_module(base, candidate)
    assert combined.startswith(base)
    ns = {"__name__": "separate_initializer"}
    exec(combined, ns)
    cls = ns["SparseMemoryInitializer"]
    assert cls is ns["AddressedSparseMemoryInitializer"]
    assert cls.__bases__[0].__name__ == "SparseMemoryInitializer"


@pytest.mark.parametrize("entry,fault,success", [
    ("00003504", 0, True), ("00000000", 0, False),
    ("00003504", 1, False), ("xxxxxxxx", 0, False),
])
def test_boot_oracle(tmp_path, entry, fault, success):
    (tmp_path / "tb.v").write_text(render(mapped_fixture()))
    q = "\n".join(f"wire n{i}=value[{i}];" for i in range(32))
    (tmp_path / "stub.v").write_text(r"""`timescale 1ns/1ps
module church_wukong_xc7a100t(input clk,rst_n,uart_rx_pin,
 output uart_tx_pin,led0,led1);
reg \boot_rom.clk =0;
wire \phase1_clock.locked =1;
reg boot_triggered=0;
wire dbg_boot_complete=boot_triggered;
""" + f"wire dbg_fault_valid=1'b{fault};\nwire[31:0] value=32'h{entry};\n" + q + r"""
assign uart_tx_pin=1; assign led0=0; assign led1=0;
always #20 \boot_rom.clk = ~\boot_rom.clk ;
initial #150 boot_triggered=1;
endmodule
""")
    subprocess.run(["iverilog", "-g2012", "-s", "full_boot_tb", "-o", "probe",
                    "stub.v", "tb.v"], cwd=tmp_path, check=True, capture_output=True, timeout=15)
    result = subprocess.run(["vvp", "probe"], cwd=tmp_path,
                            capture_output=True, text=True, timeout=15)
    assert ("FULL_SYNTH_BOOT_PASS:" in result.stdout) == success, result.stdout
    assert (result.returncode == 0) == success, result.stdout
    assert "Boot timeout" not in result.stdout
