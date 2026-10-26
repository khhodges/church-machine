"""Generate a read-only XSim probe from the exact retained routed netlist."""
import hashlib
from pathlib import Path
import re
import sys

NETLIST_SHA = "fe8d2afb7a7036a7e84975d57b42ed81104c65bc475744cc69047cf1d63f36f7"


def mapped_bits(text, prefix, width):
    cells = re.findall(
        r"(?m)^\s*\\" + re.escape(prefix) + r"\[(\d+)\]\s+\((.*?)\);",
        text, re.S,
    )
    bits = {}
    for index, body in cells:
        index = int(index)
        if index in bits:
            raise ValueError(f"Duplicate register: {prefix}[{index}]")
        outputs = re.findall(r"\.Q\(([^)]+)\)", body)
        if len(outputs) != 1:
            raise ValueError(f"Expected one Q output: {prefix}[{index}]")
        bits[index] = outputs[0].strip().lstrip("\\")
    if set(bits) != set(range(width)):
        raise ValueError(f"Incomplete register mapping: {prefix}")
    return [bits[index] for index in range(width)]


def render_maps(mappings):
    text = r'''
set objects {}
foreach object [get_objects /implemented_boot_tb/dut/*] {
    dict set objects [string trimleft [string trim [file tail $object]] "\\"] $object
}
proc mapped_word {nets} {
    global objects
    set value 0
    set bit 0
    foreach net $nets {
        set raw [get_value -radix bin [dict get $objects $net]]
        if {$raw ne "0" && $raw ne "1"} {error "Unknown bit on $net ($raw)"}
        set value [expr {$value | ($raw << $bit)}]
        incr bit
    }
    return [format %08X $value]
}
'''
    for label, nets in mappings.items():
        if any(any(c in n for c in "{}\n") for n in nets):
            raise ValueError("Unexpected Tcl delimiter in net name")
        text += f"dict set fields {label} [list " + " ".join(
            "{" + net + "}" for net in nets
        ) + "]\n"
    text += r'''
dict for {label nets} $fields {
    foreach net $nets {
        if {![dict exists $objects $net]} {error "Missing mapped output: $net"}
    }
}
puts "MAPPED_OUTPUTS_FOUND"
run 1365310999 ps
foreach sample {before_2_cycles before_1_cycle fault_observation} {
    if {$sample ne "before_2_cycles"} {run 40000 ps}
    puts "METADATA_SAMPLE: $sample"
    dict for {label nets} $fields {puts "$label = [mapped_word $nets]"}
}
puts "METADATA_DIAGNOSTIC_COMPLETE"
exit
'''
    return text


def prepare(netlist):
    raw = Path(netlist).read_bytes()
    if hashlib.sha256(raw).hexdigest() != NETLIST_SHA:
        raise ValueError("Implemented netlist hash mismatch")
    text = raw.decode()
    mappings = {
        f"word{i}": mapped_bits(text, f"core.boot_metadata.metadata_word_{i}_reg", 32)
        for i in range(8)
    }
    # Namespace-only reader errors are 1, 2, or 3; upper bit synthesized away.
    mappings["reader_error_low2"] = mapped_bits(text, "core.boot_metadata.error_reg", 2)
    mappings["reader_state"] = mapped_bits(text, "core.boot_metadata.fsm_state_reg", 3)
    return render_maps(mappings)


if __name__ == "__main__":
    Path(sys.argv[2]).write_text(prepare(sys.argv[1]))
    print("Exact netlist verified; mapped probe prepared. No simulation started.")
