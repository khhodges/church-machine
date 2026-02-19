"""Generate synthesizable Verilog from the Pure Church Machine Amaranth design."""

import os
import sys
from amaranth.back.verilog import convert
from .core import ChurchCore
from .top import ChurchTop


def generate_verilog(output_dir="build"):
    os.makedirs(output_dir, exist_ok=True)

    core = ChurchCore()

    ports = [
        core.imem_addr, core.imem_data, core.imem_valid,
        core.dmem_addr, core.dmem_rd_en, core.dmem_rd_data,
        core.dmem_wr_data, core.dmem_wr_en,
        core.ns_addr, core.ns_rd_en, core.ns_wr_en,
        core.boot_start, core.boot_state, core.boot_complete,
        core.gc_start, core.gc_busy, core.gc_garbage_count,
        core.fault, core.fault_valid,
        core.nia,
    ]

    verilog_text = convert(core, ports=ports)

    output_path = os.path.join(output_dir, "church_core.v")
    with open(output_path, "w") as f:
        f.write(verilog_text)

    print(f"Generated: {output_path}")
    print(f"  File size: {len(verilog_text):,} bytes")
    print(f"  Lines: {verilog_text.count(chr(10)):,}")

    module_count = verilog_text.count("module ")
    print(f"  Verilog modules: {module_count}")

    return output_path


def generate_top_verilog(output_dir="build"):
    os.makedirs(output_dir, exist_ok=True)

    top = ChurchTop(clk_freq=12_000_000, baud=115200)

    ports = [
        top.uart_tx,
        top.led_boot, top.led_run, top.led_fault,
        top.dbg_nia, top.dbg_fault, top.dbg_fault_valid,
        top.dbg_boot_state, top.dbg_boot_complete,
    ]

    verilog_text = convert(top, ports=ports)

    output_path = os.path.join(output_dir, "church_top.v")
    with open(output_path, "w") as f:
        f.write(verilog_text)

    print(f"\nGenerated: {output_path}")
    print(f"  File size: {len(verilog_text):,} bytes")
    print(f"  Lines: {verilog_text.count(chr(10)):,}")

    module_count = verilog_text.count("module ")
    print(f"  Verilog modules: {module_count}")

    return output_path


if __name__ == "__main__":
    output_dir = sys.argv[1] if len(sys.argv) > 1 else "build"
    generate_verilog(output_dir)
    generate_top_verilog(output_dir)
