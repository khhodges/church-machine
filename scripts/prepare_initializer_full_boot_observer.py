"""Bind a read-only boot observer to actual FDRE/FDSE Q outputs, fail closed."""
import hashlib
import json
from pathlib import Path
import re
import sys


def nia_outputs(text):
    cells = {}
    pattern = r"\b(FDRE|FDSE)\s*#\s*\((.*?)\)\s*(\\\S+|[A-Za-z_]\w*)\s*\((.*?)\);"
    for _, _, name, body in re.findall(pattern, text, re.S):
        name = name.lstrip("\\")
        if re.fullmatch(r"core\.nia_reg(?:_reg)?\[\d+\]", name):
            if name in cells:
                raise ValueError("Duplicate NIA register")
            q = re.findall(r"\.Q\(([^)]+)\)", body)
            if len(q) != 1 or not re.fullmatch(r"[\\\w.\[\]\s]+", q[0]):
                raise ValueError("Unrecognized NIA Q connection")
            cells[name] = q[0].strip()
    maps = []
    for prefix in ("core.nia_reg_reg", "core.nia_reg"):
        names = [f"{prefix}[{i}]" for i in range(32)]
        if all(n in cells for n in names):
            maps.append([cells[n] for n in names])
    if len(maps) != 1 or len(cells) != 32:
        raise ValueError("Require one complete 32-bit NIA register mapping")
    return maps[0]


def render(text):
    bits = nia_outputs(text)
    for name in ("boot_triggered", "dbg_fault_valid", "dbg_boot_complete",
                 r"\boot_rom.clk", r"\phase1_clock.locked"):
        if not re.search(r"\bwire\s+" + re.escape(name) + r"\s*;", text):
            raise ValueError(f"Missing observer net: {name}")
    assignments = "\n".join(f"assign nia[{i}] = dut.{q} ;" for i, q in enumerate(bits))
    return r"""`timescale 1ns/1ps
module full_boot_tb;
reg clk=0;
wire tx, led0, led1;
wire [31:0] nia;
integer cycles=0;
realtime previous_edge=0;
church_wukong_xc7a100t dut(.clk(clk),.rst_n(1'b1),.uart_rx_pin(1'b1),
 .uart_tx_pin(tx),.led0(led0),.led1(led1));
""" + assignments + r"""
always #10 clk=~clk;
always @(posedge dut.\boot_rom.clk ) begin
 if(dut.\phase1_clock.locked !== 1'b1) $fatal(1,"User rising edge without lock");
end
always @(negedge dut.\boot_rom.clk ) begin
 if($realtime>0) begin
  if(dut.\phase1_clock.locked !== 1'b1) $fatal(1,"User clock without lock");
  if(cycles>0 && (($realtime-previous_edge<39.999)||($realtime-previous_edge>40.001)))
   $fatal(1,"Not a 25MHz user clock");
  previous_edge=$realtime;
  cycles=cycles+1;
  if(dut.boot_triggered === 1'b1) begin
   if(dut.dbg_fault_valid !== 1'b0) $fatal(1,"Fault/unknown during boot: nia=%h",nia);
   if((^nia) === 1'bx) $fatal(1,"Unknown live NIA");
   if(dut.dbg_boot_complete !== 1'b0 && dut.dbg_boot_complete !== 1'b1)
    $fatal(1,"Unknown boot completion");
   if(dut.dbg_boot_complete === 1'b1) begin
    if(nia !== 32'h3504) $fatal(1,"Wrong entry: %h",nia);
    $display("FULL_SYNTH_BOOT_PASS: entry=00003504 cycles=%0d",cycles);
    $finish;
   end
  end
  if(cycles%50000==0)
   $display("BOOT_PROGRESS: cycles=%0d triggered=%b complete=%b nia=%h",
    cycles,dut.boot_triggered,dut.dbg_boot_complete,nia);
 end
end
initial begin
 #80000000;
 $fatal(1,"Boot timeout");
end
endmodule
"""


def prepare(netlist, output):
    raw = Path(netlist).read_bytes()
    tb = render(raw.decode())
    Path(output).write_text(tb)
    Path(str(output) + ".json").write_text(json.dumps({
        "netlistSha256": hashlib.sha256(raw).hexdigest(),
        "observerSha256": hashlib.sha256(tb.encode()).hexdigest(),
        "niaQOutputsLowToHigh": nia_outputs(raw.decode()),
        "scope": "Read-only synthesized boot entry; no force, preload or hardware access",
    }, indent=2) + "\n")


if __name__ == "__main__":
    prepare(sys.argv[1], sys.argv[2])
