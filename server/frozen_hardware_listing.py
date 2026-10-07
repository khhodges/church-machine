"""Inspect verified frozen elaboration, never the mutable factory catalog."""
import hashlib
import json
import re


def listing(store, revision_id, disassemble):
    record = store.read("namespace", revision_id)
    if record["metadata"].get("approval_state") != "approved":
        raise ValueError("Select an approved Namespace revision")

    def read(name):
        with open(store.file_path("namespace", revision_id, name), "rb") as stream:
            data = stream.read()
        if hashlib.sha256(data).hexdigest() != record["files"].get(name):
            raise ValueError("Frozen build input integrity check failed")
        return data

    names = [n for n in record["metadata"].get("build_inputs", {}) if n.endswith(".v")]
    if len(names) != 1:
        raise ValueError("Revision has no unambiguous frozen hardware elaboration")
    text = read(names[0]).decode("utf-8")
    pairs = re.findall(r"init_rom\[(\d+)\]\s*=\s*46'h([0-9a-fA-F]+);", text)
    if not pairs:
        raise ValueError("Unsupported frozen hardware initialization format")
    memory = {}
    for _, encoded in pairs:
        value = int(encoded, 16)
        address, word = value >> 32, value & 0xffffffff
        if address in memory or address >= 16384:
            raise ValueError("Invalid frozen hardware initialization")
        memory[address] = word
    selections = record["metadata"].get("selected_lumps", [])
    # Frozen hardware NS descriptors contain byte addresses, unlike the
    # simulator Namespace image. Never substitute simulator placement here.
    thread_base = memory.get(4, 0)
    if not thread_base or thread_base % 4:
        raise ValueError("Frozen boot Thread descriptor is unavailable")
    boot_gt = memory.get(thread_base // 4 + 244, 0)
    target = next((s["name"] for s in selections
                   if s["slot"] == (boot_gt & 0x1ffff)), None)
    rows = []
    # ROM is deliberately not asserted from the current source tree.
    for selection in selections:
        raw = read(selection["binary_hash"] + ".lump")
        slot = selection["slot"]
        base = memory.get(slot * 4)
        if base is None or base % 4:
            raise ValueError("Selected LUMP has no frozen hardware location")
        header = memory.get(base // 4, 0)
        count = ((header >> 10) & 0x1fff) + 1
        if count < 2 or count > len(raw) // 4:
            raise ValueError("Frozen executable bounds are invalid")
        if base // 4 + count > 16384:
            raise ValueError("Frozen LUMP exceeds hardware memory")
        name = selection["name"]
        first_body = memory.get(base // 4 + 1, 0)
        for offset in range(count):
            word = memory.get(base // 4 + offset, 0)
            instruction = ("LUMP_HEADER" if offset == 0 else
                           f"METHOD_ENTRY {offset - 1}: word {word}"
                           if 1 < first_body < count and offset < first_body else
                           disassemble(word, name))
            rows.append(dict(offset=offset, nia=base + offset * 4, word=word,
                             nia_label=f"{name}.{offset}",
                             disasm=instruction))
    rows.sort(key=lambda row: (not row["nia_label"].startswith(f"{target}."), row["nia"]))
    return dict(ok=True, name=target, boot_target=target, boot_gt=boot_gt,
                revision_id=revision_id, source_map="approved-image",
                trace_authoritative=False, trace_pet_name=None, rows=rows,
                notice="Selected approved image — NOT confirmed running on board. "
                       "Hardware-initialized LUMP words; boot ROM omitted.")
