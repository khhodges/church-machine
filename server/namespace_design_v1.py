"""Editable ascending Namespace design. Never publishes executable image bytes."""
import copy
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import struct
import tempfile
from server.binding_cleanup import serialized

FORMAT = "ascending-nst-metadata-slot0-v1"
PHASE1_FORMAT = "phase1-nst-metadata-slot0-v1"
PINS = [
    (7, "WukongCallHome", "WukongCallHome.1.7084172e.lump",
     "549aa4138bf722b48c2ff304ec628af0139d70685ea99e66dfb3200ad0055738", 20, "232f0de4"),
    (10, "CapabilityTest", "CapabilityTest.1.1feaf30b.lump",
     "e41b861a87a13066e4a7cb76e5a01d39c62857bfddfffc5e3f2ffdcb12dd8c21", 45, "17fc5571"),
]


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def validate_authoring(target, kind):
    """Authoring is design intent, independent of artifact placement/admission.

    A source may be unfinished or not yet created. Never resolve by pet name or
    consult a catalog here, and never add associations while reading saved rows.
    """
    if not isinstance(target, dict):
        raise ValueError("Invalid Namespace authoring target")
    target_kind = target.get("kind")
    if target_kind == "source":
        path = target.get("path")
        if (set(target) != {"kind", "path"} or kind != "lump" or
                not isinstance(path, str) or len(path) > 512 or
                not re.fullmatch(r"simulator/(?:[A-Za-z0-9_-][A-Za-z0-9_.-]*/)*[A-Za-z0-9_-][A-Za-z0-9_.-]*\.cloomc", path)):
            raise ValueError("Authoring source must be a local simulator/*.cloomc path on a LUMP row")
    elif target_kind in ("assigned-artifact", "namespace-table", "entry"):
        if set(target) != {"kind"}:
            raise ValueError("Unexpected Namespace authoring target fields")
        if target_kind == "assigned-artifact" and kind != "lump":
            raise ValueError("Only LUMP rows can target an assigned artifact")
        if target_kind == "namespace-table" and kind not in ("namespace", "lump"):
            raise ValueError("Namespace table target requires a Namespace or LUMP row")
    else:
        raise ValueError("Unknown Namespace authoring target kind")


def seed(legacy):
    rows = [
        dict(slot=1, name="Boot.NS", kind="namespace", policy="Resident", sequence=0),
        dict(slot=2, name="Boot.Thread", kind="thread", policy="Resident", sequence=0, words=256),
    ]
    for slot, name, filename, binary_hash, revision, token in PINS:
        rows.append(dict(slot=slot, name=name, kind="lump", policy="Resident", sequence=0,
                         selection=dict(filename=filename, binaryHash=binary_hash,
                                        token=token, revision=revision),
                         boot=slot == 10))
    for slot, name in [(11, "Thread.2"), (12, "Thread.3")]:
        rows.append(dict(slot=slot, name=name, kind="thread", policy="Resident", sequence=0, words=256))
    for slot, name, address, limit, seq in [
        (3, "LED_DEV", 0x40000000, 4, 0), (4, "BTN_DEV", 0x40000028, 0, 0),
        (5, "TIMER_DEV", 0x4000002c, 4, 0), (8, "UART_DEV", 0x40000014, 2, 1),
        (13, "M_BIT_DEV", 0xffffff1c, 0, 0),
    ]:
        rows.append(dict(slot=slot, name=name, kind="mmio", policy="Hardware",
                         sequence=seq, address=address, limit=limit))
    # Associations are explicit data in a new design, not a navigation lookup.
    for row in rows:
        row["authoring"] = dict(kind="assigned-artifact" if row["kind"] == "lump"
                               else "namespace-table" if row["kind"] == "namespace" else "entry")
    # Carry existing non-core design membership, never silently discard it.
    names = {r["name"] for r in rows}
    used = {r["slot"] for r in rows}
    for old in legacy.get("abstractions", []):
        # Historical demo membership must not silently reintroduce SelfTest
        # into a newly generated design. Explicit persisted designs are read
        # unchanged; a programmer may still deliberately add this artifact.
        if old["name"] == "SelfTest":
            continue
        if old["name"] in names:
            continue
        slot = old["slot"]
        if slot < 3 or slot in used:
            raise ValueError(f"Saved design member {old['name']} conflicts with new slot {slot}; resolve explicitly")
        selection = copy.deepcopy(old.get("selection"))
        if not selection and old.get("filename") and old.get("binary_hash"):
            selection = dict(filename=old["filename"], binaryHash=old["binary_hash"],
                             token=old.get("token", ""), revision=old.get("lump_version"))
        row = dict(slot=slot, name=old["name"], kind="lump", policy="Lazy",
                   sequence=old.get("seq", 0))
        if selection:
            row["selection"] = selection
        rows.append(row)
        used.add(slot)
        names.add(old["name"])
    return dict(format=FORMAT, capacityWords=16384, slotCount=64,
                outputProfile="api", rows=sorted(rows, key=lambda r: r["slot"]))


def phase1_seed():
    document = seed({})
    document.update(format=PHASE1_FORMAT, slotCount=256)
    for slot, name in [(9, "ide.Mint"), (14, "nstab"), (15, "pkverify"),
                       (16, "ide.Alice"), (17, "ide.Mallory")]:
        document["rows"].append(dict(slot=slot, name=name, kind="lump",
                                     policy="Resident", sequence=0))
    sources = {
        7: "simulator/examples/wukong_callhome.cloomc",
        9: "simulator/cloomc/mint.cloomc",
        10: "simulator/examples/capability_test.cloomc",
        16: "simulator/examples/alice.cloomc",
        17: "simulator/examples/mallory.cloomc",
    }
    for row in document["rows"]:
        if row["slot"] in sources:
            row["authoring"] = dict(kind="source", path=sources[row["slot"]])
        elif row["slot"] == 14:
            row["authoring"] = dict(kind="namespace-table")
    document["rows"].sort(key=lambda row: row["slot"])
    return document


def validate(document):
    if not isinstance(document, dict) or set(document) - {"faultHandlerSlot"} != {
        "format", "capacityWords", "slotCount", "outputProfile", "rows"
    }:
        raise ValueError("Expected a complete Namespace design")
    count = document["slotCount"]
    phase1 = document["format"] == PHASE1_FORMAT
    if (document["format"] not in (FORMAT, PHASE1_FORMAT) or
            document["capacityWords"] != 16384 or document["outputProfile"] != "api" or
            type(count) is not int or
            (not phase1 and count != 64) or (phase1 and not 16 <= count <= 4096)):
        raise ValueError("Expected ascending-v1 with 64 slots or Phase 1 with 16–4096 slots, 16384 words and API-only output")
    rows = document["rows"]
    if not isinstance(rows, list) or len(rows) > count - 1:
        raise ValueError("Invalid Namespace member count")
    slots, names = set(), set()
    for row in rows:
        if not isinstance(row, dict) or set(row) - {
            "slot", "name", "kind", "policy", "sequence", "selection", "boot",
            "words", "address", "limit", "authoring", "preparedThread",
        }:
            raise ValueError("Unexpected Namespace row fields")
        slot, name = row.get("slot"), row.get("name")
        if type(slot) is not int or not 1 <= slot < count or slot in slots:
            raise ValueError(f"Choose a unique slot from 1 to {count - 1}; slot 0 is metadata")
        if not isinstance(name, str) or not name.strip() or name != name.strip() or len(name) > 128 or re.search(r"[\x00-\x1f\x7f]", name) or name in names:
            raise ValueError("Each row requires a unique, nonempty pet name")
        slots.add(slot)
        names.add(name)
        if type(row.get("sequence")) is not int or not 0 <= row["sequence"] <= 511:
            raise ValueError("Invalid Namespace generation")
        kind = row.get("kind")
        if kind not in ("namespace", "thread", "mmio", "lump"):
            raise ValueError("Invalid member kind")
        if "authoring" in row:
            validate_authoring(row["authoring"], kind)
        if row.get("policy") not in ("Resident", "Lazy", "Hardware"):
            raise ValueError("Invalid load policy")
        if kind != "lump" and row["policy"] != ("Hardware" if kind == "mmio" else "Resident"):
            raise ValueError("Architectural objects retain their residency")
        if kind == "thread" and row.get("words") != 256:
            raise ValueError("Thread design allocation must remain 256 words")
        if "preparedThread" in row:
            binding = row["preparedThread"]
            if (kind != "thread" or slot == 2 or not isinstance(binding, dict)
                    or not {"entrySlot", "actorSlot"}.issubset(binding)
                    or set(binding) - {"entrySlot", "actorSlot", "entryNia"}
                    or any(type(binding[k]) is not int for k in binding)):
                raise ValueError("Prepared Thread requires explicit driver and actor slots on a non-entry Thread")
            if "entryNia" in binding and not 0 <= binding["entryNia"] < 0x7fff:
                raise ValueError("Prepared Thread entry NIA must be 0–32766")
        if kind == "mmio":
            if any(type(row.get(k)) is not int or not 0 <= row[k] <= 0xffffffff for k in ("address", "limit")):
                raise ValueError("Invalid MMIO address/limit")
        if kind == "namespace" and slot != 1:
            raise ValueError("Namespace self belongs at slot 1")
        if "boot" in row and (type(row["boot"]) is not bool or row["boot"] and kind != "lump"):
            raise ValueError("Only an executable design member may be the boot target")
        selected = row.get("selection")
        if selected is not None:
            if not isinstance(selected, dict):
                raise ValueError("Invalid saved artifact selection")
            filename = selected.get("filename")
            if filename is not None and (not isinstance(filename, str) or not re.fullmatch(r"[^/\\]+\.lump", filename) or ".." in filename):
                raise ValueError("Selection filename must be a local LUMP basename")
            for field, width in (("binaryHash", 64), ("token", 8)):
                value = selected.get(field)
                if value and (not isinstance(value, str) or not re.fullmatch(rf"[0-9a-fA-F]{{{width}}}", value)):
                    raise ValueError(f"Invalid selection {field}")
    by_slot = {r["slot"]: r for r in rows}
    if "faultHandlerSlot" in document:
        handler_slot = document["faultHandlerSlot"]
        handler = by_slot.get(handler_slot, {}) if type(handler_slot) is int else {}
        if (handler.get("kind") != "lump" or handler.get("policy") != "Resident"
                or not handler.get("selection")):
            raise ValueError("Saved fault handler must select an exact Resident LUMP")
    for row in rows:
        binding = row.get("preparedThread", {})
        for slot in (binding[key] for key in ("entrySlot", "actorSlot") if key in binding):
            target = by_slot.get(slot, {})
            if target.get("kind") != "lump":
                raise ValueError("Prepared Thread driver and actor must name declared LUMP rows")
            if "entryNia" in binding and (target.get("policy") != "Resident" or not target.get("selection")):
                raise ValueError("Fresh startup Thread requires selected Resident entry and application LUMPs")
    if (by_slot.get(1, {}).get("name"), by_slot.get(1, {}).get("kind"),
        by_slot.get(2, {}).get("name"), by_slot.get(2, {}).get("kind"),
        by_slot.get(2, {}).get("sequence")) != ("Boot.NS", "namespace", "Boot.Thread", "thread", 0):
        raise ValueError("Slot 1 must be Namespace self; slot 2 must be entry Thread version 0")
    if sum(bool(r.get("boot")) for r in rows) != 1:
        raise ValueError("Keep exactly one selected boot target")
    return document


def api_size(row, lumps):
    selection = row.get("selection") or {}
    filename, expected = selection.get("filename"), selection.get("binaryHash")
    if not filename or not expected:
        raise ValueError("Unfinished/unresolved LUMP — no exact saved binary selected")
    path = lumps / filename
    if path.is_symlink():
        raise ValueError("Selected artifact must not be a symlink")
    raw = path.read_bytes()
    if hashlib.sha256(raw).hexdigest() != expected:
        raise ValueError("Selected binary hash has changed")
    if not raw or len(raw) % 4:
        raise ValueError("Invalid binary length")
    words = struct.unpack(f">{len(raw)//4}I", raw)
    header = words[0]
    cw, cc = (header >> 10) & 8191, header & 255
    if header >> 27 != 31 or len(words) != 64 << ((header >> 23) & 15) or cw + 2 >= len(words):
        raise ValueError("Invalid LUMP header")
    frame = words[cw+1]
    length = frame & 65535
    if frame >> 24 != 0xAB or not length or cw+2+math.ceil(length/4) > len(words)-cc:
        raise ValueError("Invalid embedded API frame")
    api = json.loads(raw[(cw+2)*4:(cw+2)*4+length])
    needed = cw + cc + 2 + math.ceil(length/4)
    allocation = max(64, 1 << (needed-1).bit_length())
    warning = None if api.get("name") == row["name"] else (
        f"Embedded API names {api.get('name')}, not {row['name']}. "
        "Declare the intended abstraction in source, compile and approve Save LUMP as a new revision, "
        "then select that exact revision. Historical bytes must remain unchanged.")
    return allocation, warning


def project(document, lumps):
    validate(document)
    rows, cursor, warnings = [], 4 * document["slotCount"], []
    # Keep the reviewed resident order, then place added residents by slot.
    order = {slot: index for index, slot in enumerate([1, 2, 7, 10, 6, 11, 12])}
    for original in sorted(document["rows"], key=lambda r: (order.get(r["slot"], 100+r["slot"]))):
        row = copy.deepcopy(original)
        row["entryWord"] = row["slot"] * 4
        row["allocationWords"] = 0
        row["location"] = None
        if row["kind"] == "namespace":
            row.update(location=0, limit=4 * document["slotCount"] - 1)
        elif row["kind"] == "mmio":
            row["location"] = row["address"]
        elif row["kind"] == "thread":
            row["allocationWords"] = row["words"]
        elif row["policy"] == "Resident":
            try:
                row["allocationWords"], warning = api_size(row, lumps)
                if warning:
                    warnings.append(f"{row['name']}: {warning}")
            except (OSError, ValueError, KeyError, IndexError, struct.error) as exc:
                warnings.append(f"{row['name']}: {exc}")
                row["unresolved"] = True
                cursor = None
        if row["allocationWords"]:
            row["location"] = cursor
            row["limit"] = row["allocationWords"] - 1
            if cursor is not None:
                cursor += row["allocationWords"]
        rows.append(row)
    if cursor is not None and cursor > document["capacityWords"]:
        warnings.append("Resident allocations exceed Namespace capacity; design remains editable")
    header = ((31 << 27) | ((14-13) << 23) | (document["slotCount"] << 10) | (1 << 8))
    return dict(rows=sorted(rows, key=lambda r: r["slot"]),
                metadataWords=[header, 0, len(rows)-1, 0], tableWords=4 * document["slotCount"],
                usedWords=cursor, warnings=warnings, activationAllowed=False,
                buildReady=False, addressesAreProposed=True,
                privateSimulationAdmission="exact-saved-design",
                privateSimulationNote="Private simulation has a separate compiler-authenticated admission path. "
                    "Candidate approval does not authorize activation, installation or hardware.")


class DesignStore:
    def __init__(self, path, lumps, legacy_path, phase1=False):
        self.path, self.lumps, self.legacy_path = Path(path), Path(lumps), Path(legacy_path)
        self.phase1 = phase1

    def validate_profile(self, document):
        validate(document)
        if document["format"] != (PHASE1_FORMAT if self.phase1 else FORMAT):
            raise ValueError("Design profile does not match the selected view")
        return document

    def read_document(self):
        if self.path.exists():
            return self.validate_profile(json.loads(self.path.read_text()))
        if self.phase1:
            return self.validate_profile(phase1_seed())
        legacy = json.loads(self.legacy_path.read_text())
        return validate(seed(legacy))

    def response(self, document):
        return dict(ok=True, document=document, fingerprint=digest(document),
                    persisted=self.path.exists(), projection=project(document, self.lumps))

    def read(self, binding_preview=False):
        document = self.read_document()
        response = self.response(document)
        if binding_preview:
            from server.namespace_binding_report import binding_report
            response["bindingReport"] = binding_report(
                document, self.lumps, response["fingerprint"], bind_now=False)
        return response

    @serialized("self")
    def save(self, payload, *, progress=None):
        if (not isinstance(payload, dict) or
                not {"fingerprint", "document"}.issubset(payload) or
                set(payload) - {"fingerprint", "document", "bind"}):
            raise ValueError("Expected reviewed fingerprint and design")
        bind_now = payload.get("bind", False)
        if type(bind_now) is not bool:
            raise ValueError("bind must be an explicit boolean")
        document = self.validate_profile(copy.deepcopy(payload["document"]))
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with open(str(self.path)+".lock", "a") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            if payload["fingerprint"] != digest(self.read_document()):
                raise ValueError("Namespace design changed in another tab. Draft retained; reload before retrying")
            # All validation precedes the atomic save. Projection is advisory;
            # missing unfinished implementations do not prohibit design saves.
            response = self.response(document)
            from server.namespace_binding_report import binding_report
            if bind_now:
                response["bindingReport"] = binding_report(
                    document, self.lumps, response["fingerprint"], bind_now=True,
                    **({"progress": progress} if progress else {}))
            response["bindingRequested"] = bind_now
            fd, temporary = tempfile.mkstemp(dir=self.path.parent, prefix=".namespace-design-")
            try:
                with os.fdopen(fd, "w") as out:
                    json.dump(document, out, indent=2)
                    out.flush()
                    os.fsync(out.fileno())
                os.replace(temporary, self.path)
            finally:
                if os.path.exists(temporary):
                    os.unlink(temporary)
            response["persisted"] = True
            return response
