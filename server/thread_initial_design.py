"""Approved per-Thread build inputs, distinct from runtime state and drafts."""
from hardware.thread_design import thread_layout
from server.thread_tuple_evidence import validate_design as validate_tuples, validate_target


def validate_design(value):
    design = validate_tuples(value)
    if "target" not in design:
        raise ValueError("Select a bound Thread before saving initialization")
    if design["stackWords"] < 4:
        raise ValueError("Thread initialization requires at least four stack words")
    initial = value.get("initialization")
    if not isinstance(initial, dict) or set(initial) != {"dataRegisters", "capabilityRegisters"}:
        raise ValueError("Supply dataRegisters and capabilityRegisters initialization")
    normalized = {}
    for key, count in (("dataRegisters", 16), ("capabilityRegisters", 12)):
        values = initial.get(key)
        if not isinstance(values, list) or len(values) != count:
            raise ValueError(f"{key} requires exactly {count} values")
        if any(v is not None and (type(v) is not int or not 0 <= v <= 0xFFFFFFFF)
               for v in values):
            raise ValueError(f"{key} values must be null or unsigned 32-bit integers")
        normalized[key] = list(values)
    for t in design["tuples"]:
        if t["policy"] != "initialize":
            raise ValueError("A fresh build cannot preserve a runtime heap. Select Initialize for each tuple.")
    design["initialization"] = normalized
    return design


def validate_designs(values):
    if not isinstance(values, list) or len(values) > 1024:
        raise ValueError("Thread designs must be a bounded list")
    designs = [validate_design(d) for d in values]
    slots = [d["target"]["slot"] for d in designs]
    if len(slots) != len(set(slots)):
        raise ValueError("Duplicate Thread initialization target")
    return designs


def validate_bindings(design, rows):
    validate_target(design, rows)
    by_slot = {r["slot"]: r for r in rows}
    owner = by_slot[design["target"]["slot"]]
    if owner.get("filename"):
        raise ValueError("This Thread is an immutable selected LUMP; create a new Thread revision rather than overwrite its bytes")
    for i, value in enumerate(design["initialization"]["capabilityRegisters"]):
        if value is None:
            continue
        typ = (value >> 25) & 3
        if i == 0 and (typ != 1 or not value & (1 << 27) or not value & (1 << 30)):
            raise ValueError("CR0 initialization must be an executable Inform GT")
        if typ == 1:
            target = by_slot.get(value & 0xFFFF)
            if not target or target.get("archived") or int(target.get("seq", 0)) != (value >> 16) & 511:
                raise ValueError(f"CR{i} Inform GT does not match the saved Namespace slot and generation")


def tuple_initial_words(t):
    result = []
    for f in t["fields"]:
        if f["type"] == "utf8":
            raw = f["initial"].encode("utf-8")
            padded = raw.ljust(((f["size"] + 3) // 4) * 4, b"\0")
            result += [len(raw)] + [int.from_bytes(padded[i:i + 4], "little")
                                   for i in range(0, len(padded), 4)]
        elif f["type"] == "words":
            result += [0] * f["size"]
        else:
            result.append(f["initial"] & 0xFFFFFFFF)
    return result


def apply_initialization(mem, base, design, boot=False):
    """Apply to a private generated body only, after all defaults are prepared."""
    layout = thread_layout(design["sizeWords"], design["stackWords"])
    if not layout["valid"] or base < 0 or base + design["sizeWords"] > len(mem):
        raise ValueError("Thread initialization exceeds its generated body")
    for i, value in enumerate(design["initialization"]["dataRegisters"]):
        if value is not None:
            mem[base + layout["dr_start"] + i] = value
    for i, value in enumerate(design["initialization"]["capabilityRegisters"]):
        if value is not None:
            if boot and i == 0 and value != mem[base + layout["caps_start"]]:
                raise ValueError("Boot.Thread CR0 must match the selected Namespace boot entry")
            mem[base + layout["caps_start"] + i] = value
            if i == 0:
                # Maintain the existing canonical root and PC-0 resume frames.
                resume_sto = layout["stack_end"] - 2
                mem[base + resume_sto + 1] = value
                if not boot:
                    mem[base + resume_sto - 1] = value
    for t in design["tuples"]:
        values = tuple_initial_words(t)
        start = base + layout["heap_start"] + t["offset"]
        if start + len(values) > base + layout["stack_start"]:
            raise ValueError("Tuple initialization exceeds the Thread heap")
        mem[start:start + len(values)] = values
