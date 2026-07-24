import os
import re
import sys
from amaranth.back.verilog import convert
from .core import ChurchCore


_STALE_CR7_PATTERN = "cr7_wr_"

_BOOT_THRD_MUST_HAVE = "reg boot_cap12_wr_en"
_BOOT_THRD_MUST_NOT  = "reg boot_cap8_wr_en"

_PERM_CHECK_GT_SEQ_MIN_BITS = 9
_PERM_CHECK_SEAL_MIN_BITS   = 32


def _validate_perm_check_widths(gt_seq_w, stored_gt_seq_w,
                               calculated_seal_w, stored_seal_w,
                               output_path):
    """Core width validation for ChurchPermCheck signals.

    Separated from _check_perm_check_widths so that tests can exercise the
    logic directly without needing to mock the ChurchPermCheck class.

    Raises SystemExit(1) if any width is below its required minimum.
    """
    checks = [
        ("gt_seq",          gt_seq_w,          _PERM_CHECK_GT_SEQ_MIN_BITS),
        ("stored_gt_seq",   stored_gt_seq_w,   _PERM_CHECK_GT_SEQ_MIN_BITS),
        ("calculated_seal", calculated_seal_w, _PERM_CHECK_SEAL_MIN_BITS),
        ("stored_seal",     stored_seal_w,     _PERM_CHECK_SEAL_MIN_BITS),
    ]

    failed = []
    for name, width, min_bits in checks:
        if width < min_bits:
            failed.append(
                f"  ChurchPermCheck.{name}: {width} bits (need \u2265 {min_bits})"
            )

    if failed:
        print(
            f"\nERROR: perm-check signal width regression detected for {output_path}:",
            file=sys.stderr,
        )
        for msg in failed:
            print(msg, file=sys.stderr)
        print(
            "Update the Signal() width in hardware/perm_check.py.",
            file=sys.stderr,
        )
        sys.exit(1)


def _check_perm_check_widths(verilog_text, output_path):
    """Abort if ChurchPermCheck signal widths fall below the widened spec.

    Reads signal widths directly from the ChurchPermCheck Python class —
    the authoritative source — rather than from the generated Verilog text.
    (Amaranth's backend may optimise away signals that are not connected to
    observable ports, so the .v file alone is not a reliable width witness.)

    Signals checked and their required minima:

      gt_seq, stored_gt_seq  — widened to 9 bits to accommodate the full
                               version counter; must be \u2265 9 bits.

      calculated_seal, stored_seal — widened to 32 bits for a full-word
                                     integrity seal; must be \u2265 32 bits.

    This guard fires at generation time so that a future accidental
    Signal() narrowing (e.g. Signal(9) \u2192 Signal(8)) is caught before
    the netlist reaches synthesis.
    """
    from .perm_check import ChurchPermCheck
    pc = ChurchPermCheck()
    _validate_perm_check_widths(
        gt_seq_w=pc.gt_seq.shape().width,
        stored_gt_seq_w=pc.stored_gt_seq.shape().width,
        calculated_seal_w=pc.calculated_seal.shape().width,
        stored_seal_w=pc.stored_seal.shape().width,
        output_path=output_path,
    )


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


def _check_boot_thrd_cr(verilog_text, output_path):
    """Abort if the INIT_THRD boot state writes the thread GT to the wrong CR.

    CR_THREAD_STACK is CR12 (hw_types.py).  The INIT_THRD case in core.py must
    drive boot_cap12_wr_en high (not boot_cap8_wr_en).  This guard catches
    any future regression — such as the CR8→CR12 boot-register bug — at
    generation time rather than silently producing a netlist that faults on
    real hardware.

    Implementation note — why 'reg' prefix:
      Amaranth emits every Signal that is driven from a procedural always-block
      as ``reg``.  Signals that are never driven (only wired to a constant
      default) are emitted as ``wire ... assign ... = 1'h0``.  So in a correct
      build ``reg boot_cap12_wr_en`` appears (actively driven) while
      ``boot_cap8_wr_en`` is only a ``wire``.  A regression flips this: CR8
      becomes the ``reg`` and CR12 degrades to a ``wire``.  Matching on the
      ``reg`` prefix distinguishes active use from an Amaranth constant-zero
      default without needing to parse the full Verilog AST.

    Checks:
      1. 'reg boot_cap12_wr_en' must appear (thread GT driven into CR12).
      2. 'reg boot_cap8_wr_en' must NOT appear (CR8 must stay a default wire).
    """
    if _BOOT_THRD_MUST_HAVE not in verilog_text:
        print(
            f"\nERROR: {output_path} does not contain '{_BOOT_THRD_MUST_HAVE}'.",
            file=sys.stderr,
        )
        print(
            "INIT_THRD boot state must write the thread GT into CR12 "
            "(CR_THREAD_STACK=12).  Check hardware/core.py INIT_THRD case — "
            "boot_wr_en index should be 12.",
            file=sys.stderr,
        )
        sys.exit(1)

    bad_count = verilog_text.count(_BOOT_THRD_MUST_NOT)
    if bad_count:
        print(
            f"\nERROR: {output_path} contains {bad_count} occurrence(s) of "
            f"'{_BOOT_THRD_MUST_NOT}' — thread GT must go to CR12, not CR8.",
            file=sys.stderr,
        )
        print(
            "Check hardware/core.py INIT_THRD case: boot_wr_en index must be "
            "12 (CR_THREAD_STACK), not 8.",
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
    _check_boot_thrd_cr(verilog_text, output_path)
    _check_perm_check_widths(verilog_text, output_path)

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
    _check_boot_thrd_cr(verilog_text, output_path)
    _check_perm_check_widths(verilog_text, output_path)

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


if __name__ == "__main__":
    output_dir = "build"
    iot_only = False
    for arg in sys.argv[1:]:
        if arg == "--iot":
            iot_only = True
        elif not arg.startswith("--"):
            output_dir = arg

    if iot_only:
        generate_core_iot_verilog(output_dir)
    else:
        generate_core_verilog(output_dir)
