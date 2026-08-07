import os
import re
import sys
import subprocess
from amaranth import ClockSignal
from amaranth.back.rtlil import convert


def _extract_port_body(text, start):
    """Return the content of the parenthesised port body starting at `start`.

    `text[start]` must be '('.  Walks forward tracking nesting depth and
    returns the inner content (excluding the outer parens) as a string.
    Also returns the index one past the closing ')'.
    """
    assert text[start] == '('
    depth = 0
    i = start
    while i < len(text):
        ch = text[i]
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
            if depth == 0:
                return text[start + 1:i], i + 1
        i += 1
    return text[start + 1:], len(text)


def _fix_macc_cells(v_path):
    """Replace remaining \\$macc instantiations with behavioural Verilog.

    Yosys alumacc folds constant-coefficient multiplies into \\$macc cells that
    write_verilog cannot lower to plain operators.  This post-processor replaces
    each cell with a simple assign statement that Vivado can synthesise directly.

    A \\$macc with B_WIDTH=0 and a leading constant in A is a constant-
    coefficient multiply:  Y_main = A_signal * constant.
    We extract the primary named output from Y, the constant from A, and the
    primary named input from A, then emit:

        assign <y_signal> = <a_signal> * <constant>;

    Any upper overflow bits left undriven are dead logic removed by synthesis.
    """
    with open(v_path, "r") as fh:
        text = fh.read()

    lines = text.splitlines(keepends=True)
    out   = []
    replaced = 0
    i = 0

    while i < len(lines):
        line = lines[i]
        # Detect start of a \$macc instantiation
        if r'\$macc' in line and '#(' in line:
            # Collect the full block: from this line to the terminating ');'
            block_lines = [line]
            j = i + 1
            while j < len(lines):
                block_lines.append(lines[j])
                if lines[j].rstrip().endswith(');'):
                    j += 1
                    break
                j += 1
            block = "".join(block_lines)

            repl = _decode_macc_block(block)
            if repl is not None:
                out.append(repl)
                replaced += 1
            else:
                out.append(block)
                print(f"  [warn] could not decode \\$macc block — kept as-is")
            i = j
        else:
            out.append(line)
            i += 1

    if replaced:
        with open(v_path, "w") as fh:
            fh.write("".join(out))
        print(f"  Fixed {replaced} \\$macc cell(s) → behavioural Verilog")
    else:
        print(f"  No \\$macc cells found — Verilog already clean")

    return replaced


def _decode_macc_block(block):
    """Return a replacement assign string for a \\$macc block, or None.

    Handles constant-coefficient multiplies: B_WIDTH=0, leading constant in A,
    primary output in Y is a named (non-temp) signal.
    """
    # ── Require B_WIDTH = 0 (constant-multiply form) ──────────────────────
    if not re.search(r'\.B_WIDTH\s*\(\s*32\'d0\s*\)', block):
        return None

    # ── Extract port bodies using paren-matching ───────────────────────────
    def _port_body(name):
        pat = re.compile(r'\.' + re.escape(name) + r'\s*\(')
        m = pat.search(block)
        if not m:
            return None
        paren_start = block.index('(', m.start() + len(name) + 1)
        body, _ = _extract_port_body(block, paren_start)
        return body

    y_str = _port_body('Y')
    a_str = _port_body('A')
    if y_str is None or a_str is None:
        return None

    # ── Y: find the primary result — last named (non-temp) signal ─────────
    # Named signals in Yosys Verilog: \identifier  (backslash-escaped id)
    # Temp wires look like  _01234_  (underscore-bounded digits)
    named_in_y = re.findall(r'(\\[\w.\[\]]+)', y_str)
    named_out = [s for s in named_in_y
                 if not re.match(r'^_\d+_', s.lstrip('\\'))]
    if not named_out:
        return None
    y_signal = named_out[-1]   # rightmost = LSB field = actual result wire

    # ── A: leading literal constant → multiplier ───────────────────────────
    # Format: { 25'h1000193, ... }  or just  32'hXXX
    const_m = re.search(r'(\d+)\'h([0-9a-fA-F]+)\s*,', a_str)
    if not const_m:
        return None
    multiplier = f"{const_m.group(1)}'h{const_m.group(2)}"

    # ── A: first named signal → multiplicand ──────────────────────────────
    named_in_a = re.findall(r'(\\[\w.]+)\s*(?:\[\d+(?::\d+)?\])?', a_str)
    named_in = [s for s in named_in_a
                if not re.match(r'^_\d+_', s.lstrip('\\'))]
    if not named_in:
        return None
    a_signal = named_in[0]

    return (
        f"  // \\$macc → behavioural: {y_signal} = {a_signal} * {multiplier}\n"
        f"  assign {y_signal} = {a_signal} * {multiplier};\n"
    )


def _fix_alu_cells(v_path):
    """Replace remaining \\$alu instantiations with behavioural Verilog.

    Yosys alumacc folds add/sub into \\$alu cells that write_verilog cannot
    lower to plain operators.  This post-processor replaces each cell with
    assign statements that Vivado can synthesise directly.

    \\$alu ports: A, B, CI (carry-in), BI (B-invert), X (XOR), Y (sum), CO (carry-out).
    The arithmetic result is Y = A + (BI ? ~B : B) + CI.
    """
    with open(v_path, "r") as fh:
        text = fh.read()

    lines = text.splitlines(keepends=True)
    out = []
    replaced = 0
    i = 0

    while i < len(lines):
        line = lines[i]
        if r'\$alu' in line and '#(' in line:
            block_lines = [line]
            j = i + 1
            while j < len(lines):
                block_lines.append(lines[j])
                if lines[j].rstrip().endswith(');'):
                    j += 1
                    break
                j += 1
            block = "".join(block_lines)
            repl = _decode_alu_block(block)
            if repl is not None:
                out.append(repl)
                replaced += 1
            else:
                out.append(block)
                print(f"  [warn] could not decode \\$alu block — kept as-is")
            i = j
        else:
            out.append(line)
            i += 1

    if replaced:
        with open(v_path, "w") as fh:
            fh.write("".join(out))
        print(f"  Fixed {replaced} \\$alu cell(s) → behavioural Verilog")
    else:
        print(f"  No \\$alu cells found — Verilog already clean")

    return replaced


def _decode_alu_block(block):
    """Return replacement assign strings for a \\$alu block, or None.

    Extracts A_WIDTH, B_WIDTH, Y_WIDTH, A_SIGNED, B_SIGNED parameters and
    all port connections, then emits behavioural assign statements.
    """
    def _param(name):
        m = re.search(r'\.' + re.escape(name) + r'\s*\(\s*32\'d(\d+)\s*\)', block)
        return int(m.group(1)) if m else None

    def _port(name):
        m = re.search(r'\.' + re.escape(name) + r'\s*\(', block)
        if not m:
            return None
        start = block.index('(', m.start() + len(name) + 1)
        depth = 0
        for k in range(start, len(block)):
            if block[k] == '(':
                depth += 1
            elif block[k] == ')':
                depth -= 1
                if depth == 0:
                    return block[start + 1:k].strip()
        return None

    a_width  = _param('A_WIDTH')
    b_width  = _param('B_WIDTH')
    y_width  = _param('Y_WIDTH')
    a_signed = _param('A_SIGNED')

    if None in (a_width, b_width, y_width):
        return None

    port_a  = _port('A')
    port_b  = _port('B')
    port_bi = _port('BI')
    port_ci = _port('CI')
    port_y  = _port('Y')
    port_co = _port('CO')
    port_x  = _port('X')

    if port_y is None:
        return None

    lines_out = [f"  // \\$alu → behavioural (A_WIDTH={a_width} B_WIDTH={b_width} Y_WIDTH={y_width})\n"]

    # Determine effective B: inverted when BI=1
    if port_b and b_width and b_width > 0:
        if port_bi in ("1'h1", "1'b1", "1"):
            b_expr = f"(~({port_b}))"
        elif port_bi and port_bi not in ("1'h0", "1'b0", "0", ""):
            b_expr = f"({port_bi} ? ~({port_b}) : ({port_b}))"
        else:
            b_expr = f"({port_b})"
    else:
        b_expr = f"{y_width}'h0"

    ci_expr = port_ci if port_ci else "1'h0"

    # Cast A to correct width/signedness
    if a_signed:
        a_cast = f"$signed({{{y_width}'h0, {port_a}}})" if not a_signed else f"$signed({port_a})"
    else:
        a_cast = port_a if port_a else f"{y_width}'h0"

    sum_expr = f"({a_cast} + {b_expr} + {ci_expr})"

    if port_y:
        lines_out.append(f"  assign {port_y} = {sum_expr}[{y_width - 1}:0];\n")
    if port_co:
        lines_out.append(f"  assign {port_co} = {sum_expr}[{y_width}];\n")
    if port_x:
        b_for_xor = f"({port_b})" if (port_b and b_width and b_width > 0) else f"{y_width}'h0"
        lines_out.append(f"  assign {port_x} = ({port_a} ^ {b_for_xor});\n")

    return "".join(lines_out)


def _rtlil_to_verilog(il_path, v_path, module_name=None):
    """Convert Amaranth RTLIL to Verilog via Yosys for Vivado synthesis.

    The `techmap` pass before write_verilog is essential: it expands Yosys
    internal cells ($alu, $macc) into standard RTL arithmetic that Vivado
    recognises.  Without it, write_verilog emits these as module
    instantiations of unknown modules and synthesis fails.

    If module_name is given, the Amaranth-generated 'top' module is renamed
    to that name before writing Verilog, so Vivado's top_module setting
    matches the generated output.
    """
    rename_pass = f"rename top {module_name}; " if module_name else ""
    script = (
        f"read_rtlil {il_path}; "
        f"hierarchy -top top; "
        f"proc; "
        f"flatten; "
        f"opt -mux_undef -undriven; "
        f"opt; "
        f"opt_reduce; "
        f"opt_clean; "
        f"opt -fast; "
        f"techmap; "
        f"clean; "
        f"{rename_pass}"
        f"write_verilog -noattr {v_path}"
    )
    try:
        result = subprocess.run(
            ["yosys", "-p", script],
            capture_output=True, text=True, timeout=120
        )
        if result.returncode == 0:
            print(f"  Verilog: {v_path}")
            _fix_macc_cells(v_path)
            _fix_alu_cells(v_path)
            return v_path
        else:
            print(f"  [warn] yosys failed: {result.stderr[-400:]}")
            return None
    except FileNotFoundError:
        print("  [warn] yosys not found — skipping .v generation")
        return None


def generate_rtlil_wukong(output_dir="build"):
    """Generate RTLIL + Verilog for QMTECH Wukong Artix-7 XC7A100T.

    The Verilog output is generic (no Xilinx vendor cells) and is fed into
    Vivado for Artix-7 synthesis, place-and-route, and bitstream generation.
    """
    from .wukong_top import ChurchWukongXC7A100T
    os.makedirs(output_dir, exist_ok=True)

    top = ChurchWukongXC7A100T(clk_freq=50_000_000, baud=57_600, sim_mode=False)

    ports = (
        [top.clk, top.rst_n]
        + list(top.led)
        + [top.uart_tx_pin, top.uart_rx_pin]
        # ILA observation ports — exposed as top-level outputs so Vivado can
        # connect them to the ILA core by net name (wukong_xc7a100t.tcl).
        # No physical pin constraints are needed; the ILA probes internally.
        + [top.dbg_boot_complete, top.dbg_fault_valid, top.dbg_nia, top.dbg_fault]
    )

    rtlil_text = convert(top, ports=ports)

    il_path = os.path.join(output_dir, "church_wukong_xc7a100t.il")
    with open(il_path, "w") as f:
        f.write(rtlil_text)

    print(f"Generated: {il_path}")
    print(f"  File size: {len(rtlil_text):,} bytes")
    print(f"  Lines: {rtlil_text.count(chr(10)):,}")

    v_path = os.path.join(output_dir, "church_wukong_xc7a100t.v")
    _rtlil_to_verilog(il_path, v_path, module_name="church_wukong_xc7a100t")

    return il_path


def generate_rtlil(output_dir="build"):
    return generate_rtlil_wukong(output_dir)


if __name__ == "__main__":
    output_dir = "build"
    for arg in sys.argv[1:]:
        if not arg.startswith("--"):
            output_dir = arg

    generate_rtlil_wukong(output_dir)
