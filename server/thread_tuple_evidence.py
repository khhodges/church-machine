"""Display-only tuple design evidence. Never writes or initializes image bytes."""
import copy
import hashlib
import re

from hardware.thread_design import thread_layout


def validate_design(design):
    """Validate the browser schema independently; retain only canonical fields."""
    if not isinstance(design, dict):
        raise ValueError("Tuple design must be an object")
    size, stack = design.get("sizeWords"), design.get("stackWords")
    if type(size) is not int or type(stack) is not int:
        raise ValueError("Tuple design requires integer Thread geometry")
    layout = thread_layout(size, stack)
    if not layout["valid"]:
        raise ValueError("Tuple design has invalid Thread geometry")
    tuples = design.get("tuples")
    if not isinstance(tuples, list) or len(tuples) > 64:
        raise ValueError("Tuple design requires at most 64 tuples")
    names, spans, result = set(), [], []

    def name(value, used):
        if (not isinstance(value, str) or
                re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,31}", value) is None or
                value.lower() in used):
            raise ValueError("Tuple and field names must be valid and unique")
        used.add(value.lower())
        return value

    for t in tuples:
        if not isinstance(t, dict):
            raise ValueError("Invalid tuple")
        label = name(t.get("name"), names)
        offset, policy, fields = t.get("offset"), t.get("policy"), t.get("fields")
        if type(offset) is not int or offset < 0 or policy not in ("initialize", "preserve"):
            raise ValueError("Invalid tuple offset or policy")
        if not isinstance(fields, list) or not 1 <= len(fields) <= 64:
            raise ValueError("Tuple requires 1..64 fields")
        field_names, normalized, words = set(), [], 0
        for f in fields:
            if not isinstance(f, dict):
                raise ValueError("Invalid tuple field")
            fname = name(f.get("name"), field_names)
            typ, count, initial = f.get("type"), f.get("size"), f.get("initial")
            if type(count) is not int:
                raise ValueError("Field size must be an integer")
            if typ in ("uint32", "int32"):
                low, high = (0, 0xFFFFFFFF) if typ == "uint32" else (-2147483648, 2147483647)
                valid = count == 1 and type(initial) is int and low <= initial <= high
                width = 1
            elif typ == "words":
                valid = 1 <= count <= 4096 and type(initial) is int and initial == 0
                width = count
            elif typ == "utf8":
                try:
                    valid = (1 <= count <= 1024 and isinstance(initial, str)
                             and len(initial.encode("utf-8")) <= count)
                except UnicodeError:
                    valid = False
                width = 1 + (count + 3) // 4
            else:
                raise ValueError("Unknown tuple field type")
            if not valid:
                raise ValueError("Invalid tuple field size or initial intent")
            normalized.append({"name": fname, "type": typ, "size": count,
                               "initial": initial})
            words += width
        end = offset + words
        if end > layout["heap_end"] - layout["heap_start"] + 1:
            raise ValueError("Tuple exceeds the approved Thread heap")
        if any(offset < b and end > a for a, b in spans):
            raise ValueError("Tuple definitions overlap")
        spans.append((offset, end))
        result.append({"name": label, "offset": offset, "policy": policy,
                       "fields": normalized})
    target = design.get("target")
    if target is not None:
        if (not isinstance(target, dict) or
                any(type(target.get(k)) is not int for k in ("slot", "sequence", "namespaceSequence")) or
                any(not isinstance(target.get(k), str) or not target[k].strip()
                    or len(target[k]) > 256 for k in ("name", "namespaceName")) or
                not 1 <= target["slot"] <= 1023 or
                not 0 <= target["sequence"] <= 511 or not 0 <= target["namespaceSequence"] <= 511):
            raise ValueError("Tuple approval requires an exact Thread/Namespace generation")
        target = {k: target[k] for k in ("slot", "sequence", "namespaceSequence", "name", "namespaceName")}
    return {"sizeWords": size, "stackWords": stack, "tuples": result,
            **({"target": target} if target is not None else {})}


def validate_approvals(designs):
    if not isinstance(designs, list) or len(designs) > 1024:
        raise ValueError("Approved Thread tuple designs must be a bounded list")
    result, slots = [], set()
    for design in designs:
        item = validate_design(design)
        if "target" not in item or item["target"]["slot"] in slots:
            raise ValueError("Tuple approvals require distinct bound Thread slots")
        slots.add(item["target"]["slot"])
        result.append(item)
    return result


def validate_target(design, rows):
    target = design.get("target")
    if target is None:
        raise ValueError("Select a bound named Thread before approving tuple definitions")
    by_slot = {r["slot"]: r for r in rows}
    row, ns = by_slot.get(target["slot"]), by_slot.get(0)
    if (not row or not ns or int(row.get("seq", 0)) != target["sequence"]
            or int(ns.get("seq", 0)) != target["namespaceSequence"]
            or row.get("name") != target["name"] or ns.get("name") != target["namespaceName"]):
        raise ValueError("Thread or Namespace binding changed; refresh before approving")


def tuple_words(t):
    return sum(1 + (f["size"] + 3) // 4 if f["type"] == "utf8"
               else f["size"] for f in t["fields"])


def body_identity(image, entry, thread):
    base, size = thread["location"], thread["sizeWords"]
    return {"slot": entry["slot"], "descriptor": [entry.get(f"w{i}", 0) for i in range(4)],
            "body_sha256": hashlib.sha256(image[base * 4:(base + size) * 4]).hexdigest()}


def capture(image, raw, design, eligible_slots, source_rows=None):
    """Called only for new builds, never while inspecting or importing old ones."""
    if design is None:
        return None
    from server.built_thread_view import inspect_threads
    designs = validate_approvals(design) if isinstance(design, list) else [validate_design(design)]
    entries = {e["slot"]: e for e in raw["entries"]}
    identities = {e["slot"]: e for e in (source_rows if source_rows is not None else raw["entries"])}
    records = []
    for t in inspect_threads(image, raw["entries"], raw["nsTableBase"]):
        candidates = [d for d in designs if "target" not in d or (
            d["target"]["slot"] == t["slot"] and
            d["target"]["name"] == identities.get(t["slot"], {}).get("name") and
            d["target"]["namespaceName"] == identities.get(0, {}).get("name") and
            d["target"]["sequence"] == ((entries[t["slot"]]["w1"] >> 21) & 511) and
            d["target"]["namespaceSequence"] == ((entries.get(0, {}).get("w1", 0) >> 21) & 511))]
        if len(candidates) != 1:
            continue
        selected = candidates[0]
        if (t["slot"] not in eligible_slots or t["error"] or
                (t["sizeWords"], t["stackWords"]) != (selected["sizeWords"], selected["stackWords"])):
            continue
        records.append({**body_identity(image, entries[t["slot"]], t),
                        "design": copy.deepcopy(selected)})
    return {"version": 1, "image_sha256": hashlib.sha256(image).hexdigest(),
            "threads": records}


def matching_definitions(image, entry, thread, evidence):
    if (not isinstance(evidence, dict) or evidence.get("version") != 1 or
            evidence.get("image_sha256") != hashlib.sha256(image).hexdigest()):
        return None
    records = evidence.get("threads")
    if not isinstance(records, list):
        return None
    rows = [r for r in records if isinstance(r, dict) and r.get("slot") == entry["slot"]]
    if len(rows) != 1:
        return None
    row = rows[0]
    if any(row.get(k) != v for k, v in body_identity(image, entry, thread).items()):
        return None
    try:
        design = validate_design(row.get("design"))
    except (ValueError, TypeError, KeyError):
        return None
    if (design["sizeWords"], design["stackWords"]) != (thread["sizeWords"], thread["stackWords"]):
        return None
    target = design.get("target")
    if target and (target["slot"] != entry["slot"] or
                   target["sequence"] != ((entry["w1"] >> 21) & 511)):
        return None
    return [{**t, "words": tuple_words(t)} for t in design["tuples"]]
