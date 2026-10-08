"""Prepare an offline, paired synthesis experiment, not a production RTL patch."""
import hashlib
import json
import re
import sys
from pathlib import Path

SOURCE_SHA = "6475c1e07556e5e98674afbca5ea2a4fbf5d3238ff093c9d7e52b3d91b3bcf6e"
HELPER_SHA = "4397c052322e51df9682117afde40595297f9550048848402e96cab357bf60a1"


def prepare_pairs(pairs, out):
    from amaranth import ClockDomain, Module
    from amaranth.back import rtlil
    from hardware.sparse_memory_init import SparseMemoryInitializer
    from hardware.gen_rtlil import _rtlil_to_verilog

    out.mkdir(parents=True, exist_ok=False)
    dut = SparseMemoryInitializer(pairs)
    wrapper = Module()
    domain = ClockDomain("sync", reset_less=True)
    wrapper.domains += domain
    wrapper.submodules.initializer = dut
    il = out / "initializer.il"
    il.write_text(rtlil.convert(wrapper, ports=[domain.clk,
        dut.enable, dut.done, dut.write_en, dut.write_addr, dut.write_data]))
    baseline = out / "baseline.v"
    if not _rtlil_to_verilog(str(il), str(baseline), module_name="init_probe"):
        raise RuntimeError("Release Verilog conversion failed")
    text = baseline.read_text()
    # The release emitter uses -noattr, so an Amaranth memory attribute alone
    # would disappear. Inject only into this isolated experimental output.
    candidate, n = re.subn(
        r"(?m)^(\s*reg \[45:0\] [^\n;]+\[[^\n;]+\];)",
        r'  (* rom_style = "distributed", ram_style = "distributed" *)\n\1', text)
    if n != 1:
        raise RuntimeError(f"Expected one 46-bit ROM declaration, found {n}")
    (out / "candidate.v").write_text(candidate)
    expected = "".join(f"{(a << 32) | d:012x}\n" for a, d in pairs)
    count = len(pairs)
    tb = r"""
`timescale 1ns/1ps
module tb;
  reg clk=0, rst=1, enable=0;
  wire done, write_en;
  wire [13:0] write_addr;
  wire [31:0] write_data;
  reg [45:0] expected [0:@LAST@];
  integer count=0, cycles=0, finished_cycles=0;
  init_probe dut(.clk(clk),.enable(enable),.done(done),
    .write_en(write_en),.write_addr(write_addr),.write_data(write_data));
  always #10 clk=~clk;
  initial begin
    $readmemh("expected.hex", expected);
    #201 rst=0;
    #200 enable=1;
    #@DEADLINE@;
    $fatal(1,"MICROTEST_TIMEOUT count=%0d",count);
  end
  always @(posedge clk) begin
    if (!rst && $time > 400) begin
      if (write_en !== 1'b0 && write_en !== 1'b1)
        $fatal(1,"UNKNOWN_WRITE_ENABLE");
      if (write_en) begin
        if (!enable || done || count >= @COUNT@)
          $fatal(1,"UNEXPECTED_WRITE count=%0d",count);
        if ({write_addr,write_data} !== expected[count])
          $fatal(1,"PAIR_MISMATCH index=%0d actual=%h expected=%h",
            count,{write_addr,write_data},expected[count]);
        if (count == 0 || count == @LAST@)
          $display("PAIR_OK index=%0d value=%h",count,{write_addr,write_data});
        count=count+1;
      end
    end
  end
  always @(negedge clk) begin
    #1;
    if (!rst && $time > 401) begin
      cycles=cycles+1;
      if (done === 1'b1) begin
        if (count != @COUNT@) $fatal(1,"EARLY_DONE count=%0d",count);
        enable=1;
        finished_cycles=finished_cycles+1;
        if (finished_cycles == 5) begin
          $display("INITIALIZER_MICROTEST_PASS count=%0d",count);
          $finish;
        end
      end else begin
        if (finished_cycles != 0) $fatal(1,"DONE_NOT_STICKY");
        // Exercise pauses in both fetch and write phases.
        enable=(cycles % 13 != 5 && cycles % 13 != 6);
      end
    end
  end
endmodule
"""
    tb = (tb.replace("@COUNT@", str(count)).replace("@LAST@", str(count - 1))
          .replace("@DEADLINE@", str(count * 200 + 10000)))
    for variant in ("baseline", "candidate"):
        folder = out / variant
        folder.mkdir()
        (folder / "expected.hex").write_text(expected)
        (folder / "tb.sv").write_text(tb)
    (out / "synth.tcl").write_text(r"""
set_param general.maxThreads 2
foreach variant {baseline candidate} {
  create_project -in_memory -part xc7a100tfgg676-2
  read_verilog $variant.v
  synth_design -top init_probe -part xc7a100tfgg676-2 -mode out_of_context
  report_utilization -file $variant/utilization.txt
  set brams [llength [get_cells -hier -filter {REF_NAME =~ RAMB*}]]
  puts "MAPPING_EVIDENCE variant=$variant brams=$brams"
  if {$variant eq "candidate" && $brams != 0} {
    error "Candidate did not avoid block RAM mapping"
  }
  write_checkpoint -force $variant/synth.dcp
  write_verilog -force -mode funcsim $variant/netlist.v
  close_project
}
exit
""")
    (out / "run.sh").write_text(r"""#!/usr/bin/env bash
set -eo pipefail
cd "$(dirname "$0")"
ROOT=$PWD
trap 'rc=$?; echo "$rc" > "$ROOT/exit-status"; echo "MICROTEST_EXIT=$rc"' EXIT
exec 9>/tmp/church-vivado-build.lock
flock -n 9 || { echo "Another Vivado job owns the build lock"; exit 1; }
source /opt/Xilinx/2026.1/Vivado/settings64.sh
timeout --kill-after=10s 1200s vivado -mode batch -source synth.tcl -log synth.log
for variant in baseline candidate; do
  if (
    cd "$ROOT/$variant"
    timeout --kill-after=10s 180s xvlog --sv netlist.v tb.sv || exit $?
    if ! grep -q '^module glbl' netlist.v; then
      timeout 60s xvlog "$XILINX_VIVADO/data/verilog/src/glbl.v" || exit $?
    fi
    timeout --kill-after=10s 300s xelab work.tb work.glbl \
      -L unisims_ver -L unimacro_ver -debug typical -s microtest || exit $?
    timeout --kill-after=10s 180s xsim microtest -runall -log simulation.log || exit $?
  ) > "$ROOT/$variant/run.log" 2>&1; then
    echo 0 > "$ROOT/$variant/tool-status"
  else
    echo "$?" > "$ROOT/$variant/tool-status"
    echo "$variant tool run failed; inspect $variant/run.log"
    tail -60 "$ROOT/$variant/run.log"
  fi
  echo "=== $variant ==="
  grep -E 'PAIR_|MICROTEST_|Fatal|ERROR:' "$ROOT/$variant/run.log" || true
done
test "$(cat candidate/tool-status)" = 0
grep -q '^INITIALIZER_MICROTEST_PASS ' candidate/run.log
if grep -q 'PAIR_MISMATCH index=0 actual=000000000000' baseline/run.log; then
  echo "CANDIDATE_PASSES_WITH_ORIGINAL_FIRST_WRITE_FAILURE_REPRODUCED"
else
  echo "CANDIDATE_PASSES_BUT_BASELINE_FAILURE_NOT_REPRODUCED"
  echo "Do not infer a controlled fix from this isolated harness."
  exit 2
fi
echo "EXPERIMENT_ONLY_NOT_FULL_SYSTEM_OR_RELEASE_APPROVAL"
""")
    return {"pairs": count, "expected_sha256": hashlib.sha256(expected.encode()).hexdigest()}


def main():
    root, source, out = (Path(p).resolve() for p in sys.argv[1:])
    if hashlib.sha256(source.read_bytes()).hexdigest() != SOURCE_SHA:
        raise SystemExit("Wrong retained generated source")
    helper = root / "hardware/sparse_memory_init.py"
    if hashlib.sha256(helper.read_bytes()).hexdigest() != HELPER_SHA:
        raise SystemExit("Initializer source differs from the tested baseline")
    rows = re.findall(r"(\S*init_rom)\s*\[(\d+)\]\s*=\s*46'h([0-9a-fA-F]+)", source.read_text())
    if not rows or len({name for name, _, _ in rows}) != 1:
        raise SystemExit("Expected exactly one explicit initialization ROM")
    entries = sorted((int(i), int(v, 16)) for _, i, v in rows)
    if [i for i, _ in entries] != list(range(len(entries))):
        raise SystemExit("Non-contiguous ROM")
    if entries[0][1] != (1 << 32) | 63:
        raise SystemExit("First entry is not word1/63")
    sys.path.insert(0, str(root))
    info = prepare_pairs([(v >> 32, v & 0xffffffff) for _, v in entries], out)
    info.update(source_sha256=SOURCE_SHA, initializer_sha256=HELPER_SHA,
                experiment_sha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest())
    (out / "inputs.json").write_text(json.dumps(info, indent=2) + "\n")
    print(json.dumps(info, indent=2))
    print("Prepared isolated baseline/candidate experiment. Production source unchanged.")


if __name__ == "__main__":
    main()
