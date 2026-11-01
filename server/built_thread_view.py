"""Inspect individual initialized Thread bodies; never execute or modify them."""
import struct

from hardware.thread_design import THREAD_DESIGN, thread_layout
from shared.architecture_contracts import GT_WORD0


def _gt_field(value, name):
    low, high = GT_WORD0["fields"][name]
    return (value >> low) & ((1 << (high - low + 1)) - 1)


def _capability(value, register, offset, base, entries):
    typ = _gt_field(value, "gt_type")
    types = GT_WORD0["types"]
    result = {
        "register": f"CR{register}", "offset": offset, "address": base + offset,
        "value": value, "type": next(k for k, v in types.items() if v == typ),
        "sequence": _gt_field(value, "gt_seq"),
        "targetSlot": None, "targetName": None, "targetStatus": "not-resolved",
    }
    if typ == types["NULL"]:
        result["targetStatus"] = "null"
    elif typ == types["INFORM"]:
        slot = _gt_field(value, "slot_id")
        target = entries.get(slot)
        result["targetSlot"] = slot
        if target is None:
            result["targetStatus"] = "slot-missing"
        elif result["sequence"] != ((target["w1"] >> 21) & 0x1FF):
            result["targetStatus"] = "generation-mismatch"
        else:
            result["targetName"] = target.get("name")
            result["targetStatus"] = "resolved" if target.get("name") else "name-unavailable"
    # OUTFORM and ABSTRACT bit fields are not destination Namespace addresses.
    return result


def inspect_threads(image, entries, table_base, tuple_evidence=None):
    words = struct.unpack(f"<{len(image) // 4}I", image)
    body_end = min(len(words), table_base)
    by_slot = {e["slot"]: e for e in entries}
    result = []
    for entry in entries:
        base = entry["w0"]
        if not 0 <= base < body_end:
            continue  # MMIO or otherwise outside the retained image body.
        header = words[base]
        if header >> 27 != 0x1F or (header >> 8) & 3 != THREAD_DESIGN["header"]["typ"]:
            continue  # Discover by built body type, not name, count or fixed slot.
        size = 1 << (((header >> 23) & 15) + 6)
        stack = (header >> 10) & 0x1FFF
        item = {
            "slot": entry["slot"], "name": entry.get("name"), "location": base,
            "headerWord": header, "sizeWords": size, "stackWords": stack,
            "error": None, "zones": [], "heap": None, "capabilities": [], "dataRegisters": [],
            "runtimeRegisters": THREAD_DESIGN["runtimeCapabilityRegisters"],
        }
        result.append(item)
        layout = thread_layout(size, stack)
        if not layout["valid"]:
            item["error"] = "Built Thread header has unsupported size or invalid stack/heap geometry."
            continue
        if base + size > body_end or size > (entry["w1"] & 0x1FFFFF) + 1:
            item["error"] = "Built Thread body exceeds its Namespace limit or image body boundary."
            continue
        ranges = [
            ("Header", 0, 0),
            ("Data registers", layout["dr_start"], layout["dr_end"]),
            ("Protected STO", layout["sto_offset"], layout["sto_offset"]),
            ("Tuple heap", layout["heap_start"], layout["heap_end"]),
            ("LIFO stack", layout["stack_start"], layout["stack_end"]),
            ("Capability homes", layout["caps_start"], layout["caps_end"]),
        ]
        item["zones"] = [
            {"name": name, "startOffset": start, "endOffset": end,
             "words": end - start + 1, "absoluteStart": base + start,
             "absoluteEnd": base + end}
            for name, start, end in ranges
        ]
        item["dataRegisters"] = [
            {"register": f"DR{i}", "offset": offset, "address": base + offset,
             "value": words[base + offset]}
            for i, offset in enumerate(range(layout["dr_start"], layout["dr_end"] + 1))
        ]
        heap = list(words[base + layout["heap_start"]:base + layout["heap_end"] + 1])
        item["heap"] = {
            "startOffset": layout["heap_start"], "endOffset": layout["heap_end"],
            "words": len(heap), "initialWords": heap,
            "nonzeroWords": sum(value != 0 for value in heap),
            "definitionsStatus": "not-recorded",
        }
        from server.thread_tuple_evidence import matching_definitions
        definitions = matching_definitions(image, entry, item, tuple_evidence)
        if definitions is not None:
            item["heap"].update(definitionsStatus="recorded", definitions=definitions)
        first_register = THREAD_DESIGN["capabilityHomes"]["firstRegister"]
        item["capabilities"] = [
            _capability(words[base + offset], first_register + i, offset, base, by_slot)
            for i, offset in enumerate(range(layout["caps_start"], layout["caps_end"] + 1))
        ]
    return result
