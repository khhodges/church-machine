"""Prepare an offline six-pin build from the hash-pinned frozen repair RTL."""
import difflib
import hashlib
import json
import shutil
import sys
from pathlib import Path

SOURCE_HASH = "d7fb9b95ca8304a05148cd30ab5c1053f2c246e2b5509b461cc008ed594b677a"
XDC_HASH = "fe416e3b65c8b728473891c1f966b6665ab59c13471fed33d7f6dcbebd1af4b8"
EXPECTED_HASH = "b7cebaeb97a509b014991f4a71f85a3650f839c91b673413d11e78350364d33c"
OLD_HEADER = "module church_wukong_xc7a100t(rst_n, uart_rx_pin, led0, led1, uart_tx_pin, dbg_boot_complete, dbg_fault_valid, dbg_nia, dbg_fault, clk);"
NEW_HEADER = "module church_wukong_xc7a100t(rst_n, uart_rx_pin, led0, led1, uart_tx_pin, clk);"
DECLARATIONS = (
    "  output dbg_boot_complete;\n",
    "  output dbg_fault_valid;\n",
    "  output [31:0] dbg_nia;\n",
    "  output [31:0] dbg_fault;\n",
)


def demote_debug_ports(source):
    """Only remove external declarations; retain every internal wire/assignment."""
    if source.count(OLD_HEADER) != 1:
        raise ValueError("Unexpected frozen module header")
    result = source.replace(OLD_HEADER, NEW_HEADER)
    for declaration in DECLARATIONS:
        wire = declaration.replace("output", "wire", 1)
        if result.count(declaration + wire) != 1:
            raise ValueError(f"Unexpected declaration/wire pair: {declaration.strip()}")
        result = result.replace(declaration + wire, wire)
    restored = result.replace(NEW_HEADER, OLD_HEADER)
    for declaration in DECLARATIONS:
        wire = declaration.replace("output", "wire", 1)
        restored = restored.replace(wire, declaration + wire)
    if restored != source:
        raise ValueError("Edit changed more than the approved port declarations")
    return result


TCL = r"""
set_param general.maxThreads 2
create_project -in_memory -part xc7a100tfgg676-2
read_verilog church_wukong_xc7a100t.v
synth_design -top church_wukong_xc7a100t -part xc7a100tfgg676-2
read_xdc retained.xdc
# Undo the original XDC's warning downgrade. Do not permit phantom debug pins.
set_property SEVERITY Error [get_drc_checks NSTD-1]
set_property SEVERITY Error [get_drc_checks UCIO-1]
proc verify_board_ports {} {
    set wanted {clk led0 led1 rst_n uart_rx_pin uart_tx_pin}
    if {[lsort [get_ports]] ne [lsort $wanted]} {
        error "Unexpected physical port set: [get_ports]"
    }
    foreach {port pin} {clk M21 led0 G21 led1 G20 rst_n M6 uart_tx_pin E3 uart_rx_pin F3} {
        set p [get_ports $port]
        if {[get_property PACKAGE_PIN $p] ne $pin ||
            [get_property IOSTANDARD $p] ne "LVCMOS33"} {
            error "Board pin validation failed: $port"
        }
    }
    if {[llength [get_clocks sys_clk_pin]] != 1 ||
        [get_property PERIOD [get_clocks sys_clk_pin]] != 20.0} {
        error "Expected unchanged 50 MHz clock"
    }
    puts "SIX_PIN_BOARD_CONTRACT_PASS"
}
verify_board_ports
write_checkpoint -force six_pin_synth.dcp
write_verilog -force -mode funcsim synth_funcsim.v
report_utilization -file synth-utilization.txt
opt_design
place_design
phys_opt_design
route_design
verify_board_ports
write_checkpoint -force routed.dcp
report_timing_summary -delay_type min_max -report_unconstrained -check_timing_verbose -file timing-summary.txt
report_route_status -file route-status.txt
report_drc -file drc.txt
report_io -file io.txt
report_utilization -file utilization.txt
report_methodology -file methodology.txt
puts "SIX_PIN_REPORTS_READY_TIMING_AND_REPLAY_REVIEW_REQUIRED"
exit
"""

RUNNER = r"""#!/usr/bin/env bash
set -eo pipefail
cd "$(dirname "$0")"
ROOT=$PWD
finish() {
  local rc=$?
  trap - EXIT
  echo "$rc" > "$ROOT/exit-status"
  echo "SIX_PIN_BUILD_EXIT=$rc"
  exit "$rc"
}
trap finish EXIT
exec 9>/tmp/church-vivado-build.lock
flock -n 9 || { echo "Another Vivado job owns the build lock"; exit 1; }
sha256sum -c inputs.sha256
source /opt/Xilinx/2026.1/Vivado/settings64.sh
timeout --kill-after=30s 10800s vivado -mode batch -source build.tcl -log build.log
sha256sum -c inputs.sha256
grep -q '^SIX_PIN_REPORTS_READY_TIMING_AND_REPLAY_REVIEW_REQUIRED' build.log
for f in six_pin_synth.dcp synth_funcsim.v routed.dcp timing-summary.txt route-status.txt drc.txt io.txt utilization.txt methodology.txt; do
  test -s "$f"
done
sha256sum six_pin_synth.dcp synth_funcsim.v routed.dcp > outputs.sha256
tar -czf six-pin-evidence.tar.gz inputs.sha256 outputs.sha256 edit-proof.json \
  interface.diff build.tcl build.log timing-summary.txt route-status.txt drc.txt \
  io.txt synth-utilization.txt utilization.txt methodology.txt
echo "=== Timing summary ==="
grep -A 14 'Design Timing Summary' timing-summary.txt || true
echo "=== Routing ==="
cat route-status.txt
echo "=== DRC ==="
cat drc.txt
echo "SIX_PIN_REPORTS_READY_TIMING_AND_REPLAY_REVIEW_REQUIRED"
echo "NO_BITSTREAM_NO_FLASH_NO_BOARD_COMMANDS"
"""


def main():
    build, old, out = map(Path, sys.argv[1:])
    files = {
        "frozen-source.v": (build / "church_wukong_xc7a100t.v", SOURCE_HASH),
        "expected.hex": (build / "expected.hex", EXPECTED_HASH),
        "retained.xdc": (old / "wukong_xc7a100t.xdc", XDC_HASH),
    }
    for name, (path, digest) in files.items():
        if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise SystemExit(f"Wrong retained input: {name}")
    source = files["frozen-source.v"][0].read_text()
    candidate = demote_debug_ports(source)
    out.mkdir(parents=True, exist_ok=False)
    for name, (path, _) in files.items():
        shutil.copyfile(path, out / name)
    (out / "church_wukong_xc7a100t.v").write_text(candidate)
    (out / "interface.diff").write_text("".join(difflib.unified_diff(
        source.splitlines(True), candidate.splitlines(True),
        fromfile="frozen-source.v", tofile="church_wukong_xc7a100t.v")))
    (out / "edit-proof.json").write_text(json.dumps({
        "source_sha256": SOURCE_HASH,
        "candidate_sha256": hashlib.sha256(candidate.encode()).hexdigest(),
        "edit": "Remove four external debug declarations (66 bits) and header entries only",
        "reverse_edit_reproduces_source": True,
        "program_and_initializer_unchanged": True,
        "clock_period_ns": 20,
        "release_approved": False,
    }, indent=2) + "\n")
    (out / "build.tcl").write_text(TCL)
    (out / "run.sh").write_text(RUNNER)
    shutil.copyfile(__file__, out / "prepare.py")
    inputs = list(files) + ["church_wukong_xc7a100t.v", "build.tcl", "run.sh", "prepare.py"]
    (out / "inputs.sha256").write_text("".join(
        f"{hashlib.sha256((out / name).read_bytes()).hexdigest()}  {name}\n"
        for name in inputs))
    print(f"Prepared: {out}")
    print("Only external debug declarations changed. UART, ROM and core logic unchanged.")
    print("NO_BITSTREAM_NO_FLASH_NO_BOARD_COMMANDS")


if __name__ == "__main__":
    main()
