"""Package an isolated baseline/candidate Vivado test; no Wukong build or programming."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from amaranth import ClockDomain, ClockSignal, Elaboratable, Module
from amaranth.back import rtlil
from hardware.gen_rtlil import _rtlil_to_verilog
from hardware.sparse_memory_init import SparseMemoryInitializer
from hardware.sparse_memory_init_candidate import AddressedSparseMemoryInitializer

IMAGE_SHA = "2a16403e94639abac7716ea9cf56a35f5bbc6bf5e3a99e805457bcd1f563a451"


def bench(count, baseline, marker=None):
    first = "46'h000000000000" if baseline else "expected[0]"
    marker = marker or ("BASELINE_FIRST_WORD_LOSS_REPRODUCED" if baseline else "INITIALIZER_CANDIDATE_PASS")
    return f"""
`timescale 1ns/1ps
module tb;
  reg clk=0;
  always #20 clk=~clk;
  reg enable=0;
  wire done, write_en;
  wire [13:0] write_addr;
  wire [31:0] write_data;
  reg [45:0] expected [0:{count-1}];
  // An observation sink, never preloaded with the expected image.
  reg [31:0] observed [0:16383];
  integer n=0, cycle=0, completed=0, i;
  initializer dut(.clk(clk), .enable(enable), .done(done),
    .write_en(write_en), .write_addr(write_addr), .write_data(write_data));
  initial $readmemh("pairs.hex", expected);
  always @(negedge clk)
    enable=(cycle>=20 && (completed!=0 || (cycle%7!=1 && cycle%7!=2 && cycle%7!=4)));
  always @(posedge clk) begin
    cycle=cycle+1;
    if (write_en !== 0 && write_en !== 1) $fatal(1,"UNKNOWN_WRITE_ENABLE");
    if (write_en) begin
      if (!enable || done || n>={count}) $fatal(1,"UNEXPECTED_WRITE");
      if ({{write_addr,write_data}} !== (n==0 ? {first} : expected[n]))
        $fatal(1,"WRITE_MISMATCH index=%0d actual=%h expected=%h",
          n,{{write_addr,write_data}},expected[n]);
      observed[write_addr]=write_data;
      if(n==0) $display("FIRST_WRITE addr=%h data=%h",write_addr,write_data);
      n=n+1;
    end
    if (done === 1) begin
      if(n!={count}) $fatal(1,"EARLY_DONE");
      if(completed==0) completed=cycle;
      if(cycle==completed+8) begin
        for(i=1;i<{count};i=i+1)
          if(observed[expected[i][45:32]] !== expected[i][31:0])
            $fatal(1,"SINK_MISMATCH index=%0d",i);
        $display("{marker}");
        $finish;
      end
    end else if(completed!=0) $fatal(1,"DONE_NOT_STICKY");
    if(cycle>{count}*12+100) $fatal(1,"DEADLINE");
  end
endmodule
"""


def prepare(output):
    output = output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    image = ROOT / "docs/phase-1/reload-evidence/new-layout-amoeba-runtime/candidate-le.bin"
    raw = image.read_bytes()
    if len(raw) != 65536 or hashlib.sha256(raw).hexdigest() != IMAGE_SHA:
        raise ValueError("Retained image mismatch")
    pairs = [(i, w) for i, w in enumerate(struct.unpack("<16384I", raw)) if w]
    (output / "pairs.hex").write_text("".join(f"{a:04x}{w:08x}\n" for a, w in pairs))

    class Wrapper(Elaboratable):
        def __init__(self, child):
            self.child = child

        def elaborate(self, platform):
            m = Module()
            m.domains.sync = ClockDomain("sync", reset_less=True)
            m.submodules.initializer = self.child
            return m

    for name, cls in (("baseline", SparseMemoryInitializer),
                      ("candidate", AddressedSparseMemoryInitializer)):
        dut = cls(pairs)
        il = output / f"{name}.il"
        il.write_text(rtlil.convert(Wrapper(dut), name="top", ports=[
            ClockSignal(), dut.enable, dut.done, dut.write_en, dut.write_addr, dut.write_data]))
        _rtlil_to_verilog(str(il), str(output / f"{name}.v"), "initializer")
        (output / f"{name}-tb.v").write_text(bench(len(pairs), name == "baseline"))
        # Plain RTL is checked locally too; baseline has a different source-level oracle.
        rtl_marker = f"RTL_{name.upper()}_PASS"
        (output / "rtl-tb.v").write_text(bench(len(pairs), False, marker=rtl_marker))
        with tempfile.TemporaryDirectory(prefix="rtl-", dir=output) as work:
            executable = str(Path(work) / "probe.sim")
            subprocess.run(["iverilog", "-g2012", "-s", "tb", "-o", executable,
                            str(output / f"{name}.v"), str(output / "rtl-tb.v")], check=True)
            result = subprocess.run(["vvp", executable],
                                    text=True, capture_output=True, check=True, timeout=30,
                                    cwd=output)
        if rtl_marker not in result.stdout:
            raise ValueError(f"{name} RTL oracle failed")
        (output / f"{name}-rtl.log").write_text(result.stdout)
    (output / "rtl-tb.v").unlink()
    for name in ("sparse_memory_init.py", "sparse_memory_init_candidate.py"):
        shutil.copy2(ROOT / "hardware" / name, output / name)
    (output / "synth.tcl").write_text("""
set_param general.maxThreads 2
create_project -in_memory -part xc7a100tfgg676-2
read_verilog input.v
synth_design -top initializer -part xc7a100tfgg676-2
create_clock -name clk -period 40 [get_ports clk]
report_utilization -file utilization.txt
write_checkpoint synthesized.dcp
write_verilog -mode funcsim mapped.v
puts "SYNTHESIS_EXPORT_COMPLETE"
""")
    (output / "case.sh").write_text("""#!/usr/bin/env bash
set -euo pipefail
mode=$1
mkdir "$mode-work"
cp "$mode.v" "$mode-work/input.v"
cp "$mode-tb.v" "$mode-work/tb.v"
cp pairs.hex "$mode-work/"
cd "$mode-work"
timeout 10m vivado -mode batch -nolog -nojournal -source ../synth.tcl 2>&1 | tee synth.log
grep -qx SYNTHESIS_EXPORT_COMPLETE synth.log
timeout 2m xvlog mapped.v tb.v "$XILINX_VIVADO/data/verilog/src/glbl.v"
timeout 5m xelab -L unisims_ver -L secureip tb glbl -s probe
timeout 3m xsim probe -runall 2>&1 | tee simulation.txt
if [ "$mode" = baseline ]; then
  grep -qx BASELINE_FIRST_WORD_LOSS_REPRODUCED simulation.txt
else
  grep -qx INITIALIZER_CANDIDATE_PASS simulation.txt
fi
""")
    (output / "run.sh").write_text("""#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
: "${XILINX_VIVADO:?Source Vivado settings64.sh first}"
sha256sum -c inputs.sha256
test ! -e baseline-work && test ! -e candidate-work
failed=0
for mode in baseline candidate; do
  if bash case.sh "$mode" > "$mode.log" 2>&1; then
    echo "$mode: expected result confirmed"
  else
    echo "$mode: failed or inconclusive; inspect $mode.log"
    failed=1
  fi
done
sha256sum -c inputs.sha256
if [ "$failed" != 0 ]; then exit 1; fi
echo 'FOCUSED_SYNTHESIS_COMPARISON_PASS'
echo 'Not full-design, timing, programming, or physical reload approval.'
""")
    manifest = {
        "purpose": "Isolated reset-less initializer comparison, not programming approval",
        "image_sha256": IMAGE_SHA, "pairs": len(pairs), "first_pair": pairs[0],
        "candidate": "Explicit ISSUE/FETCH/WRITE phases; no Wukong integration",
        "verilog_emitter_sha256": hashlib.sha256((ROOT / "hardware/gen_rtlil.py").read_bytes()).hexdigest(),
        "yosys_version": subprocess.check_output(["yosys", "-V"], text=True).strip(),
        "vendor_test_status": "pending", "physical_test_status": "pending",
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    files = sorted(output.iterdir())
    (output / "inputs.sha256").write_text("".join(
        f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n" for p in files))
    with zipfile.ZipFile(output.with_suffix(".zip"), "x", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(output.iterdir()):
            archive.write(path, f"{output.name}/{path.name}")
    print("PACKAGE", output.with_suffix(".zip"))
    print("SHA256", hashlib.sha256(output.with_suffix(".zip").read_bytes()).hexdigest())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    prepare(parser.parse_args().output)
