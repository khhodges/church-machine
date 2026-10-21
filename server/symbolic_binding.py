"""Destination-only binding of integrity-covered symbolic LUMP references."""
import copy
import hashlib
import json
import re
import struct

SCHEMA = "church.symbolic-lump-binding/v1"
FAULT = 0xF7000000
NAME = re.compile(r"^[A-Za-z_][\w-]*(?:\.[\w-]+)+$")


def validate(contract, cc=None, words=None):
    from server.portable_binding import _rights
    if not isinstance(contract, dict) or contract.get("schema") != SCHEMA:
        raise ValueError("Invalid symbolic binding schema")
    out = copy.deepcopy(contract)
    if not NAME.fullmatch(str(out.get("owner", ""))):
        raise ValueError("Symbolic owner must be a declared dot-name")
    deps, calls = out.get("dependencies"), out.get("calls")
    if not isinstance(deps, list) or not isinstance(calls, list):
        raise ValueError("Symbolic dependencies and calls must be arrays")
    if not deps:
        raise ValueError("Symbolic linkage requires compiler-owned SELF")
    if cc is not None and len(deps) != cc:
        raise ValueError("Symbolic dependencies must cover the exact C-list")
    for row, dep in enumerate(deps):
        if not isinstance(dep, dict) or type(dep.get("relocation_row")) is not int or dep["relocation_row"] != row:
            raise ValueError("Symbolic rows must be consecutive and exact")
        self_row = dep.get("symbolic_self") is True
        if self_row != (row == 0):
            raise ValueError("Symbolic SELF must occupy row zero only")
        if not self_row and not NAME.fullmatch(str(dep.get("name", ""))):
            raise ValueError("Dependency requires its full declared dot-name")
        # A zero-permission Inform GT can identify a Thread/Namespace without
        # granting data or execution access. Preserve that declaration exactly;
        # destination binding below restricts it to structural objects.
        dep["rights"] = [] if dep.get("rights") == [] and not self_row else _rights(dep.get("rights"))
        if self_row and dep["rights"] != ["E"]:
            raise ValueError("SELF requires E only")
    sites = set()
    for call in calls:
        if not isinstance(call, dict):
            raise ValueError("Invalid symbolic CALL")
        row, offset = call.get("row"), call.get("word_offset")
        if type(row) is not int or not 0 <= row < min(32, len(deps)):
            raise ValueError("Symbolic CALL row is outside indexed CALL range")
        if type(offset) is not int or offset < 1 or offset in sites:
            raise ValueError("Symbolic CALL sites must be unique code words")
        if not NAME.fullmatch(str(call.get("full_name", ""))):
            raise ValueError("Symbolic CALL requires its exact full name")
        if type(call.get("condition")) is not int or not 0 <= call["condition"] <= 15:
            raise ValueError("Symbolic CALL requires exact condition")
        if "E" not in deps[row]["rights"]:
            raise ValueError("Symbolic CALL requires a declared E capability")
        sites.add(offset)
    if words is not None:
        cc_words = words[0] & 255
        cw = (words[0] >> 10) & 8191
        if cc_words != len(deps):
            raise ValueError("Symbolic C-list extent differs from bytes")
        # NULL plus the integrity-covered relocation is the pre-binding form.
        # Historical compiler bytes remain supported without rewriting evidence.
        for row in range(cc_words):
            allowed = {0, 0xFEED5E1F} if row == 0 else {0}
            if words[len(words) - cc_words + row] not in allowed:
                raise ValueError("Canonical symbolic C-list must remain unresolved")
        for call in calls:
            offset = call["word_offset"]
            if offset > cw or words[offset] != ((30 << 27) | (call["condition"] << 23)):
                raise ValueError("Symbolic CALL site is not an exact unresolved fault word")
    return out


def embedded(words):
    """Read the contract from the bytes, never from an untrusted sidecar."""
    api = embedded_api(words)
    contract = api.get("symbolic_binding")
    return validate(contract, words[0] & 255, words) if contract is not None else None


def embedded_api(words, expand=True):
    from server.lump_api import binding_view, reject_duplicate_keys
    cw, cc = (words[0] >> 10) & 8191, words[0] & 255
    pos = cw + 1
    if pos >= len(words) - cc or words[pos] >> 24 != 0xAB:
        return {}
    length = words[pos] & 65535
    count = (length + 3) // 4
    if not length or pos + 1 + count > len(words) - cc:
        raise ValueError("Invalid embedded API extent")
    raw = struct.pack(f">{count}I", *words[pos + 1:pos + 1 + count])[:length]
    api = json.loads(raw, object_pairs_hook=reject_duplicate_keys)
    return binding_view(api, words) if expand else api


def bind(words, contract, owner, targets):
    """Targets are exact, authenticated destination assignments from the caller.

    Unavailable/ambiguous references remain zero/INVALID_OP. Input words and
    canonical contracts are never mutated. No runtime lookup is needed.
    """
    from server.portable_binding import mint_gt
    contract = validate(contract, words[0] & 255, words)
    result = list(words)
    rows, calls = [], []
    start = len(words) - len(contract["dependencies"])

    def gt(target, rights):
        slot, sequence = target.get("slot"), target.get("seq")
        if type(slot) is not int or not 0 <= slot <= 65535 or type(sequence) is not int or not 0 <= sequence <= 511:
            raise ValueError("Destination slot and sequence must be exact")
        return mint_gt(sequence, slot, rights, 1)

    selected = {}
    for dep in contract["dependencies"]:
        row = dep["relocation_row"]
        matches = [owner] if dep["symbolic_self"] else [
            t for t in targets if t["name"] == dep["name"] and
            set(dep["rights"]).issubset(set(t.get("rights", []))) and
            (dep["rights"] or t.get("type") in ("Thread", "Namespace"))]
        if len(matches) == 1:
            target = selected[row] = matches[0]
            result[start + row] = gt(target, dep["rights"])
        rows.append({"index": row, "name": dep["name"],
                     "status": "bound" if row in selected else "unresolved",
                     "newGT": result[start + row] if row in selected else None})
    for call in contract["calls"]:
        row, full = call["row"], call["full_name"]
        dep = contract["dependencies"][row]
        authorized = contract["owner"] if dep["symbolic_self"] else dep["name"]
        choices = []
        for target in targets:
            if target["name"] != authorized or not set(dep["rights"]).issubset(set(target.get("rights", []))):
                continue
            if full == target["name"]:
                choices.append((target, 0))
            prefix = target["name"] + "."
            if full.startswith(prefix):
                method = full[len(prefix):]
                for entry in target.get("methods", []):
                    index = entry.get("index")
                    if (entry.get("name") == method and entry.get("visibility") != "private"
                            and type(index) is int and 0 <= index <= 126):
                        choices.append((target, index + 1))
        resolved = len(choices) == 1 and row in selected
        if resolved:
            target, selector = choices[0]
            if target["slot"] != selected[row]["slot"]:
                resolved = False
            else:
                result[call["word_offset"]] = ((2 << 27) | (call["condition"] << 23) |
                    (6 << 15) | (selector << 5) | row)
        calls.append({**call, "status": "bound" if resolved else "unresolved",
                      "object": choices[0][0]["name"] if resolved else None,
                      "method": full[len(choices[0][0]["name"]) + 1:] or None if resolved else None,
                      "methodSelector": choices[0][1] if resolved else None,
                      "reason": None if resolved else
                      "No unique authorized destination/method; HardFault only if referenced during execution."})
    return result, {"rows": rows, "calls": calls,
                    "status": "bound" if all(r["status"] == "bound" for r in rows + calls) else "unresolved"}
