"""Prepare an exact-netlist, offline initialization and first-LOAD replay."""
import hashlib
import re
import shutil
import sys
from pathlib import Path

build, out = map(Path, sys.argv[1:3])
trace = sys.argv[3:] == ["--trace"]
if sys.argv[3:] and not trace:
    raise SystemExit("Only optional argument is --trace")
checks = {
    "church_wukong_xc7a100t.v": "d7fb9b95ca8304a05148cd30ab5c1053f2c246e2b5509b461cc008ed594b677a",
    "synth_funcsim.v": "e120f6713aeaa307835ae78bddac4ed03dd0858b53290ef5ffa6fdc0c61ed226",
    "expected.hex": "b7cebaeb97a509b014991f4a71f85a3650f839c91b673413d11e78350364d33c",
}
for name, digest in checks.items():
    if hashlib.sha256((build / name).read_bytes()).hexdigest() != digest:
        raise SystemExit(f"Wrong input: {name}")
net = (build / "synth_funcsim.v").read_text()
for i in range(96):
    if not re.search(r"\\core\.u_registers\.cr15_reg\[" + str(i) + r"\]\s*\n", net):
        raise SystemExit(f"Missing CR15 flop {i}")
for i in range(16):
    if not re.search(r"\n    dmem_reg_1_" + str(i) + r"\n", net):
        raise SystemExit(f"Missing physical DMEM lane {i}")
for name in ("hw_init_done", "hw_init_wr_en"):
    if f"wire {name};" not in net:
        raise SystemExit(f"Missing initializer signal: {name}")
out.mkdir(parents=True, exist_ok=False)
for name in checks:
    shutil.copyfile(build / name, out / name)
cr15 = ",".join(f"dut.\\core.u_registers.cr15_reg[{i}] .Q" for i in range(95, -1, -1))
data = ",".join(f"dut.dmem_reg_1_{i}.DIADI[1:0]" for i in range(15, -1, -1))
lanes = "\n".join(f"""
      if (dut.dmem_reg_1_{i}.ENARDEN !== 1'b1 ||
          dut.dmem_reg_1_{i}.WEA[0] !== 1'b1 ||
          dut.dmem_reg_1_{i}.ADDRARDADDR[14:1] !== write_addr)
        $fatal(1, "LANE_WRITE_MISMATCH lane={i} index=%0d",count);
""" for i in range(16))
tb = r"""
`timescale 1ns/1ps
module tb;
  reg clk=0, rst_n=0;
  wire tx, led0, led1, boot, fault_valid;
  wire [31:0] nia, fault;
  wire [95:0] cr15 = {@CR15@};
  wire [31:0] write_data = {@DATA@};
  wire [13:0] write_addr = dut.dmem_reg_1_0.ADDRARDADDR[14:1];
  reg [45:0] expected [0:2692];
  integer count=0;
  reg init_checked=0;
  church_wukong_xc7a100t dut(
    .clk(clk), .rst_n(rst_n), .uart_rx_pin(1'b1),
    .uart_tx_pin(tx), .led0(led0), .led1(led1),
    .dbg_boot_complete(boot), .dbg_fault_valid(fault_valid),
    .dbg_nia(nia), .dbg_fault(fault));
  always #10 clk=~clk;
  initial begin
    $readmemh("expected.hex", expected);
    #1000 rst_n=1;
    #10000000;
    $fatal(1,"REPLAY_TIMEOUT count=%0d nia=%h CR15=%h",count,nia,cr15);
  end
  // Sample on the physical write-port clock, before the flops update.
  always @(posedge dut.dmem_reg_1_0.CLKARDCLK) begin
    if ($time > 200 && !init_checked) begin
      if (dut.hw_init_wr_en !== 1'b0 && dut.hw_init_wr_en !== 1'b1)
        $fatal(1,"UNKNOWN_INIT_ENABLE");
      if (dut.hw_init_wr_en === 1'b1) begin
        if (count >= 2693) $fatal(1,"EXTRA_INIT_WRITE");
@LANES@
        if ({write_addr,write_data} !== expected[count])
          $fatal(1,"INIT_MISMATCH index=%0d actual=%h expected=%h",
            count,{write_addr,write_data},expected[count]);
        if (count == 0 || count == 2692)
          $display("INIT_PAIR_PASS index=%0d address=%0d data=%h",
            count,write_addr,write_data);
        count=count+1;
      end
    end
  end
  always @(negedge clk) begin
    if (dut.hw_init_done === 1'b1 && !init_checked) begin
      if (count != 2693) $fatal(1,"INIT_COUNT_MISMATCH count=%0d",count);
      init_checked=1;
      $display("ALL_INIT_PAIRS_PASS count=%0d",count);
    end
    if (fault_valid === 1'b1)
      $fatal(1,"BOOT_FAULT nia=%h fault=%h CR15=%h",nia,fault,cr15);
    if (init_checked && nia === 32'h4) begin
      // LOAD obtains GT zero from NS slot 0's location word. The nonzero
      // reset/bootstrap GT is not the post-LOAD value.
      if (cr15 !== 96'h0000003f0000000000000000)
        $fatal(1,"BOOT_LOAD_MISMATCH CR15=%h",cr15);
      $display("INIT_AND_BOOT_LOAD_PASS CR15=%h nia=%h",cr15,nia);
      $finish;
    end
  end
endmodule
"""
if trace:
    tb = tb.replace("reg init_checked=0;", """reg init_checked=0;
  reg boot_load_checked=0;
  reg [31:0] last_nia=32'hffffffff;
  integer trace_count=0;""")
    tb = tb.replace("if (init_checked && nia === 32'h4)", "if (init_checked && !boot_load_checked && nia === 32'h4)")
    tb = tb.replace("""      $finish;
    end
  end""", """      boot_load_checked=1;
    end
    if (init_checked && nia !== last_nia) begin
      if (trace_count < 256)
        $display("NIA_OBSERVATION t=%t nia=%h CR15=%h boot=%b",
          $time,nia,cr15,boot);
      if (nia === 32'h2e08)
        $display("TARGET_NIA_OBSERVED_NOT_RETIREMENT_PROOF t=%t",$time);
      last_nia=nia;
      trace_count=trace_count+1;
    end
  end""")
    # A diagnostic timeout remains a failure, never evidence of execution.
(out / "tb.sv").write_text(tb.replace("@CR15@", cr15).replace("@DATA@", data).replace("@LANES@", lanes))
(out / "inputs.sha256").write_text("".join(f"{digest}  {name}\n" for name, digest in checks.items()))
(out / "run.sh").write_text(r"""#!/usr/bin/env bash
set -eo pipefail
cd "$(dirname "$0")"
ROOT=$PWD
finish() {
  local rc=$?
  trap - EXIT
  if test -f simulation.log; then
    echo "=== Saved replay evidence ==="
    grep -E 'INIT_PAIR_PASS|ALL_INIT_PAIRS_PASS|INIT_AND_BOOT_LOAD_PASS|TARGET_NIA|BOOT_FAULT|REPLAY_TIMEOUT|BOOT_LOAD_MISMATCH|Fatal:|ERROR:' simulation.log || true
    echo "=== Last observed NIA transitions (not retirement proof) ==="
    grep '^NIA_OBSERVATION' simulation.log | tail -20 || true
  fi
  echo "$rc" > "$ROOT/exit-status"
  echo "BOOT_REPLAY_EXIT=$rc"
  exit "$rc"
}
trap finish EXIT
exec 9>/tmp/church-vivado-build.lock
flock -n 9 || { echo "Another Vivado job owns the build lock"; exit 1; }
sha256sum -c inputs.sha256
source /opt/Xilinx/2026.1/Vivado/settings64.sh
timeout --kill-after=30s 1800s xvlog --sv synth_funcsim.v tb.sv
if ! grep -q '^module glbl' synth_funcsim.v; then
  timeout 60s xvlog "$XILINX_VIVADO/data/verilog/src/glbl.v"
fi
timeout --kill-after=30s 1800s xelab work.tb work.glbl -L unisims_ver -L unimacro_ver -debug typical -s boot_replay
timeout --kill-after=30s 1800s xsim boot_replay -runall -log simulation.log
sha256sum -c inputs.sha256
grep -q '^ALL_INIT_PAIRS_PASS count=2693' simulation.log
grep -q '^INIT_AND_BOOT_LOAD_PASS ' simulation.log
if grep -Eiq 'Fatal:|ERROR:' simulation.log; then exit 1; fi
echo "INITIALIZATION_AND_FIRST_LOAD_ONLY_NOT_BOUNDS_OR_RELEASE_APPROVAL"
""")
print(f"Prepared replay: {out}")
if trace:
    runner = out / "run.sh"
    runner.write_text(runner.read_text().replace(
        'source /opt/Xilinx',
        'echo "TRACE_DIAGNOSTIC_NOT_RETIREMENT_OR_RELEASE_PROOF"\nsource /opt/Xilinx'))
    print("Scope: verify initialization/first LOAD, then observe NIA until first fault or 10 ms timeout.")
    print("Trace mode has no success exit: a fault or timeout remains nonzero; inspect the saved observations.")
else:
    print("Scope: all 2693 physical initialization writes and first boot LOAD only.")
