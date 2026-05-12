#!/usr/bin/env python3
import os
import sys
import argparse

from amaranth.back.verilog import convert

from .fpga_top import CMCapFPGATop
from .core import CMCapCore


def _flatten_port(sig):
    from amaranth.hdl._ast import Signal as AmaranthSignal
    if isinstance(sig, AmaranthSignal):
        return [sig]
    try:
        return [sig.as_value()]
    except (AttributeError, TypeError):
        pass
    return [sig]


def generate_core_verilog(output_dir):
    core = CMCapCore()
    raw_ports = [
        core.imem_addr, core.imem_data, core.imem_valid,
        core.dmem_addr, core.dmem_rd_en, core.dmem_rd_data,
        core.dmem_wr_data, core.dmem_wr_en,
        core.ns_addr, core.ns_rd_en, core.ns_rd_data,
        core.ns_wr_data, core.ns_wr_en,
        core.clist_addr, core.clist_rd_en, core.clist_rd_data,
        core.clist_wr_data, core.clist_wr_en,
        core.boot_start, core.boot_state, core.boot_complete,
        core.gc_start, core.gc_busy, core.gc_garbage_count,
        core.fault, core.fault_valid,
        core.nia, core.flags,
    ]
    ports = []
    for p in raw_ports:
        ports.extend(_flatten_port(p))

    verilog_text = convert(core, name="ctmm_cap_core", ports=ports)
    path = os.path.join(output_dir, "ctmm_cap_core.v")
    with open(path, "w") as f:
        f.write(verilog_text)
    print(f"  Core Verilog written to {path}")
    return path


def generate_top_verilog(output_dir, uart_divisor=868):
    top = CMCapFPGATop(uart_divisor=uart_divisor)
    ports = [top.uart_tx, top.leds]

    verilog_text = convert(top, name="ctmm_cap_fpga_top", ports=ports)
    path = os.path.join(output_dir, "ctmm_cap_fpga_top.v")
    with open(path, "w") as f:
        f.write(verilog_text)
    print(f"  FPGA top Verilog written to {path}")
    return path


def main():
    parser = argparse.ArgumentParser(description="Generate Verilog from CMCap Amaranth HDL")
    parser.add_argument("-o", "--output-dir", default="fpga_output",
                        help="Output directory for generated files (default: fpga_output)")
    parser.add_argument("--uart-divisor", type=int, default=868,
                        help="UART baud divisor (default: 868 for 100MHz/115200)")
    parser.add_argument("--core-only", action="store_true",
                        help="Generate only the core (no FPGA top wrapper)")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)

    print("CMCap Verilog Generation")
    print("=" * 50)

    print("\n[1/2] Generating core Verilog...")
    generate_core_verilog(args.output_dir)

    if not args.core_only:
        print(f"\n[2/2] Generating FPGA top Verilog (UART divisor={args.uart_divisor})...")
        generate_top_verilog(args.output_dir, uart_divisor=args.uart_divisor)
    else:
        print("\n[2/2] Skipped FPGA top (--core-only)")

    print(f"\nDone. Files in: {args.output_dir}/")
    print("\nNext steps:")
    print("  1. Choose target FPGA board")
    print("  2. Edit constraints file for your board's pinout")
    print("  3. Run: make synth  (Yosys synthesis)")
    print("  4. Run: make pnr    (Place and route)")
    print("  5. Run: make prog   (Program FPGA)")


if __name__ == "__main__":
    main()
