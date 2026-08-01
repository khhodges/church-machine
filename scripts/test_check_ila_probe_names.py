#!/usr/bin/env python3
"""test_check_ila_probe_names.py — Self-tests for check_ila_probe_names.py

Runs positive (should-pass) and negative (should-fail) fixture cases to verify
that the probe-drift detector correctly catches removal of a port from
gen_rtlil.py and renaming of a Signal in wukong_top.py.

Exit codes:
  0 — all fixture cases behaved as expected
  1 — one or more fixture cases produced the wrong outcome

Usage:
  python3 scripts/test_check_ila_probe_names.py
"""

import sys
import os

# Import the module under test from the same directory
sys.path.insert(0, os.path.dirname(__file__))
from check_ila_probe_names import (
    extract_tcl_probe_nets,
    probe_nets_to_attrs,
    check_gen_rtlil_ports,
    check_top_signal,
    _extract_ports_block,
)

# ---------------------------------------------------------------------------
# Fixture helpers
# ---------------------------------------------------------------------------

_MINIMAL_TCL = """\
connect_debug_port u_ila_0/probe0 [get_nets {dbg_boot_complete}]
connect_debug_port u_ila_0/probe1 [get_nets {dbg_fault_valid}]
connect_debug_port u_ila_0/probe2 [lsort -dictionary [get_nets {dbg_nia[*]}]]
connect_debug_port u_ila_0/probe3 [lsort -dictionary [get_nets {dbg_fault[*]}]]
connect_debug_port u_ila_0/probe4 [lsort -dictionary [get_nets {led0 led1}]]
"""

_GOOD_GEN = """\
def generate_rtlil_wukong(output_dir="build"):
    from .wukong_top import ChurchWukongXC7A100T
    top = ChurchWukongXC7A100T()
    ports = (
        [top.clk, top.rst_n]
        + list(top.led)
        + [top.uart_tx_pin, top.uart_rx_pin]
        + [top.dbg_boot_complete, top.dbg_fault_valid, top.dbg_nia, top.dbg_fault]
    )
    rtlil_text = convert(top, ports=ports)
"""

_GOOD_TOP = """\
class ChurchWukongXC7A100T(Elaboratable):
    def __init__(self):
        self.clk = Signal()
        self.rst_n = Signal(init=1)
        self.uart_tx_pin = Signal(init=1)
        self.uart_rx_pin = Signal(init=1)
        self.led = [Signal(name=f"led{i}") for i in range(2)]
        self.dbg_boot_complete = Signal()
        self.dbg_fault_valid   = Signal()
        self.dbg_nia           = Signal(32)
        self.dbg_fault         = Signal(32)
"""

# ---------------------------------------------------------------------------
# Individual test cases
# ---------------------------------------------------------------------------

PASS = True
FAIL = False

tests_run  = 0
tests_fail = 0


def check(label, expected_ok, actual_ok, detail=""):
    global tests_run, tests_fail
    tests_run += 1
    status = "OK  " if actual_ok == expected_ok else "FAIL"
    outcome = "pass" if actual_ok else "fail"
    expected = "pass" if expected_ok else "fail"
    msg = f"  [{status}] {label}"
    if detail:
        msg += f" ({detail})"
    if actual_ok != expected_ok:
        msg += f"  ← expected {expected}, got {outcome}"
        tests_fail += 1
    print(msg)


# ── TCL parsing ────────────────────────────────────────────────────────────

print("\n── TCL parsing ──────────────────────────────────────────────────────")

probe_list = extract_tcl_probe_nets(_MINIMAL_TCL)
check("extracts 5 probes from minimal TCL", PASS, len(probe_list) == 5)
check("clock probe skipped (no get_nets literal)", PASS,
      all('clk' not in p for p, _ in probe_list))

probe_attrs = probe_nets_to_attrs(probe_list)
all_attrs = {a for attrs in probe_attrs.values() for a in attrs}
check("dbg_boot_complete attribute present", PASS, 'dbg_boot_complete' in all_attrs)
check("dbg_fault_valid attribute present",   PASS, 'dbg_fault_valid'   in all_attrs)
check("dbg_nia attribute present (from dbg_nia[*])", PASS, 'dbg_nia'  in all_attrs)
check("dbg_fault attribute present (from dbg_fault[*])", PASS, 'dbg_fault' in all_attrs)
check("led attribute present (from led0 led1)", PASS, 'led' in all_attrs)
check("led0/led1 folded into single 'led' attr", PASS,
      'led0' not in all_attrs and 'led1' not in all_attrs)


# ── ports block extraction ─────────────────────────────────────────────────

print("\n── ports block extraction ────────────────────────────────────────────")

block = _extract_ports_block(_GOOD_GEN)
check("ports block extracted from good gen", PASS, block is not None)
check("block contains top.dbg_nia",          PASS, block is not None and 'top.dbg_nia' in block)
check("block does not contain unrelated text", PASS,
      block is not None and 'generate_rtlil_wukong' not in block)
check("no block when ports= absent", PASS,
      _extract_ports_block("def foo():\n    convert(top)\n") is None)


# ── gen_rtlil.py check — positive (should pass) ───────────────────────────

print("\n── gen_rtlil.py check — positive ────────────────────────────────────")

for attr in ('dbg_boot_complete', 'dbg_fault_valid', 'dbg_nia', 'dbg_fault', 'led'):
    ok, reason = check_gen_rtlil_ports(_GOOD_GEN, attr)
    check(f"PASS: top.{attr} found in good gen", PASS, ok, reason)


# ── gen_rtlil.py check — negative: port removed from ports block ──────────

print("\n── gen_rtlil.py check — negative (port removed) ─────────────────────")

_GEN_MISSING_NIA = _GOOD_GEN.replace('top.dbg_nia, ', '')
ok, reason = check_gen_rtlil_ports(_GEN_MISSING_NIA, 'dbg_nia')
check("FAIL: top.dbg_nia removed from ports block", FAIL, ok, reason)

_GEN_MISSING_FAULT_VALID = _GOOD_GEN.replace('top.dbg_fault_valid, ', '')
ok, reason = check_gen_rtlil_ports(_GEN_MISSING_FAULT_VALID, 'dbg_fault_valid')
check("FAIL: top.dbg_fault_valid removed from ports block", FAIL, ok, reason)

_GEN_MISSING_LED = _GOOD_GEN.replace('list(top.led)\n        + ', '')
ok, reason = check_gen_rtlil_ports(_GEN_MISSING_LED, 'led')
check("FAIL: top.led removed from ports block", FAIL, ok, reason)

# A reference to the attribute name *outside* the ports block must not rescue it
_GEN_COMMENT_ONLY = """\
def generate_rtlil_wukong(output_dir="build"):
    # top.dbg_nia is described in wukong_top.py
    top = ChurchWukongXC7A100T()
    ports = (
        [top.clk, top.rst_n]
        + [top.uart_tx_pin]
    )
    convert(top, ports=ports)
"""
ok, reason = check_gen_rtlil_ports(_GEN_COMMENT_ONLY, 'dbg_nia')
check("FAIL: top.dbg_nia in comment but not in ports block", FAIL, ok, reason)


# ── wukong_top.py check — positive ────────────────────────────────────────

print("\n── wukong_top.py check — positive ───────────────────────────────────")

for attr in ('dbg_boot_complete', 'dbg_fault_valid', 'dbg_nia', 'dbg_fault', 'led'):
    ok = check_top_signal(_GOOD_TOP, attr)
    check(f"PASS: self.{attr} declared in good top", PASS, ok)


# ── wukong_top.py check — negative: signal renamed ────────────────────────

print("\n── wukong_top.py check — negative (signal renamed) ──────────────────")

_TOP_RENAMED_NIA = _GOOD_TOP.replace('self.dbg_nia', 'self.debug_nia')
ok = check_top_signal(_TOP_RENAMED_NIA, 'dbg_nia')
check("FAIL: self.dbg_nia renamed to self.debug_nia", FAIL, ok)

_TOP_MISSING_FAULT = _GOOD_TOP.replace('self.dbg_fault         = Signal(32)\n', '')
ok = check_top_signal(_TOP_MISSING_FAULT, 'dbg_fault')
check("FAIL: self.dbg_fault removed from top", FAIL, ok)


# ── Summary ───────────────────────────────────────────────────────────────

print(f"\ntest_check_ila_probe_names: {tests_run - tests_fail}/{tests_run} passed")
if tests_fail:
    print(f"  {tests_fail} failure(s) — see [FAIL] lines above", file=sys.stderr)
    sys.exit(1)
else:
    print("All fixture cases behaved as expected.")
