import os
import sys
import subprocess
from amaranth import ClockSignal
from amaranth.back.rtlil import convert
from .tang_nano_20k import ChurchTangNano20K
from .ti60_f225 import ChurchTi60F225


def _rtlil_to_verilog(il_path, v_path):
    """Convert Amaranth RTLIL to Verilog via Yosys for use in Efinity IDE."""
    script = (
        f"read_rtlil {il_path}; "
        f"hierarchy -top top; "
        f"proc; "
        f"flatten; "
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
