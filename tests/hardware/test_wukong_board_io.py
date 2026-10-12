"""Normal board-build safety; no Vivado, serial connection, or board required."""
import ast
from pathlib import Path
import subprocess
import sys
import shutil
import re

import pytest
from amaranth import Elaboratable, Module
from amaranth.back import rtlil

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from hardware.wukong_top import ChurchWukongXC7A100T
from hardware.gen_rtlil import _rtlil_to_verilog
from scripts.check_ila_probe_names import check_internal_probe

PINS = {
    "clk": "M21", "rst_n": "M6", "uart_rx_pin": "F3",
    "uart_tx_pin": "E3", "led0": "G21", "led1": "G20",
}
GEN = (ROOT / "hardware/gen_rtlil.py").read_text()
TOP = (ROOT / "hardware/wukong_top.py").read_text()
TCL = (ROOT / "hardware/wukong_xc7a100t.tcl").read_text()
XDC = ROOT / "hardware/wukong_xc7a100t.xdc"


def board_ports(top):
    fn = next(n for n in ast.parse(GEN).body
              if isinstance(n, ast.FunctionDef) and n.name == "generate_rtlil_wukong")
    assignment = next(n for n in fn.body if isinstance(n, ast.Assign)
                      and any(isinstance(t, ast.Name) and t.id == "ports" for t in n.targets))
    return eval(compile(ast.Expression(assignment.value), "<board ports>", "eval"),
                {"top": top})


def test_generator_exports_only_six_scalar_board_ports():
    top = ChurchWukongXC7A100T()
    top._MustUse__used = True
    ports = board_ports(top)
    assert sorted(p.name for p in ports) == sorted(PINS)
    assert all(len(p) == 1 for p in ports)


@pytest.mark.parametrize("name,width", [
    ("dbg_boot_complete", 1), ("dbg_fault_valid", 1),
    ("dbg_nia", 32), ("dbg_fault", 32),
])
def test_internal_ila_attributes_survive_rtlil(name, width):
    top = ChurchWukongXC7A100T()
    top._MustUse__used = True
    signal = getattr(top, name)
    assert len(signal) == width
    assert check_internal_probe(GEN, TOP, name)
    assert not check_internal_probe(GEN, TOP.replace('"keep": "true"', '"keep": "false"'), name)
    assert not check_internal_probe(GEN + "\nwrite_verilog -noattr", TOP, name)

    class ProbeHarness(Elaboratable):
        def elaborate(self, platform):
            m = Module()
            m.d.comb += signal.eq(top.clk)
            return m

    emitted = rtlil.convert(ProbeHarness(), ports=[top.clk])
    assert 'attribute \\keep "true"' in emitted
    assert 'attribute \\mark_debug "true"' in emitted
    line = next(line for line in emitted.splitlines() if line.endswith("\\" + name))
    assert "input" not in line and "output" not in line


def test_verilog_generation_preserves_attributes(monkeypatch, tmp_path):
    commands = []

    def run(command, **kwargs):
        commands.append(command)
        return subprocess.CompletedProcess(command, 1, "", "test stops before tool execution")

    monkeypatch.setattr(subprocess, "run", run)
    _rtlil_to_verilog(tmp_path / "in.il", tmp_path / "out.v")
    assert "write_verilog " in commands[0][-1]
    assert "-noattr" not in commands[0][-1]


@pytest.mark.skipif(shutil.which("yosys") is None, reason="Yosys is not installed")
def test_yosys_emits_internal_probes_without_debug_ports(tmp_path):
    top = ChurchWukongXC7A100T()
    top._MustUse__used = True

    class BoardHarness(Elaboratable):
        def elaborate(self, platform):
            m = Module()
            m.d.comb += [
                top.led[0].eq(top.rst_n), top.led[1].eq(~top.clk),
                top.uart_tx_pin.eq(top.uart_rx_pin),
                top.dbg_boot_complete.eq(top.rst_n),
                top.dbg_fault_valid.eq(top.uart_rx_pin),
                top.dbg_nia.eq(top.clk), top.dbg_fault.eq(top.rst_n),
            ]
            return m

    il_path, v_path = tmp_path / "board.il", tmp_path / "board.v"
    il_path.write_text(rtlil.convert(BoardHarness(), ports=board_ports(top)))
    assert _rtlil_to_verilog(il_path, v_path, "church_wukong_xc7a100t") == v_path
    verilog = v_path.read_text()
    ports = re.search(r"module church_wukong_xc7a100t\((.*?)\);", verilog, re.S)[1]
    assert sorted(p.strip() for p in ports.split(",")) == sorted(PINS)
    for name in ("dbg_boot_complete", "dbg_fault_valid", "dbg_nia", "dbg_fault"):
        declaration = re.search(
            r'((?:  \(\* [^\n]+\*\)\n)+)  wire (?:\[31:0\] )?' + name + ';',
            verilog,
        )
        assert declaration, name
        assert 'mark_debug = "true"' in declaration[1]
        assert 'keep = "true"' in declaration[1]


def run_guard(mutation="", extra=""):
    # Execute the actual XDC and actual Tcl guard using a tiny Vivado object
    # model. Catch errors explicitly: tclsh stdin alone can return zero on error.
    guard = TCL.split("proc assert_wukong_board_io {} {", 1)[1].split(
        '\nputs "\\n═══ Synthesis', 1)[0]
    script = r"""
set ports {clk rst_n uart_rx_pin uart_tx_pin led0 led1}
set severity(NSTD-1) Error
set severity(UCIO-1) Error
proc get_ports {args} {
    global ports
    set name [string trim [lindex $args end]]
    if {$name eq "*"} {return $ports}
    if {$name in $ports} {return $name}
    return {}
}
proc set_property {args} {
    global props
    if {[lindex $args end] eq "__design__" || [string match u_ila* [lindex $args end]]} {return}
    if {[lindex $args 0] ne "-dict"} {error "Unexpected XDC property command: $args"}
    foreach {key value} [lindex $args 1] {
        set props([lindex $args 2],$key) $value
    }
}
proc create_clock {args} {}
proc current_design {} {return __design__}
proc set_false_path {args} {}
proc get_drc_checks {rule} {return $rule}
proc get_property {key objects} {
    global props severity
    if {$key eq "NAME"} {return $objects}
    if {$key eq "PROGRESS"} {return "100%"}
    if {$key eq "STATS.WNS"} {return 1.0}
    if {$key eq "SEVERITY"} {return $severity($objects)}
    if {![info exists props($objects,$key)]} {return ""}
    return $props($objects,$key)
}
"""
    script += f"\nif {{[catch {{source {{{XDC}}}}} reason]}} {{puts stderr $reason; exit 1}}\n"
    script += "proc assert_wukong_board_io {} {" + guard
    script += "\n" + mutation + """
if {[catch {assert_wukong_board_io} reason]} {
    puts stderr $reason
    exit 1
}
puts SAFE
"""
    if extra:
        script += "\nif {[catch {\n" + extra + "\n} reason]} {puts stderr $reason; exit 1}\n"
    return subprocess.run(["tclsh"], input=script, text=True, capture_output=True)


def test_real_constraints_pass_guard():
    result = run_guard()
    assert result.returncode == 0, result.stderr
    assert "SAFE" in result.stdout


@pytest.mark.parametrize("mutation", [
    "lappend ports dbg_nia",
    "set ports [lrange $ports 1 end]",
    "lappend ports {led0[1]}",
    "set props(clk,PACKAGE_PIN) {}",
    "set props(uart_tx_pin,PACKAGE_PIN) F3",
    "set props(led0,IOSTANDARD) DEFAULT",
    "set props(led1,IOSTANDARD) LVCMOS18",
    "set severity(NSTD-1) Warning",
    "set severity(UCIO-1) Warning",
])
def test_guard_rejects_unsafe_design(mutation):
    result = run_guard(mutation)
    assert result.returncode != 0
    assert "Unsafe Wukong" in result.stderr


def test_guard_runs_after_synthesis_and_immediately_before_bitstream():
    assert "open_run synth_1\nassert_wukong_board_io" in TCL
    assert "assert_wukong_board_io\nwrite_bitstream" in TCL
    assert "set_property SEVERITY" not in TCL + XDC.read_text()
    assert 'get_nets -quiet $pattern' in TCL
    assert 'expected $width internal nets' in TCL


@pytest.mark.parametrize("insert_ila", [0, 1])
def test_both_build_paths_close_synthesis_before_opening_implementation(insert_ila):
    # Execute the real flow from opening synthesis through write_bitstream.
    # Mock only Vivado tool operations; track its single-open-design lifecycle.
    flow = "open_run synth_1" + TCL.split("open_run synth_1", 1)[1].split(
        "write_bitstream -force ${TOP}.bit", 1)[0] + "write_bitstream -force ${TOP}.bit"
    stubs = r"""
set opened {}
set JOBS 1
set TOP church_wukong_xc7a100t
set argv {}
proc open_run {name args} {
    global opened
    if {$opened ne ""} {error "Design $opened still open while opening $name"}
    set opened $name
}
proc close_design {} {
    global opened
    if {$opened ne "synth_1"} {error "Expected synthesis to be open"}
    set opened {}
}
proc launch_runs {args} {}
proc wait_on_run {args} {}
proc get_runs {name} {return $name}
proc create_debug_core {name args} {return $name}
proc create_debug_port {args} {}
proc get_debug_ports {name} {return $name}
proc connect_debug_port {args} {}
proc implement_debug_core {} {}
proc get_nets {args} {
    set pattern [lindex $args end]
    if {$pattern in {{dbg_nia[*]} {dbg_fault[*]}}} {
        set result {}
        for {set i 0} {$i < 32} {incr i} {lappend result "${pattern}_$i"}
        return $result
    }
    return $pattern
}
proc write_bitstream {args} {
    global opened
    if {$opened ne "impl_1"} {error "Implementation must be open for bitstream"}
    puts BITSTREAM_REACHED
}
"""
    result = run_guard(extra=stubs + f"\nset INSERT_ILA {insert_ila}\n" + flow)
    assert result.returncode == 0, result.stderr
    assert "BITSTREAM_REACHED" in result.stdout
