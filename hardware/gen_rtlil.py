import os
import re
import sys
import subprocess
from amaranth import ClockSignal
from amaranth.back.rtlil import convert
from .tang_nano_20k import ChurchTangNano20K
from .ti60_f225 import ChurchTi60F225


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
    write_verilog cannot lower to plain operators.  Efinity's synthesiser
    rejects them.  This post-processor replaces each cell with a simple assign
    statement that Efinity can synthesise directly.

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


def _rtlil_to_verilog(il_path, v_path):
    """Convert Amaranth RTLIL to Verilog via Yosys for use in Efinity IDE."""
    script = (
        f"read_rtlil {il_path}; "
        f"hierarchy -top top; "
        f"proc; "
        f"flatten; "
        f"opt -mux_undef -undriven; "
        f"opt; "
        f"opt_reduce; "
        f"opt_clean; "
        f"alumacc; "
        f"opt -fast; "
        f"clean; "
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
            return v_path
        else:
            print(f"  [warn] yosys failed: {result.stderr[-400:]}")
            return None
    except FileNotFoundError:
        print("  [warn] yosys not found — skipping .v generation")
        return None


def generate_rtlil_tang_nano(output_dir="build"):
    os.makedirs(output_dir, exist_ok=True)

    top = ChurchTangNano20K(clk_freq=27_000_000, baud=115200, sim_mode=False)

    ports = [
        top.uart_tx, top.uart_rx, top.push_button,
        ClockSignal("sync"),
    ] + [led for i, led in enumerate(top.led) if i != 3]

    rtlil_text = convert(top, ports=ports)

    output_path = os.path.join(output_dir, "church_tang_nano_20k.il")
    with open(output_path, "w") as f:
        f.write(rtlil_text)

    print(f"Generated: {output_path}")
    print(f"  File size: {len(rtlil_text):,} bytes")
    print(f"  Lines: {rtlil_text.count(chr(10)):,}")

    return output_path


def generate_rtlil_ti60(output_dir="build"):
    os.makedirs(output_dir, exist_ok=True)

    top = ChurchTi60F225(clk_freq=50_000_000, baud=115200, sim_mode=False)

    ports = [
        top.uart_tx, top.uart_rx, top.push_button,
        ClockSignal("sync"),
    ] + top.led

    rtlil_text = convert(top, ports=ports)

    il_path = os.path.join(output_dir, "church_ti60_f225.il")
    with open(il_path, "w") as f:
        f.write(rtlil_text)

    print(f"Generated: {il_path}")
    print(f"  File size: {len(rtlil_text):,} bytes")
    print(f"  Lines: {rtlil_text.count(chr(10)):,}")

    v_path = os.path.join(output_dir, "church_ti60_f225.v")
    _rtlil_to_verilog(il_path, v_path)

    return il_path


def generate_rtlil(output_dir="build"):
    return generate_rtlil_tang_nano(output_dir)


if __name__ == "__main__":
    output_dir = "build"
    board = "tang-nano-20k"
    for arg in sys.argv[1:]:
        if not arg.startswith("--"):
            output_dir = arg
        elif arg == "--ti60":
            board = "ti60-f225"

    if board == "ti60-f225":
        generate_rtlil_ti60(output_dir)
    else:
        generate_rtlil_tang_nano(output_dir)
