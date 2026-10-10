#!/usr/bin/env python3
"""Isolated synthesis/replay against an explicitly selected immutable snapshot.

Never routes, writes release artifacts, or communicates with a board. Outputs
are diagnostic evidence, not an FPGA release approval.
"""
import argparse
import faulthandler
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def hashes(path):
    return {str(p.relative_to(path)): digest(p)
            for p in sorted(path.rglob("*")) if p.is_file()
            and "__pycache__" not in p.parts}


def run(command, directory, label, seconds=600):
    """Retain all output, including deadlines; kill the entire owned tool group."""
    with (directory / f"{label}.log").open("w") as log:
        log.write(f"COMMAND {command!r}\n")
        log.flush()
        proc = subprocess.Popen(command, cwd=directory, stdout=log,
                                stderr=subprocess.STDOUT, start_new_session=True)
        try:
            code = proc.wait(timeout=seconds)
        except subprocess.TimeoutExpired:
            log.write(f"\nFAIL deadline {seconds}s\n")
            raise
        finally:
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            proc.wait()
        log.write(f"\nEXIT {code}\n")
        if code:
            raise RuntimeError(f"{label} failed ({code}); see {log.name}")


def retained_pairs(text):
    cells = re.findall(r"  cell \$meminit_v2 .*?\n  end", text, re.S)
    cells = [c for c in cells if 'parameter \\MEMID "\\\\init_rom"' in c]
    if len(cells) != 1:
        raise ValueError("Expected one retained initialization ROM")
    bits = re.search(r"connect \\DATA (\d+)'([01]+)", cells[0])
    width, data = int(bits[1]), bits[2]
    if width != len(data) or width % 46:
        raise ValueError("Malformed retained initialization ROM")
    words = [int(data[i:i + 46], 2) for i in range(0, width, 46)][::-1]
    return [(w >> 32, w & 0xffffffff) for w in words]


def elaborate(work, initializer_only=False):
    """Runs in a new Python process, using only the staged source/catalog."""
    sys.path.insert(0, str(work / "source"))
    os.environ["CHURCH_LUMPS_DIR"] = str(work / "catalog")
    from amaranth.back import rtlil
    from amaranth.hdl import Fragment
    from hardware.sparse_memory_init import SparseMemoryInitializer
    expected = json.loads((work / "pairs.json").read_text())
    isolated = SparseMemoryInitializer(expected)
    (work / "initializer.il").write_text(rtlil.convert(
        isolated, name="initializer", ports=[
            isolated.enable, isolated.done, isolated.write_en,
            isolated.write_addr, isolated.write_data]))
    print("Initializer RTLIL emitted", flush=True)
    if initializer_only:
        return
    from hardware import gen_rtlil

    def observed_convert(dut, ports):
        fragment = Fragment.get(dut, None)
        children = {name: f for f, name, _ in fragment.subfragments}
        init = children["initializer"].origins[0]
        if list(map(list, init.pairs)) != expected:
            raise ValueError("Fresh hardware pairs differ from approved retained ROM")
        core = children["core"].origins[0]
        ports += [init.enable, init.done, init.write_en, init.write_addr, init.write_data,
                  core.retire_valid, core.retire_nia, core.retire_fault_valid,
                  core.debug_cr_words[15][2]]
        return rtlil.convert(fragment, name="full", ports=ports)

    # Reuse the release generator's established AST memoization, rather than
    # running an unbounded bare Amaranth traversal. No routing/image generation.
    gen_rtlil.convert = observed_convert
    gen_rtlil._rtlil_to_verilog = lambda *a, **kw: None
    generated = gen_rtlil.generate_rtlil_wukong(str(work / "generated"))
    shutil.copy2(generated, work / "full.il")
    print(f"EXACT_PAIRS {len(expected)} first={expected[0]} last={expected[-1]}")


def bench(count, full=False):
    connection = """
  wire dbg_boot_complete, dbg_fault_valid, retire_valid, retire_fault_valid;
  wire [31:0] dbg_nia, dbg_fault, retire_nia, debug_cr15_word2;
  full dut(.clk(clk), .rst_n(1'b1), .uart_rx_pin(1'b1),
    .dbg_boot_complete(dbg_boot_complete), .dbg_fault_valid(dbg_fault_valid),
    .dbg_nia(dbg_nia), .dbg_fault(dbg_fault), .retire_valid(retire_valid),
    .retire_nia(retire_nia), .retire_fault_valid(retire_fault_valid),
    .debug_cr15_word2(debug_cr15_word2),
    .done(done), .write_en(write_en), .write_addr(write_addr), .write_data(write_data));
""" if full else """
  initializer dut(.clk(clk), .rst(1'b0), .enable(enable),
    .done(done), .write_en(write_en), .write_addr(write_addr), .write_data(write_data));
"""
    boot = """
      if (dbg_fault_valid === 1'b1 || retire_fault_valid === 1'b1)
        $fatal(1, "BOOT_FAULT nia=%h fault=%h cycle=%0d", dbg_nia, dbg_fault, cycle);
      if (retire_valid === 1'b1) begin
        $display("RETIRE cycle=%0d nia=%h", cycle, retire_nia);
        if (retire_nia === 32'h2e08) saw_bounds = 1;
        if (saw_bounds && retire_nia === 32'h2e0c) begin
          if (n != COUNT || ram[1] !== 32'd63 || !dbg_boot_complete ||
              debug_cr15_word2 !== 32'd63)
            $fatal(1, "Boot passed address without valid initialization");
          $display("PASS_BOOT_PAST_2E08 cycle=%0d ns_limit=%0d cr15_limit=%0d",
                   cycle, ram[1], debug_cr15_word2);
          $finish;
        end
      end
""" if full else """
      if (done === 1'b1) begin
        if (n != COUNT || ram[1] !== 32'd63)
          $fatal(1, "Missing writes or namespace limit");
        if (complete_cycle == 0) complete_cycle = cycle;
        if (cycle == complete_cycle + 8) begin
          $display("PASS_INITIALIZER count=%0d ns_limit=%0d", n, ram[1]);
          $finish;
        end
      end
"""
    return f"""
`timescale 1ns/1ps
module tb;
  localparam COUNT = {count};
  reg clk = 0;
  always #5 clk = ~clk;
  reg enable = 0;
  wire done, write_en;
  wire [13:0] write_addr;
  wire [31:0] write_data;
  reg [45:0] expected [0:COUNT-1];
  // Deliberately uninitialized: no simulation-only memory preload.
  reg [31:0] ram [0:16383];
  integer n = 0, cycle = 0, complete_cycle = 0;
  reg saw_bounds = 0;
  {connection}
  initial $readmemh("pairs.hex", expected);
  always @(negedge clk) enable = (cycle > 3 && cycle % 5 != 1 && cycle % 5 != 2);
  always @(posedge clk) begin
    cycle = cycle + 1;
    if (write_en === 1'bx) $fatal(1, "Unknown write enable");
    if (write_en) begin
      if (n >= COUNT) $fatal(1, "Extra write");
      if ({{write_addr,write_data}} !== expected[n])
        $fatal(1, "Write mismatch index=%0d addr=%h data=%h expected=%h",
               n, write_addr, write_data, expected[n]);
      ram[write_addr] = write_data;
      $display("WRITE %0d %0d %08h", n, write_addr, write_data);
      n = n + 1;
    end
    {boot}
    if (cycle == 5000000) $fatal(1, "TIMEOUT writes=%0d", n);
  end
endmodule
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("snapshot", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--unisim-dir", type=Path,
                        help="XilinxUnisimLibrary verilog/src directory (hashed and copied)")
    args = parser.parse_args()
    snapshot, output = args.snapshot.resolve(), args.output.resolve()
    protected = ROOT / "server/build-snapshots/revisions"
    if output.is_relative_to(protected) or output.is_relative_to(snapshot):
        parser.error("Evidence output must not be inside immutable snapshots")
    output.mkdir(parents=True, exist_ok=False)
    before = hashes(snapshot)
    report = {"status": "failed", "release_approved": False,
              "snapshot": str(snapshot.relative_to(ROOT)),
              "snapshot_hashes": before, "stages": []}
    work = Path(tempfile.mkdtemp(prefix="sparse-synth-"))
    report["temporary_directory"] = str(work)
    try:
        revision = json.loads((snapshot / "revision.json").read_text())
        for name, expected in revision["files"].items():
            if digest(snapshot / name) != expected:
                raise ValueError(f"Snapshot hash mismatch: {name}")
        if revision["metadata"]["approval_state"] != "approved":
            raise ValueError("Snapshot not approved")
        pairs = retained_pairs((snapshot / "church_wukong_xc7a100t.il").read_text())
        if pairs[0] != (1, 63):
            raise ValueError("Snapshot does not reproduce the first-write incident")
        (work / "pairs.json").write_text(json.dumps(pairs))
        (work / "pairs.hex").write_text("".join(f"{a:04x}{d:08x}\n" for a, d in pairs))
        source = work / "source"
        for folder in ("hardware", "shared"):
            shutil.copytree(ROOT / folder, source / folder,
                            ignore=shutil.ignore_patterns("__pycache__"))
        (source / "server").mkdir()
        for file in (ROOT / "server").glob("*.py"):
            shutil.copy2(file, source / "server" / file.name)
        shutil.copy2(Path(__file__), work / "driver.py")
        if args.unisim_dir:
            shutil.copytree(args.unisim_dir.resolve(), work / "unisim")
        catalog = work / "catalog"
        catalog.mkdir()
        shutil.copy2(snapshot / "namespace.json", catalog / "ns-state.json")
        shutil.copy2(snapshot / "approvals.json", catalog / "approvals.json")
        for row in revision["metadata"]["selected_lumps"]:
            shutil.copy2(snapshot / (row["binary_hash"] + ".lump"),
                         catalog / row["filename"])
        report["source_hashes"] = hashes(source)
        report["catalog_hashes"] = hashes(catalog)
        run([sys.executable, str(work / "driver.py"), "--initializer", str(work)],
            work, "initializer-elaborate", 120)
        report["blockers"] = []
        for name in ("generic", "initializer", "full", "mixed"):
            try:
                verify_stage(work, name, len(pairs), report)
            except Exception as exc:
                report["blockers"].append(f"{name}: {type(exc).__name__}: {exc}")
        report["status"] = "blocked" if report["blockers"] else "passed"
    except Exception as exc:
        report["error"] = f"{type(exc).__name__}: {exc}"
    finally:
        report["snapshot_unchanged"] = before == hashes(snapshot)
        report["staged_inputs_unchanged"] = all(
            report[key] == hashes(work / folder)
            for key, folder in (("source_hashes", "source"), ("catalog_hashes", "catalog"))
            if key in report)
        if not report["snapshot_unchanged"] or not report["staged_inputs_unchanged"]:
            report["status"] = "failed"
        report["evidence_hashes"] = hashes(work)
        # Retain exact inputs/netlists/logs, but not large disposable executables.
        shutil.copytree(work, output / "evidence",
                        ignore=shutil.ignore_patterns("*.sim", "__pycache__"))
        (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
        print(json.dumps({k: report.get(k) for k in
                          ("status", "stages", "error", "blockers", "snapshot_unchanged")}, indent=2))
    return int(report["status"] != "passed")


def verify_stage(work, name, count, report):
    full = name in ("full", "mixed")
    if name == "full":
        run([sys.executable, str(work / "driver.py"), "--elaborate", str(work)],
            work, "elaborate", 180)
        report["stages"].append("fresh full hardware elaboration; exact retained pairs")
    # XC7 BRAM/FF/LUT mapping is performed on the actual initializer.
    # Whole-system word-level synthesis is separate diagnostic evidence.
    passes = ("proc; flatten; opt; memory -nomap; opt; check" if full else
              "synth_xilinx -family xc7 -top initializer; check")
    if name == "generic":
        passes = "synth -top initializer; check"
    if name == "mixed":
        if not (work / "unisim").is_dir():
            raise ValueError("Mixed mapped replay requires functional --unisim-dir")
        if "module \\full.initializer\n" not in (work / "full.il").read_text():
            raise ValueError("Full design lacks the expected initializer boundary")
        # Map the actual reset-less fragment from the same production
        # elaboration. Never substitute the reset-bearing standalone DUT.
        run(["yosys", "-Q", "-p",
             "read_rtlil full.il; hierarchy -top full.initializer; "
             "synth_xilinx -family xc7 -top full.initializer; check; "
             "write_verilog -noattr production-initializer.v"],
            work, "production-initializer-synthesis", 900)
        mapped = (work / "production-initializer.v").read_text()
        if re.search(r"\binput\b[^;]*\brst\b", mapped):
            raise ValueError("Production initializer unexpectedly has a reset port")
        passes = ("blackbox full.initializer; hierarchy -top full; proc; flatten; "
                  "opt; memory -nomap; opt; check")
    input_name = "full" if full else "initializer"
    run(["yosys", "-Q", "-p",
         f"read_rtlil {input_name}.il; {passes}; write_verilog -noattr {name}.v"],
        work, name + "-synthesis", 900)
    if name == "mixed" and not re.search(
            r"\\full\.initializer\s+initializer\s*\(",
            (work / "mixed.v").read_text()):
        raise ValueError("Mapped initializer instance missing from mixed netlist")
    (work / "tb.v").write_text(bench(count, full))
    shutil.copy2(work / "tb.v", work / f"{name}-tb.v")
    command = ["iverilog", "-g2012", "-s", "tb", "-o", name + ".sim",
               "tb.v", name + ".v"]
    if name == "mixed":
        command += ["production-initializer.v",
                    "-s", "glbl", "-y", "unisim/unisims", "unisim/glbl.v"]
    elif name == "initializer":
        if (work / "unisim").is_dir():
            command += ["-s", "glbl", "-y", "unisim/unisims", "unisim/glbl.v"]
        else:
            datdir = subprocess.check_output(
                ["yosys-config", "--datdir"], text=True).strip()
            primitive = Path(datdir) / "xilinx/cells_sim.v"
            # Stub-only libraries fail the replay; never waive unknown output.
            shutil.copy2(primitive, work / "xilinx-cells_sim.v")
            command += ["xilinx-cells_sim.v"]
    run(command, work, name + "-compile", 600)
    run(["vvp", name + ".sim"], work, name + "-simulation", 600)
    marker = "PASS_BOOT_PAST_2E08" if full else "PASS_INITIALIZER"
    if marker not in (work / (name + "-simulation.log")).read_text():
        raise ValueError(f"{name}: missing explicit pass marker")
    report["stages"].append(f"{name}: {marker}")


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] in ("--elaborate", "--initializer"):
        faulthandler.dump_traceback_later(120, repeat=True)
        elaborate(Path(sys.argv[2]), sys.argv[1] == "--initializer")
    else:
        sys.exit(main())
