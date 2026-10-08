"""Prepare an offline XSim check of the exact B1.2 synthesized netlist."""
import hashlib
import re
import sys
from pathlib import Path

source, netlist, output = map(Path, sys.argv[1:])
if hashlib.sha256(source.read_bytes()).hexdigest() != "6475c1e07556e5e98674afbca5ea2a4fbf5d3238ff093c9d7e52b3d91b3bcf6e":
    raise SystemExit("Wrong generated Verilog; refusing to mix inputs")
text = source.read_text()
entries = re.findall(r"(\S*init_rom)\s*\[(\d+)\]\s*=\s*46'h([0-9a-fA-F]+)", text)
if not entries or len({name for name, _, _ in entries}) != 1:
    raise SystemExit("Expected exactly one explicit 46-bit initialization ROM")
pairs = sorted((int(i), int(v, 16)) for _, i, v in entries)
if [i for i, _ in pairs] != list(range(len(pairs))):
    raise SystemExit("Initialization ROM is not contiguous")
if pairs[0][1] != (1 << 32) | 63:
    raise SystemExit("First ROM entry is not Namespace word 1 <- 63")
net = netlist.read_text()
for i in range(96):
    if not re.search(r"\\core\.u_registers\.cr15_reg\[" + str(i) + r"\]\s*\n", net):
        raise SystemExit(f"Missing CR15 flop {i}")
for i in range(16):
    if not re.search(r"\n    dmem_reg_1_" + str(i) + r"\n", net):
        raise SystemExit(f"Missing physical DMEM lane {i}")
for signal in ("initializer.ready", "initializer.done"):
    if f"wire \\{signal} ;" not in net:
        raise SystemExit(f"Missing {signal}")
output.mkdir(exist_ok=True)
(output / "expected.hex").write_text("".join(f"{v:012x}\n" for _, v in pairs))
cr15 = ",".join(f"dut.\\core.u_registers.cr15_reg[{i}] .Q" for i in range(95, -1, -1))
data = ",".join(f"dut.dmem_reg_1_{i}.DIADI[1:0]" for i in range(15, -1, -1))
tb = r"""
`timescale 1ns/1ps
module tb;
  reg clk=0, rst_n=0;
  wire tx, led0, led1, boot, fault_valid;
  wire [31:0] nia, fault;
  wire [95:0] cr15;
  wire [31:0] write_data;
  wire [13:0] write_addr = dut.dmem_reg_1_0.ADDRARDADDR[14:1];
  reg [45:0] expected [0:@LAST@];
  integer count=0;
  reg init_checked=0;
  church_wukong_xc7a100t dut(
    .clk(clk), .rst_n(rst_n), .uart_rx_pin(1'b1),
    .uart_tx_pin(tx), .led0(led0), .led1(led1),
    .dbg_boot_complete(boot), .dbg_fault_valid(fault_valid),
    .dbg_nia(nia), .dbg_fault(fault));
  assign cr15 = {@CR15@};
  assign write_data = {@DATA@};
  always #10 clk=~clk;
  initial begin
    $readmemh("expected.hex", expected);
    #1000 rst_n=1;
    #10000000;
    $fatal(1, "REPLAY_TIMEOUT count=%0d nia=%h CR15=%h", count, nia, cr15);
  end
  always @(posedge clk) begin
    if (dut.\initializer.ready === 1'b1 &&
        dut.\initializer.done === 1'b0) begin
      if (count >= @COUNT@)
        $fatal(1, "EXTRA_INIT_WRITE");
      if ({write_addr,write_data} !== expected[count])
        $fatal(1, "INIT_MISMATCH index=%0d actual=%h expected=%h",
          count, {write_addr,write_data}, expected[count]);
      if (count == 0) begin
        if (dut.dmem_reg_1_0.ENARDEN !== 1'b1 ||
            dut.dmem_reg_1_1.ENARDEN !== 1'b1 ||
            dut.dmem_reg_1_2.ENARDEN !== 1'b1)
          $fatal(1, "FIRST_LIMIT_WRITE_NOT_ENABLED");
        $display("FIRST_INIT_WRITE_PASS address=%0d data=%h", write_addr, write_data);
      end
      count=count+1;
    end
  end
  always @(negedge clk) begin
    if (dut.\initializer.done === 1'b1 && !init_checked) begin
      if (count != @COUNT@)
        $fatal(1, "INIT_COUNT_MISMATCH actual=%0d expected=@COUNT@", count);
      init_checked=1;
      $display("ALL_INIT_PAIRS_PASS count=%0d", count);
    end
    if (fault_valid === 1'b1)
      $fatal(1, "BOOT_FAULT nia=%h fault=%h CR15=%h", nia, fault, cr15);
    if (init_checked && nia === 32'h4) begin
      if (cr15 !== 96'h0000003f000000001a000000)
        $fatal(1, "BOOT_LOAD_MISMATCH CR15=%h", cr15);
      $display("INIT_AND_BOOT_LOAD_PASS CR15=%h nia=%h", cr15, nia);
      $finish;
    end
  end
endmodule
"""
tb = (tb.replace("@LAST@", str(len(pairs) - 1))
      .replace("@COUNT@", str(len(pairs)))
      .replace("@CR15@", cr15).replace("@DATA@", data))
(output / "tb.sv").write_text(tb)
print(f"Prepared {len(pairs)} expected initialization pairs; first=word1/63.")
print("Scope: initialization bus sequence and first boot LOAD, not complete boot.")
