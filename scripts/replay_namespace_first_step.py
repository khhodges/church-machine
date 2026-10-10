#!/usr/bin/env python3
"""Stop the retained optimized-model simulation after the first instruction.

Not a mapped-netlist/board test or a test of the physical Step command.
Never imports the live catalog or changes immutable release inputs.
"""
import argparse
import hashlib
import json
from pathlib import Path
import tarfile

from verify_sparse_initializer_synthesis import hashes, retained_pairs, run

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--through-change", action="store_true",
                        help="Stop after the second instruction; dump Thread/Heap state")
    parser.add_argument("--through-call", action="store_true",
                        help="Stop after boot CALL; observe actual stack writes")
    args = parser.parse_args()
    out = args.output.resolve()
    if out.is_relative_to(ROOT / "server"):
        parser.error("Output must not be under server/")
    out.mkdir(parents=True, exist_ok=False)
    snapshot = ROOT / "server/build-snapshots/revisions/namespace/3a53c8ebe99bcccb3eb1c4371c8c897851853d60cd7d64d66c0343f69b502166"
    bundle = ROOT / "reports/sparse-initializer-followup-evidence-2026-10-07.tar.gz"
    before = hashes(snapshot)
    report = {
        "through_change": args.through_change,
        "through_call": args.through_call,
        "status": "failed",
        "scope": "Archived optimized full-system candidate model, not mapped production RTL",
        "board_access": False,
        "snapshot_hashes": before,
        "bundle_sha256": hashlib.sha256(bundle.read_bytes()).hexdigest(),
    }
    try:
        revision = json.loads((snapshot / "revision.json").read_text())
        for name, expected in revision["files"].items():
            if before[name] != expected:
                raise ValueError(f"Approved snapshot hash mismatch: {name}")
        with tarfile.open(bundle) as archive:
            for name in ("full.v", "pairs.hex", "pairs.json"):
                (out / name).write_bytes(archive.extractfile(name).read())
        pairs = retained_pairs((snapshot / "church_wukong_xc7a100t.il").read_text())
        if json.loads((out / "pairs.json").read_text()) != list(map(list, pairs)):
            raise ValueError("Archived model inputs differ from approved initializer")
        expected_hex = [(a << 32) | v for a, v in pairs]
        if [int(v, 16) for v in (out / "pairs.hex").read_text().split()] != expected_hex:
            raise ValueError("pairs.hex differs from approved initializer")
        if pairs[0] != (1, 63):
            raise ValueError("Unexpected Namespace limit input")
        # Read register storage directly, not the trace or serial snapshot.
        dump = "\n".join(
            f'      $display("CR{i} w2_base_gt=%024h", dut.\\core.u_registers.cr{i} );'
            for i in range(16)
        )
        dump += "\n" + "\n".join(
            f'      $display("DR{i}=%08h", dut.\\core.u_registers.dr{i} );'
            for i in range(1, 16)
        )
        bench = r"""
`timescale 1ns/1ps
module tb;
  reg clk = 0;
  always #5 clk = ~clk;
  wire done, write_en, dbg_boot_complete, dbg_fault_valid, retire_valid, retire_fault_valid;
  wire [13:0] write_addr;
  wire [31:0] write_data, dbg_nia, dbg_fault, retire_nia, debug_cr15_word2;
  full dut(.clk(clk), .rst_n(1'b1), .uart_rx_pin(1'b1),
    .dbg_boot_complete(dbg_boot_complete), .dbg_fault_valid(dbg_fault_valid),
    .dbg_nia(dbg_nia), .dbg_fault(dbg_fault), .retire_valid(retire_valid),
    .retire_nia(retire_nia), .retire_fault_valid(retire_fault_valid),
    .debug_cr15_word2(debug_cr15_word2), .done(done),
    .write_en(write_en), .write_addr(write_addr), .write_data(write_data));
  reg [45:0] expected [0:COUNT-1];
  integer n = 0, cycles = 0;
  integer retired = 0;
  reg saw_before = 0;
  initial $readmemh("pairs.hex", expected);
  always @(posedge clk) begin
    cycles = cycles + 1;
    if (dut.\core.u_call.local_mem_wr_en )
      $display("CALL_WRITE cycle=%0d addr=%08h data=%08h thread_base=%08h",
        cycles, dut.\core.u_call.local_mem_wr_addr ,
        dut.\core.u_call.local_mem_wr_data , dut.\core.u_call.thread_base );
    if (write_en === 1'bx) $fatal(1, "unknown initializer enable");
    if (write_en) begin
      if (n >= COUNT) $fatal(1, "extra initialization write");
      if ({write_addr,write_data} !== expected[n]) $fatal(1, "initializer mismatch %0d", n);
      if (n == 0 || n == COUNT-1)
        $display("INITIALIZER index=%0d word=%0d value=%08h", n, write_addr, write_data);
      n = n + 1;
    end
    if (dbg_boot_complete && !saw_before) begin
      saw_before = 1;
      $display("BEFORE cycle=%0d", cycles);
DUMP
      if (dut.\core.u_registers.cr15 !== 96'h00000012_00000000_1a000000)
        $fatal(1, "unexpected bootstrap CR15");
    end
    if (dbg_fault_valid === 1'b1 || retire_fault_valid === 1'b1)
      $fatal(1, "FAULT nia=%08h code=%h", dbg_nia, dbg_fault);
    if (retire_valid === 1'b1) begin
      retired = retired + 1;
      $display("RETIRE nia=%08h instruction=%08h", retire_nia, dut.\core.retire_instr );
      if (retired == 1 && (retire_nia !== 0 || dut.\core.retire_instr !== 32'h077f8000))
        $fatal(1, "not the expected Namespace LOAD");
      if (retired == 2 && retire_nia !== 4)
        $fatal(1, "not the expected CHANGE address");
      if (retired == 3 && (retire_nia !== 8 || dut.\core.retire_instr !== 32'h17000000))
        $fatal(1, "not the expected CALL");
      // Observe committed storage after the current clock's nonblocking writes.
      #1;
      $display("AFTER instruction=%0d cycle=%0d", retired, cycles);
      $display("ACTIVE_THREAD_BASE=%08h", dut.\core.active_thread_base );
DUMP
      if (!saw_before || n != COUNT ||
          dut.\core.u_registers.cr15 !== 96'h0000003f_00000000_00000000)
        $fatal(1, "Namespace LOAD state mismatch");
      if (retired == STOP_AFTER) begin
        $display("PASS_REVIEW_BOUNDARY instructions=%0d", retired);
        $finish;
      end
    end
    if (cycles >= 900000) $fatal(1, "instruction deadline");
  end
endmodule
""".replace("COUNT", str(len(pairs))).replace("DUMP", dump).replace(
            "STOP_AFTER", "3" if args.through_call else "2" if args.through_change else "1")
        (out / "tb.v").write_text(bench)
        report["input_hashes"] = hashes(out)
        run(["iverilog", "-g2012", "-s", "tb", "-o", "step.sim", "full.v", "tb.v"],
            out, "compile", seconds=240)
        run(["vvp", "step.sim"], out, "simulation", seconds=240)
        if "PASS_REVIEW_BOUNDARY" not in (out / "simulation.log").read_text():
            raise ValueError("Simulation exited without pass marker")
        report["status"] = "reached-review-boundary-model-only"
    finally:
        report["snapshot_unchanged"] = hashes(snapshot) == before
        (out / "report.json").write_text(json.dumps(report, indent=2) + "\n")
        if not report["snapshot_unchanged"]:
            raise RuntimeError("Immutable snapshot changed")


if __name__ == "__main__":
    main()
