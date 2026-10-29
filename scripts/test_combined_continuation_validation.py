"""Test the observer's rejection paths without claiming vendor validation."""
from pathlib import Path
import subprocess
import pytest
from scripts.combined_continuation_observer import observer
from scripts.test_initializer_full_boot import mapped_fixture


def fixture():
    return mapped_fixture() + """
wire hw_init_wr_en;
wire [13:0] hw_init_wr_addr;
wire [31:0] hw_init_wr_data;
wire hw_init_done;
"""


def test_missing_write_bus_fails_closed():
    with pytest.raises(ValueError, match="Missing preserved"):
        observer(mapped_fixture(), 2)


def test_observer_declarations_precede_all_uses():
    text = observer(fixture(), 2)
    assert text.count("integer write_count=0;") == 1
    assert text.index("integer write_count=0;") < text.index("if(write_count")
    assert text.index("reg [45:0] expected") < text.index('$readmemh')


@pytest.mark.parametrize("first,last,entry,fault,success", [
    ("f8810100", "00000011", "00004610", "0", True),
    ("00000000", "00000011", "00004610", "0", False),
    ("f8810100", "00000000", "00004610", "0", False),
    ("xxxxxxxx", "00000011", "00004610", "0", False),
    ("f8810100", "00000011", "00003504", "0", False),
    ("f8810100", "00000011", "00004610", "1", False),
])
def test_oracle(tmp_path, first, last, entry, fault, success):
    (tmp_path / "tb.v").write_text(observer(fixture(), 2))
    (tmp_path / "pairs.hex").write_text("0000f8810100\n000200000011\n")
    q = "\n".join(f"wire n{i}=value[{i}];" for i in range(32))
    (tmp_path / "stub.v").write_text(r"""`timescale 1ns/1ps
module church_wukong_xc7a100t(input clk,rst_n,uart_rx_pin,
output uart_tx_pin,led0,led1);
reg \boot_rom.clk =0;
wire \phase1_clock.locked =1;
reg boot_triggered=0;
wire dbg_boot_complete=boot_triggered;
reg hw_init_wr_en=0, hw_init_done=0;
reg [13:0] hw_init_wr_addr=0;
reg [31:0] hw_init_wr_data=0;
""" + f"wire dbg_fault_valid=1'b{fault};\nwire [31:0] value=32'h{entry};\n" + q + r"""
always #20 \boot_rom.clk = ~\boot_rom.clk ;
initial begin
""" + f"""
 #40; hw_init_wr_en=1; hw_init_wr_data=32'h{first};
 #40; hw_init_wr_addr=2; hw_init_wr_data=32'h{last};
 #40; hw_init_wr_en=0; hw_init_done=1;
 #30; boot_triggered=1;
end
endmodule
""")
    subprocess.run(["iverilog", "-g2012", "-s", "full_boot_tb", "-o", "probe",
                    "stub.v", "tb.v"], cwd=tmp_path, check=True, capture_output=True, timeout=15)
    result = subprocess.run(["vvp", "probe"], cwd=tmp_path,
                            capture_output=True, text=True, timeout=15)
    assert ("COMBINED_VENDOR_BOOT_PASS:" in result.stdout) == success, result.stdout
    assert (result.returncode == 0) == success, result.stdout


def test_packager_has_no_implementation_commands():
    text = (Path(__file__).parent / "prepare_combined_continuation_validation.py").read_text()
    tcl = text.split('(output / "synth.tcl").write_text("""', 1)[1].split('""")', 1)[0]
    for forbidden in ("write_bitstream", "route_design", "program_hw_devices", "open_hw"):
        assert forbidden not in tcl
