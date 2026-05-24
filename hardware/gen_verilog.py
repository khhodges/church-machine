import os
import re
import sys
from amaranth.back.verilog import convert
from .core import ChurchCore
from .tang_nano_20k import ChurchTangNano20K
from .ti60_f225 import ChurchTi60F225


_STALE_CR7_PATTERN = "cr7_wr_"


def _check_stale_cr7(verilog_text, output_path):
    """Abort if stale CR7 signal names are present in freshly-generated Verilog.

    This is an early-exit guard: if hardware/core.py still emits the old
    cr7_wr_* names the build stops immediately with a clear message rather than
    silently producing a dirty netlist.
    """
    matches = verilog_text.count(_STALE_CR7_PATTERN)
    if matches:
        import sys
        print(
            f"\nERROR: {output_path} contains {matches} occurrence(s) of "
            f"'{_STALE_CR7_PATTERN}' — stale CR7 signal names detected.",
            file=sys.stderr,
        )
        print(
            "Verify that hardware/core.py uses the CR14 names throughout "
            "and re-run generation.",
            file=sys.stderr,
        )
        sys.exit(1)


def _patch_clocks(verilog_text):
    """Fix Amaranth's disconnected clocks: thread `clk` through the hierarchy.

    Amaranth's convert() ties clk=1'h0 in every module. This patch:
    1. Adds `clk` to every module's port list as an input
    2. Changes `wire clk;` to `input clk;` in every module
    3. Adds `.clk(clk)` to every submodule instantiation
    4. Removes `assign clk = 1'h0;` lines
    5. Replaces `always @(posedge 1'h0)` with `always @(posedge clk)`
    """
    text = verilog_text
    text = text.replace("assign clk = 1'h0;", "")
    text = text.replace("always @(posedge 1'h0)", "always @(posedge clk)")

    lines = text.split('\n')

    modules_with_clk = set()
    module_names = set()
    current_module = None
    for line in lines:
        m = re.match(r'^module\s+(\\?[\w.]+)\s*\(', line)
        if m:
            current_module = m.group(1)
            module_names.add(current_module)
        if current_module and line.strip() == 'wire clk;':
            modules_with_clk.add(current_module)
        if line.strip() == 'endmodule':
            current_module = None

    result = []
    current_module = None
    for line in lines:
        stripped = line.strip()

        m = re.match(r'^module\s+(\\?[\w.]+)\s*\((.+)', line)
        if m:
            current_module = m.group(1)
            mod_name = m.group(1)
            rest = m.group(2)
            if mod_name in modules_with_clk and 'clk' not in rest:
                sep = ' ' if mod_name.startswith('\\') else ''
                line = f'module {mod_name}{sep}(clk, {rest}'

        if stripped == 'wire clk;' and current_module in modules_with_clk:
            result.append('  input clk;')
            continue

        if stripped == 'endmodule':
            current_module = None

        result.append(line)

    text = '\n'.join(result)

    def add_clk_to_instantiation(match):
        full = match.group(0)
        if '.clk(clk)' in full:
            return full
        insert_pos = full.find('(') + 1
        return full[:insert_pos] + '\n    .clk(clk),' + full[insert_pos:]

    for mod_name in modules_with_clk:
        escaped = re.escape(mod_name)
        pattern = escaped + r'\s+\w+\s*\([^;]*?\);'
        text = re.sub(pattern, add_clk_to_instantiation, text, flags=re.DOTALL)

    return text


def _patch_rst(verilog_text):
    """Remove rst from top module port list, tie it to 1'b0 internally."""
    lines = verilog_text.split('\n')
    patched = []
    in_top_module = False
    rst_removed = False
    skip_next_wire_rst = False
    for line in lines:
        if line.startswith('module top(') and not rst_removed:
            line = line.replace(', rst,', ',')
            line = line.replace(', rst)', ')')
            in_top_module = True
        if in_top_module and line.strip() == 'input rst;':
            patched.append('  wire rst = 1\'b0;')
            skip_next_wire_rst = True
            rst_removed = True
            in_top_module = False
            continue
        if skip_next_wire_rst and line.strip() == 'wire rst;':
            skip_next_wire_rst = False
            continue
        patched.append(line)
    return '\n'.join(patched)


def generate_core_verilog(output_dir="build"):
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
    _check_stale_cr7(verilog_text, output_path)

    with open(output_path, "w") as f:
        f.write(verilog_text)

    print(f"Generated: {output_path}")
    print(f"  File size: {len(verilog_text):,} bytes")
    print(f"  Lines: {verilog_text.count(chr(10)):,}")

    module_count = verilog_text.count("module ")
    print(f"  Verilog modules: {module_count}")

    return output_path


def generate_tang_nano_20k_verilog(output_dir="build"):
    os.makedirs(output_dir, exist_ok=True)

    top = ChurchTangNano20K(clk_freq=27_000_000, baud=115200, sim_mode=False)

    ports = [
        top.uart_tx, top.uart_rx, top.push_button,
    ] + top.led

    verilog_text = convert(top, ports=ports)
    verilog_text = _patch_clocks(verilog_text)
    verilog_text = _patch_rst(verilog_text)

    output_path = os.path.join(output_dir, "church_tang_nano_20k.v")
    _check_stale_cr7(verilog_text, output_path)

    with open(output_path, "w") as f:
        f.write(verilog_text)

    print(f"Generated: {output_path}")
    print(f"  File size: {len(verilog_text):,} bytes")
    print(f"  Lines: {verilog_text.count(chr(10)):,}")

    module_count = verilog_text.count("module ")
    print(f"  Verilog modules: {module_count}")

    return output_path


def generate_core_iot_verilog(output_dir="build"):
    os.makedirs(output_dir, exist_ok=True)

    core = ChurchCore(iot_profile=True)

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

    output_path = os.path.join(output_dir, "church_core_iot.v")
    _check_stale_cr7(verilog_text, output_path)

    with open(output_path, "w") as f:
        f.write(verilog_text)

    print(f"Generated: {output_path}")
    print(f"  File size: {len(verilog_text):,} bytes")
    print(f"  Lines: {verilog_text.count(chr(10)):,}")

    module_count = verilog_text.count("module ")
    print(f"  Verilog modules: {module_count}")

    return output_path


def generate_tang_nano_20k_iot_verilog(output_dir="build"):
    os.makedirs(output_dir, exist_ok=True)

    top = ChurchTangNano20K(clk_freq=27_000_000, baud=115200, sim_mode=False, iot_profile=True)

    ports = [
        top.uart_tx, top.uart_rx, top.push_button,
    ] + top.led

    verilog_text = convert(top, ports=ports)
    verilog_text = _patch_clocks(verilog_text)
    verilog_text = _patch_rst(verilog_text)

    output_path = os.path.join(output_dir, "church_tang_nano_20k_iot.v")
    _check_stale_cr7(verilog_text, output_path)

    with open(output_path, "w") as f:
        f.write(verilog_text)

    print(f"Generated: {output_path}")
    print(f"  File size: {len(verilog_text):,} bytes")
    print(f"  Lines: {verilog_text.count(chr(10)):,}")

    module_count = verilog_text.count("module ")
    print(f"  Verilog modules: {module_count}")

    return output_path


def _patch_module_name(verilog_text, old_name, new_name):
    """Rename a Verilog module and all its instantiations.

    Used to rename the Amaranth-generated ``module top`` to a project-specific
    name so it can coexist with another ``top`` module in the same Efinity
    project (e.g., the combined SoC+CM ``top.v``).

    Renames:
      * ``module <old_name>(`` → ``module <new_name>(``
      * Any self-referential instantiation ``<old_name> u_xxx (`` inside the
        file (rare in Amaranth output, but included for completeness).
    """
    text = re.sub(
        r'\bmodule\s+' + re.escape(old_name) + r'\b',
        'module ' + new_name,
        verilog_text,
    )
    text = re.sub(
        r'\b' + re.escape(old_name) + r'(\s+\w+\s*\()',
        new_name + r'\1',
        text,
    )
    return text


def generate_ti60_f225_verilog(output_dir="build"):
    """Generate Church Machine RTL for the Efinix Ti60F225.

    Converts ``hardware/ti60_f225.py`` (``ChurchTi60F225``) to Verilog using
    Amaranth's ``convert()`` backend, then applies the standard clock and reset
    patches plus a module rename so the module can be instantiated as a
    submodule inside the combined SoC+CM project.

    Output: ``build/church_ti60_f225.v``   (module name: ``church_ti60f225``)

    To use in the combined project (``hardware/soc_combined/``):

    .. code-block:: bash

        python hardware/gen_verilog.py --ti60
        cp build/church_ti60_f225.v hardware/soc_combined/
    """
    os.makedirs(output_dir, exist_ok=True)

    top = ChurchTi60F225(clk_freq=25_000_000, baud=115200, sim_mode=False)

    ports = [
        top.uart_tx,
        top.uart_rx,
        top.push_button,
        top.dbg_nia,
        top.dbg_fault,
        top.dbg_fault_valid,
        top.dbg_boot_complete,
    ] + top.led

    verilog_text = convert(top, ports=ports)
    verilog_text = _patch_clocks(verilog_text)
    verilog_text = _patch_rst(verilog_text)
    verilog_text = _patch_module_name(verilog_text, "top", "church_ti60f225")

    output_path = os.path.join(output_dir, "church_ti60_f225.v")
    _check_stale_cr7(verilog_text, output_path)

    with open(output_path, "w") as f:
        f.write(verilog_text)

    print(f"Generated: {output_path}")
    print(f"  File size: {len(verilog_text):,} bytes")
    print(f"  Lines: {verilog_text.count(chr(10)):,}")

    module_count = verilog_text.count("module ")
    print(f"  Verilog modules: {module_count}")

    return output_path


if __name__ == "__main__":
    output_dir = "build"
    iot_only = False
    ti60 = False
    for arg in sys.argv[1:]:
        if arg == "--iot":
            iot_only = True
        elif arg == "--ti60":
            ti60 = True
        elif not arg.startswith("--"):
            output_dir = arg

    if ti60:
        generate_ti60_f225_verilog(output_dir)
    elif iot_only:
        generate_core_iot_verilog(output_dir)
        generate_tang_nano_20k_iot_verilog(output_dir)
    else:
        generate_core_verilog(output_dir)
        generate_tang_nano_20k_verilog(output_dir)
