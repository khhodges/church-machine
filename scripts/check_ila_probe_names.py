#!/usr/bin/env python3
"""check_ila_probe_names.py — Guard against silent ILA probe disconnection.

The Vivado TCL (hardware/wukong_xc7a100t.tcl) connects ILA probes by net name,
e.g. ``connect_debug_port u_ila_0/probe0 [get_nets {dbg_boot_complete}]``.
Those names must appear verbatim in the ``ports=`` list passed to Amaranth's
``convert()`` in ``hardware/gen_rtlil.py``.  If a signal is renamed or removed
from ``ports=``, Vivado's ``connect_debug_port`` silently gets an empty net list
and the probe disappears from Hardware Manager — with NO build error.

This script catches that drift at CI time:

  1. Parses the TCL to extract every ``get_nets {…}`` pattern inside a
     ``connect_debug_port`` call (the clock probe uses a variable and is skipped).
  2. Derives the Amaranth attribute name for each net (strips ``[*]``/``[N]``
     glob suffixes; folds numeric-suffixed variants like ``led0``/``led1`` back
     to their parent attribute ``led``).
  3. Checks that ``hardware/gen_rtlil.py`` references ``top.<attr>`` **inside
     the ``ports = (…)`` assignment block** that is passed to ``convert()``.
  4. Checks that ``hardware/wukong_top.py`` declares ``self.<attr>`` as a
     Signal.

Exit codes:
  0 — all probes are reachable
  1 — one or more probes would be unconnected (drift detected)

Usage:
  python3 scripts/check_ila_probe_names.py
  python3 scripts/check_ila_probe_names.py \\
      --tcl  hardware/wukong_xc7a100t.tcl \\
      --gen  hardware/gen_rtlil.py \\
      --top  hardware/wukong_top.py
"""

import argparse
import re
import sys

# ---------------------------------------------------------------------------
# File paths (overridable via CLI for testing)
# ---------------------------------------------------------------------------
DEFAULT_TCL = "hardware/wukong_xc7a100t.tcl"
DEFAULT_GEN = "hardware/gen_rtlil.py"
DEFAULT_TOP = "hardware/wukong_top.py"


# ---------------------------------------------------------------------------
# Step 1 — Parse TCL: extract net-name patterns from connect_debug_port calls
# ---------------------------------------------------------------------------

def extract_tcl_probe_nets(tcl_text):
    """Return a list of (probe_port, [net_pattern, ...]) pairs.

    Only ``connect_debug_port`` lines that contain a literal ``get_nets {…}``
    are processed.  The clock probe (which uses a ``$clk_net`` variable) is
    skipped intentionally — its net name is not statically knowable.

    Example inputs and outputs:
      connect_debug_port u_ila_0/probe0 [get_nets {dbg_boot_complete}]
        → ('u_ila_0/probe0', ['dbg_boot_complete'])
      connect_debug_port u_ila_0/probe2 [lsort … [get_nets {dbg_nia[*]}]]
        → ('u_ila_0/probe2', ['dbg_nia[*]'])
      connect_debug_port u_ila_0/probe4 [lsort … [get_nets {led0 led1}]]
        → ('u_ila_0/probe4', ['led0', 'led1'])
    """
    results = []
    # Match: connect_debug_port <port> … get_nets {<patterns>} …
    # The patterns inside {} may include spaces (multiple nets) or [*] globs.
    pattern = re.compile(
        r'^connect_debug_port\s+(\S+)\s+.*get_nets\s+\{([^}]+)\}',
        re.MULTILINE,
    )
    for m in pattern.finditer(tcl_text):
        port   = m.group(1)
        bodies = m.group(2).strip().split()
        results.append((port, bodies))
    return results


# ---------------------------------------------------------------------------
# Step 2 — Derive attribute names from net patterns
# ---------------------------------------------------------------------------

def net_to_attr(net_pattern):
    """Map a TCL net name/pattern to its Amaranth Signal attribute name.

    Rules applied in order:
      1. Strip trailing ``[…]`` (Vivado bus-bit or glob suffix).
         e.g.  ``dbg_nia[*]``  →  ``dbg_nia``
               ``dbg_nia[0]``  →  ``dbg_nia``
      2. Strip trailing decimal digits (array-element signals).
         e.g.  ``led0``  →  ``led``
               ``led12`` →  ``led``
      Scalar names with no suffix are returned unchanged.
    """
    # Strip [...] suffix
    base = re.sub(r'\[.*\]$', '', net_pattern)
    # Strip trailing digits (array member names like led0, led1)
    base = re.sub(r'\d+$', '', base)
    return base


def probe_nets_to_attrs(probe_list):
    """Given the list from extract_tcl_probe_nets, return a dict mapping
    probe_port → sorted-unique list of attribute names needed.
    """
    result = {}
    for port, nets in probe_list:
        attrs = sorted({net_to_attr(n) for n in nets})
        result[port] = attrs
    return result


# ---------------------------------------------------------------------------
# Helper — extract the ports = (...) block from gen_rtlil.py source text
# ---------------------------------------------------------------------------

def _extract_ports_block(gen_text):
    """Return the text of the ``ports = (…)`` assignment (including the outer
    parens) from *gen_text*, or ``None`` if the assignment is not found.

    Uses a paren-depth walk so nested lists/parens inside the block are handled
    correctly regardless of formatting.
    """
    m = re.search(r'\bports\s*=\s*\(', gen_text)
    if not m:
        return None
    # Find the opening '(' of the expression
    open_idx = gen_text.index('(', m.start())
    depth = 0
    for i in range(open_idx, len(gen_text)):
        if gen_text[i] == '(':
            depth += 1
        elif gen_text[i] == ')':
            depth -= 1
            if depth == 0:
                return gen_text[open_idx : i + 1]
    # Unterminated — return from opening paren to end of text
    return gen_text[open_idx:]


# ---------------------------------------------------------------------------
# Step 3 — Verify gen_rtlil.py references each attribute inside ports = (...)
# ---------------------------------------------------------------------------

def check_gen_rtlil_ports(gen_text, attr_name):
    """Return True if gen_text references ``top.<attr_name>`` **inside the
    ``ports = (…)`` assignment block** that is passed to ``convert()``.

    Scoping the search to the ports block (rather than doing a global text
    search) prevents false positives from comments, docstrings, or other
    references to ``top.<attr>`` elsewhere in the file.

    Returns ``(found: bool, reason: str)`` for diagnostic output.
    """
    ports_block = _extract_ports_block(gen_text)
    if ports_block is None:
        return False, "no 'ports = (...)' assignment found in gen_rtlil.py"
    token = f'top.{attr_name}'
    if re.search(r'\btop\.' + re.escape(attr_name) + r'\b', ports_block):
        return True, f"found '{token}' in ports block"
    return False, f"'{token}' not found in ports = (...) block"


# ---------------------------------------------------------------------------
# Step 4 — Verify wukong_top.py declares self.<attr> as a Signal
# ---------------------------------------------------------------------------

def check_top_signal(top_text, attr_name):
    """Return True if top_text contains ``self.<attr_name>`` assigned to a
    Signal (or list of Signals).

    Accepts both forms:
      self.dbg_boot_complete = Signal()
      self.led = [Signal(name=…) for …]
    """
    return bool(re.search(
        r'\bself\.' + re.escape(attr_name) + r'\s*=\s*(Signal|\[)',
        top_text,
    ))


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Check ILA probe names are consistent across TCL, gen_rtlil.py, and wukong_top.py",
    )
    parser.add_argument('--tcl', default=DEFAULT_TCL, help='Path to wukong_xc7a100t.tcl')
    parser.add_argument('--gen', default=DEFAULT_GEN, help='Path to gen_rtlil.py')
    parser.add_argument('--top', default=DEFAULT_TOP, help='Path to wukong_top.py')
    args = parser.parse_args()

    # ── Read source files ──────────────────────────────────────────────────
    try:
        with open(args.tcl) as fh:
            tcl_text = fh.read()
    except FileNotFoundError:
        print(f"ERROR: TCL file not found: {args.tcl}", file=sys.stderr)
        sys.exit(1)

    try:
        with open(args.gen) as fh:
            gen_text = fh.read()
    except FileNotFoundError:
        print(f"ERROR: gen_rtlil.py not found: {args.gen}", file=sys.stderr)
        sys.exit(1)

    try:
        with open(args.top) as fh:
            top_text = fh.read()
    except FileNotFoundError:
        print(f"ERROR: wukong_top.py not found: {args.top}", file=sys.stderr)
        sys.exit(1)

    # ── Extract probes from TCL ────────────────────────────────────────────
    probe_list = extract_tcl_probe_nets(tcl_text)
    if not probe_list:
        print("ERROR: No 'connect_debug_port … get_nets {…}' lines found in TCL.", file=sys.stderr)
        print(f"  (checked: {args.tcl})", file=sys.stderr)
        sys.exit(1)

    probe_attrs = probe_nets_to_attrs(probe_list)

    n_signals = len({a for attrs in probe_attrs.values() for a in attrs})
    print(f"check-ila-probe-names: checking {len(probe_list)} probe(s) "
          f"across {n_signals} signal attribute(s)")
    print()

    # ── Check each probe ───────────────────────────────────────────────────
    failures = []

    for port, net_patterns in probe_list:
        attrs = probe_attrs[port]
        print(f"  probe {port}")
        print(f"    TCL net pattern(s) : {net_patterns}")
        print(f"    Attribute(s) needed: {attrs}")
        for attr in attrs:
            gen_ok, gen_reason  = check_gen_rtlil_ports(gen_text, attr)
            top_ok              = check_top_signal(top_text, attr)

            gen_status = "OK" if gen_ok else "MISSING"
            top_status = "OK" if top_ok else "MISSING"
            print(f"      top.{attr:<30}  gen_rtlil.py: {gen_status:<7}  wukong_top.py: {top_status}")

            if not gen_ok:
                failures.append(
                    f"Probe {port} net '{net_patterns}': "
                    f"'top.{attr}' not found in ports = (...) block in {args.gen}.\n"
                    f"    Detail: {gen_reason}\n"
                    f"    Vivado's connect_debug_port will silently get an empty net list — "
                    f"the probe will be disconnected in Hardware Manager."
                )
            if not top_ok:
                failures.append(
                    f"Probe {port} net '{net_patterns}': "
                    f"'self.{attr}' is not declared as a Signal in {args.top}.\n"
                    f"    Either the signal was renamed or the ports= list references a "
                    f"non-existent attribute."
                )
        print()

    # ── Summary ───────────────────────────────────────────────────────────
    if failures:
        print("FAILURES:", file=sys.stderr)
        for msg in failures:
            print(f"  ✗ {msg}", file=sys.stderr)
        print(file=sys.stderr)
        print(
            "To fix: ensure every net name in connect_debug_port calls has a matching\n"
            "Signal attribute in wukong_top.py AND is included in the ports= list in\n"
            "gen_rtlil.py.  The ILA probe net names are derived from the Amaranth Signal\n"
            "name; renaming a Signal without updating both files breaks probe connectivity.",
            file=sys.stderr,
        )
        sys.exit(1)

    print("check-ila-probe-names: all probes reachable — no drift detected.")


if __name__ == "__main__":
    main()
