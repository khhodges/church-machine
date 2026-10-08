"""Prepare a hash-pinned six-pin netlist replay, with UART retirement assertions."""
import hashlib
import re
import shutil
import sys
from pathlib import Path

build, out = map(Path, sys.argv[1:])
checks = {
    "church_wukong_xc7a100t.v": "2dec82aa2cacb2f135c7fa083458851d017d9dfc74a8c9a03097b263bc8b9c92",
    "synth_funcsim.v": "03dbbc64e46f5541ca1d25ac2365c5fd88709e414b36bb537ea531558ce94b56",
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
        raise SystemExit(f"Missing RAM lane {i}")
for name in ("hw_init_done", "hw_init_wr_en", "trace_unit_state", "step_halted",
             r"\fault_recovery.fault_pending "):
    if f"wire {name};" not in net:
        raise SystemExit(f"Missing observation: {name}")
out.mkdir(parents=True, exist_ok=False)
for name in checks:
    shutil.copyfile(build / name, out / name)
cr15 = ",".join(f"dut.\\core.u_registers.cr15_reg[{i}] .Q" for i in range(95, -1, -1))
data = ",".join(f"dut.dmem_reg_1_{i}.DIADI[1:0]" for i in range(15, -1, -1))
lanes = "\n".join(f"""
      if (dut.dmem_reg_1_{i}.ENARDEN !== 1'b1 ||
          dut.dmem_reg_1_{i}.WEA[0] !== 1'b1 ||
          dut.dmem_reg_1_{i}.ADDRARDADDR[14:1] !== write_addr)
        $fatal(1,"LANE_WRITE_MISMATCH lane={i} index=%0d",count);
""" for i in range(16))
tb = r"""
`timescale 1ns/1ps
module tb;
  reg clk=0, rst_n=0;
  wire tx,led0,led1;
  wire [95:0] cr15={@CR15@};
  wire [31:0] write_data={@DATA@};
  wire [13:0] write_addr=dut.dmem_reg_1_0.ADDRARDADDR[14:1];
  reg [45:0] expected[0:2692];
  integer count=0;
  reg init_checked=0,boot_checked=0,target_shadow=0,target_checked=0;
  church_wukong_xc7a100t dut(.clk(clk),.rst_n(rst_n),.uart_rx_pin(1'b1),
    .uart_tx_pin(tx),.led0(led0),.led1(led1));
  always #10 clk=~clk;
  initial begin
    $readmemh("expected.hex",expected);
    #1000 rst_n=1;
    #30000000;
    $fatal(1,"REPLAY_TIMEOUT count=%0d boot=%b target=%b",count,boot_checked,target_checked);
  end
  always @(posedge dut.dmem_reg_1_0.CLKARDCLK) begin
    if ($time>200 && !init_checked) begin
      if (dut.hw_init_wr_en !== 1'b0 && dut.hw_init_wr_en !== 1'b1)
        $fatal(1,"UNKNOWN_INIT_ENABLE");
      if (dut.hw_init_wr_en === 1'b1) begin
        if (count>=2693) $fatal(1,"EXTRA_INIT_WRITE");
@LANES@
        if ({write_addr,write_data} !== expected[count])
          $fatal(1,"INIT_MISMATCH index=%0d actual=%h expected=%h",
            count,{write_addr,write_data},expected[count]);
        count=count+1;
      end
    end
  end
  always @(negedge clk) begin
    if (dut.hw_init_done === 1'b1 && !init_checked) begin
      if (count!=2693) $fatal(1,"INIT_COUNT_MISMATCH count=%0d",count);
      init_checked=1;
      $display("ALL_INIT_PAIRS_PASS count=%0d",count);
    end
    if (dut.\fault_recovery.fault_pending  === 1'b1)
      $fatal(1,"HARDWARE_FAULT_PENDING");
  end
  always begin
    #1000000;
    $display("PACE t=%t trace_drain=%b step_halted=%b boot=%b target=%b",
      $time,dut.trace_unit_state,dut.step_halted,boot_checked,target_checked);
  end
  integer bit_idx,packet_pos=0;
  reg [7:0] byte_value,packet[0:11];
  reg [31:0] packet_nia,packet_gt;
  reg trace_started=0;
  initial begin
    #200;
    forever begin
      @(negedge tx);
      #8680;
      if (tx !== 1'b0) $fatal(1,"UART_START_INVALID");
      for(bit_idx=0;bit_idx<8;bit_idx=bit_idx+1) begin
        #17360; byte_value[bit_idx]=tx;
      end
      #17360;
      if (tx !== 1'b1 || (^byte_value === 1'bx))
        $fatal(1,"UART_FRAME_INVALID");
      $display("UART_BYTE t=%t byte=%02h",$time,byte_value);
      if (packet_pos==0) begin
        // Before trace, only the retained startup banner/sentinel is ignored.
        // Once trace starts, never silently resynchronize a broken stream.
        if(byte_value==8'haa) begin
          trace_started=1; packet[0]=byte_value; packet_pos=1;
        end else if(trace_started) $fatal(1,"TRACE_FRAMING_INVALID");
      end else begin
        packet[packet_pos]=byte_value;
        if(packet_pos==11) begin
          packet_pos=0;
          packet_nia={packet[1],packet[2],packet[3],packet[4]};
          packet_gt={packet[6],packet[7],packet[8],packet[9]};
          $display("RETIRE_EVENT nia=%h event=%02h gt=%h flags=%02h fault=%02h",
            packet_nia,packet[5],packet_gt,packet[10],packet[11]);
          if(packet[11] !== 8'h00) $fatal(1,"TRACE_FAULT_OR_BREAK");
          if(packet_nia==0 && packet[5]==2) begin
            if(!init_checked || packet_gt !== 0 ||
               cr15 !== 96'h0000003f0000000000000000)
              $fatal(1,"BOOT_LOAD_MISMATCH CR15=%h gt=%h",cr15,packet_gt);
            boot_checked=1;
            $display("BOOT_LOAD_RETIRE_PASS CR15=%h",cr15);
          end
          if(packet_nia==32'h2e08 && packet[5]==1) target_shadow=1;
          if(packet_nia==32'h2e08 && packet[5]==2) begin
            if(!init_checked || !boot_checked || !target_shadow ||
               packet_gt !== 32'h4a000006)
              $fatal(1,"TARGET_LOAD_MISMATCH gt=%h",packet_gt);
            target_checked=1;
            $display("TARGET_LOAD_RETIRE_PASS nia=00002e08 gt=4a000006 fault=00");
            // Allow the fault latch to settle before declaring scoped success.
            #100;
            if(dut.\fault_recovery.fault_pending  !== 1'b0)
              $fatal(1,"HARDWARE_FAULT_AT_COMPLETION");
            $display("SIX_PIN_INIT_BOOT_TARGET_REPLAY_PASS");
            $finish;
          end
        end else packet_pos=packet_pos+1;
      end
    end
  end
endmodule
"""
(out / "tb.sv").write_text(tb.replace("@CR15@", cr15).replace("@DATA@", data).replace("@LANES@", lanes))
(out / "run.sh").write_text(r"""#!/usr/bin/env bash
set -eo pipefail
cd "$(dirname "$0")"
ROOT=$PWD
finish() {
  local rc=$?
  trap - EXIT
  if test -f simulation.log; then
    grep -E 'PASS|MISMATCH|Fatal:|ERROR:|TIMEOUT|FAULT|RETIRE_EVENT' simulation.log | tail -40 || true
  fi
  echo "$rc" > "$ROOT/exit-status"
  echo "SIX_PIN_REPLAY_EXIT=$rc"
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
timeout --kill-after=30s 1800s xelab work.tb work.glbl -L unisims_ver -L unimacro_ver -debug typical -s six_pin_replay
timeout --kill-after=30s 5400s xsim six_pin_replay -runall -log simulation.log
sha256sum -c inputs.sha256
if grep -Eiq 'Fatal:|ERROR:' simulation.log; then exit 1; fi
grep -q '^ALL_INIT_PAIRS_PASS count=2693' simulation.log
grep -q '^BOOT_LOAD_RETIRE_PASS ' simulation.log
grep -q '^TARGET_LOAD_RETIRE_PASS ' simulation.log
grep -q '^SIX_PIN_INIT_BOOT_TARGET_REPLAY_PASS' simulation.log
echo "SCOPED_REPLAY_VERIFIED_NOT_FULL_PROGRAM_OR_PHYSICAL_BOARD_CERTIFICATION"
""")
(out / "inputs.sha256").write_text("".join(
    f"{hashlib.sha256((out / name).read_bytes()).hexdigest()}  {name}\n"
    for name in [*checks, "tb.sv", "run.sh"]))
print(f"Prepared {out}")
print("Scope: 2693 writes, exact boot LOAD, fault-free target LOAD retirement via UART.")
