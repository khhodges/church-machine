"""Check the retained candidate's mapped first-fetch structure, not live hardware."""
import hashlib
import json
from pathlib import Path
import re
import sys

EXPECTED = "fe8d2afb7a7036a7e84975d57b42ed81104c65bc475744cc69047cf1d63f36f7"


def check(path):
    raw = Path(path).read_bytes()
    if hashlib.sha256(raw).hexdigest() != EXPECTED:
        raise ValueError("This check applies only to the retained implemented netlist")
    text = raw.decode()

    def cell(kind, name):
        spelling = "\\" + name if "." in name or "[" in name else name
        matches = list(re.finditer(r"(?m)^    " + re.escape(spelling) + r"[ \t]*$", text))
        if len(matches) != 1:
            raise ValueError(f"Expected exactly one cell: {name}")
        at = matches[0].start()
        start = text.rfind("\n  " + kind + " #(", 0, at)
        if start < 0:
            raise ValueError(f"Missing {kind} declaration for {name}")
        params = dict(re.findall(r"\.(\w+)\(([^)]+)\)", text[start:at]))
        end = text.index(");", at)
        ports = {k: v.strip().lstrip("\\") for k, v in
                 re.findall(r"\.(\w+)\(([^)]+)\)", text[at:end])}
        return params, ports

    def lut(kind, name, init, ports):
        parameters, actual = cell(kind, name)
        if parameters["INIT"] != init or actual != ports:
            raise ValueError(f"Unexpected mapped logic: {name}")

    lut("LUT2", "p_1_out_0_i_1", "4'h2", {
        "I0": "p_24350_in", "I1": "initializer.ready", "O": "initializer.rd__en"})
    lut("LUT2", "initializer.rd__addr[0]_i_3", "4'h8", {
        "I0": "initializer.ready", "I1": "p_24350_in",
        "O": "initializer.rd__addr[0]_i_3_n_0"})
    lut("LUT2", "initializer.rd__addr[0]_i_1", "4'h2", {
        "I0": "initializer.rd__addr[0]_i_3_n_0",
        "I1": "initializer.rd__addr[0]_i_4_n_0", "O": "_001113_"})
    lut("LUT1", "initializer.rd__addr[0]_i_2", "2'h1", {
        "I0": "initializer.rd__addr_reg_n_0_[0]", "O": "_021024__0"})
    for register in ("initializer.ready_reg", "initializer.rd__addr_reg[0]"):
        if cell("FDRE", register)[0]["INIT"] != "1'b0":
            raise ValueError(f"Unexpected startup state: {register}")

    first_entry = 0
    for bank in range(3):
        params, ports = cell("RAMB36E1", f"p_1_out_{bank}")
        required = {"DOA_REG": "1", "INIT_A": "36'h000000000", "READ_WIDTH_A": "18"}
        if any(params[k] != v for k, v in required.items()):
            raise ValueError("Unexpected ROM register configuration")
        if ports["ENARDEN"] != "_001113_" or ports["REGCEAREGCE"] != "initializer.rd__en":
            raise ValueError("Unexpected ROM clock enables")
        if not ports["ADDRARDADDR"].endswith("_021024__0,1'b0,1'b0,1'b0,1'b0}"):
            raise ValueError("Unexpected ROM address low bit")
        first_entry |= (int(params["INIT_00"].split("'h")[1], 16) & 0xffff) << (16 * bank)
    if first_entry != 0xF8810100:
        raise ValueError("ROM entry zero does not contain the expected header")
    return {
        "netlist_sha256": EXPECTED,
        "evidence": "static mapped-primitive checks; not a new vendor simulation or board readback",
        "rom_entry_zero": f"{first_entry:012X}",
        "array_enable": "active AND ready AND NOT last",
        "output_register_enable": "active AND NOT ready",
        "initial_ready": 0,
        "initial_address_counter_lsb": 0,
        "rom_address_lsb": "NOT address_counter_lsb",
        "rom_output_initial_value": 0,
        "finding": "First fetch clocks the output register before any array read; first array read addresses an odd entry, not entry zero.",
    }


if __name__ == "__main__":
    print(json.dumps(check(sys.argv[1]), indent=2))
