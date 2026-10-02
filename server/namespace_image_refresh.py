"""Saved-only generic image reconstruction. No catalog, relocation or activation."""
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import tempfile
import time
import uuid

from server import boot_image as boot
from server.namespace_authority import validate_namespace_rows, namespace_fingerprint
from server.simulation_preparation import (
    artifact_bindings, _localize_portable, _validate_body,
    validate_simulator_resident_inventory,
)

PROFILE = "clean-saved-namespace-v1"


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def integer(value):
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        raise ValueError("Expected an explicit integer address or geometry")
    return int(value, 0) if isinstance(value, str) else value


def reconstruct(config, rows, directory):
    """Two independent passes: numeric slots, then every address including gaps."""
    validate_namespace_rows(rows)
    rows = sorted(copy.deepcopy(rows), key=lambda row: row["slot"])
    step = config["step1"]
    total, slots = integer(step["totalNamespaceWords"]), integer(step["nsSlotsMax"])
    # The header codec enforces the architecture's supported total/slot sizes.
    entry = boot.namespace_boot_marker_slot(rows)
    selected = {row["slot"]: row for row in rows}
    if 0 not in selected:
        raise ValueError("Saved Namespace must explicitly contain its NS[0] header")
    if any(row["slot"] >= slots for row in rows):
        raise ValueError("Saved slot exceeds configured Namespace capacity")
    # Thread is a body type, never an address/slot convention. Exact saved
    # bodies win; only explicitly saved body-less Thread rows use geometry.
    installed_rows = [row for row in rows if not row.get("symbolic") and not row.get("implementationMissing")]
    thread_rows = [row for row in installed_rows if row.get("type") == "Thread"]
    thread_slots = {row["slot"] for row in thread_rows}
    missing = [row for row in installed_rows
               if row["slot"] not in thread_slots
               and boot.image_artifact_selected(row) and not row.get("filename")]
    if missing:
        labels = ", ".join(f"NS[{row['slot']}] {row.get('name', '')}" for row in missing)
        raise ValueError(
            f"Saved Namespace assignments have no exact LUMP selected: {labels}. "
            "Assign an exact saved LUMP to each listed slot before refreshing. "
            "No catalog substitute or old-image body was used; stored image unchanged.")
    bindings = artifact_bindings([row for row in rows if row["slot"] not in thread_slots], directory)
    for row in thread_rows:
        if row.get("filename"):
            name, expected = row["filename"], row.get("binary_hash") or row.get("binaryHash")
            if not isinstance(name, str) or Path(name).name != name:
                raise ValueError(f"NS[{row['slot']}] requires an exact saved filename")
            raw = (Path(directory) / name).read_bytes()
            if not isinstance(expected, str) or sha(raw) != expected.lower():
                raise ValueError(f"NS[{row['slot']}] saved Thread hash mismatch")
            bindings.append(dict(slot=row["slot"], filename=name, binaryHash=sha(raw), token=row.get("token")))
    by_slot = {binding["slot"]: binding for binding in bindings}
    if entry not in by_slot:
        raise ValueError(f"Boot marker NS[{entry}] requires an exact selected executable")
    header = boot.encode_namespace_header(0, total, slots, integer(selected[entry]["location"]) * 4)
    table = total - slots * 4
    mem = [0] * total
    mem[:16] = header
    claims = [(0, 16, "Namespace header"), (table, total, "Namespace table")]
    results, derivatives = [], []
    entry_gt = boot.create_gt(integer(selected[entry]["seq"]), entry, {"E": 1}, 1)
    for row in rows:
        slot = row["slot"]
        label = f"NS[{slot}] {row.get('name', '')}"
        if row.get("archived"):
            raise ValueError(f"{label}: archived rows cannot be live assignments")
        if row.get("symbolic") or row.get("implementationMissing"):
            results.append(f"{label}: design-only; descriptor and body omitted")
            continue
        body, token = None, 0
        if slot == 0:
            location = integer(row["location"])
            if location != 0:
                raise ValueError("NS[0] must point to the architectural header at zero")
            kind = "Namespace header"
        elif slot in thread_slots and not row.get("filename"):
            location = integer(row["location"])
            thread_size = integer(row["allocationWords"] if "allocationWords" in row else step["threadLumpWords"])
            stack = integer(row.get("stackWords", step.get("threadStackWords", 32)))
            layout = boot.thread_layout(thread_size, stack)
            if not layout["valid"]:
                raise ValueError(f"{label}: configured Thread geometry is invalid")
            body = [0] * thread_size
            body[0] = boot.pack_lump_header(thread_size.bit_length() - 7, stack, boot.THREAD_CAP_WORDS, 2)
            sto = layout["stack_end"] - 2
            body[boot.THREAD_STO_OFFSET] = (1 << 12) | sto
            body[layout["caps_start"]] = entry_gt
            body[sto + 1] = entry_gt
            body[sto + 2] = (0x7FFF << 13) | (1 << 12) | layout["stack_end"]
            kind = "Generated Thread"
        elif slot in boot._MMIO_SLOT_SPECS and not row.get("filename"):
            location = integer(row["location"])
            if (location, integer(row["limit"])) != boot._MMIO_SLOT_SPECS[slot]:
                raise ValueError(f"{label}: MMIO address/limit differs from architecture")
            kind = "MMIO; no ordinary RAM body"
        elif slot in by_slot:
            binding = by_slot[slot]
            path = Path(directory) / binding["filename"]
            if path.is_symlink():
                raise ValueError(f"{label}: mutable artifact alias is not an exact saved file")
            raw = path.read_bytes()
            if sha(raw) != binding["binaryHash"]:
                raise ValueError(f"{label}: selected bytes changed during reconstruction")
            if "portableBinding" in binding:
                raw, token = _localize_portable(raw, binding, rows, bindings, directory)
            body = _validate_body(raw)
            if (body[0] >> 8) & 3 == 2:
                thread_slots.add(slot)
            if slot == entry or slot not in thread_slots:
                _validate_body(raw, executable=True)
            cc = body[0] & 255
            if slot in thread_slots:
                if (body[0] >> 8) & 3 != 2:
                    raise ValueError(f"{label}: saved Thread body has a different header type")
            else:
                token = boot.create_gt(integer(row["seq"]), slot, {"E": 1}, 1)
                if not cc or body[-cc] != token:
                    raise ValueError(f"{label}: immutable SELF differs from destination GT")
            location = integer(row["location"])
            kind = binding["filename"]
            derivatives.append(dict(binding, derivativeHash=sha(raw), localSelfGT=f"{token:08x}"))
        else:
            results.append(f"{label}: unselected/design-only; descriptor and body omitted")
            continue
        seq, limit = integer(row["seq"]), integer(row["limit"])
        g, f = integer(row.get("g", 0)), integer(row.get("f", 0))
        if not 0 <= seq <= 511 or not 0 <= limit <= 0x1FFFFF or g not in (0, 1) or f != 0:
            raise ValueError(f"{label}: invalid sequence, limit, G or F (free) descriptor")
        if body is not None:
            end = location + len(body)
            if location < 16 or end > table:
                raise ValueError(f"{label}: complete allocation [0x{location:X},0x{end:X}) is outside body RAM")
            claims.append((location, end, label))
            mem[location:end] = body
        boot.write_ns_entry(mem, total, 4, slot, location, limit, 0, g, 1, seq, 0, token)
        results.append(f"{label}: {kind}; word 0x{location:X}" +
                       (f"–0x{location + len(body) - 1:X}; {len(body)} words" if body else ""))
    # Do not use the order above to infer placement, and never trust access limits
    # as allocation sizes. Check complete ownership independently in address order.
    ordered = sorted(claims)
    cursor, gaps = 0, []
    for start, end, label in ordered:
        if start < cursor:
            raise ValueError(f"{label}: allocation overlaps an earlier address range at 0x{start:X}")
        if any(mem[cursor:start]):
            raise ValueError(f"Unowned nonzero memory at/after word 0x{cursor:X}")
        if start > cursor:
            gaps.append((cursor, start))
        cursor = end
    if cursor != total:
        raise ValueError("Address coverage did not reach the image boundary")
    for slot in range(slots):
        if slot not in selected or not any(line.startswith(f"NS[{slot}] ") and "omitted" not in line for line in results):
            base = total - (slot + 1) * 4
            if any(mem[base:base + 4]):
                raise ValueError(f"Removed/unselected NS[{slot}] retained a descriptor")
    image = struct.pack(f"<{total}I", *mem)
    boot.validate_boot_image(image, saved_namespace_only=True)
    validate_simulator_resident_inventory(image)
    return image, {
        "purpose": "generic-simulator-image", "profile": PROFILE, "hardwareCertified": False,
        "namespace_fingerprint": namespace_fingerprint(rows),
        "image_sha256": sha(image), "bootEntrySlot": entry,
        "artifactBindings": derivatives,
        "stages": ["Frozen saved Namespace/configuration and exact artifacts",
                   "Reconstructed numeric slots from zero-initialized memory",
                   "Validated complete allocations independently in address order",
                   "Validated generic simulator structures (not hardware certification)"],
        "slotResults": results,
        "addressResults": [f"0x{a:X}–0x{b-1:X}: {name}" for a, b, name in ordered] +
                          [f"0x{a:X}–0x{b-1:X}: verified zero, unclaimed" for a, b in gaps],
    }


def atomic(path, raw):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(dir=path.parent, prefix=".refresh-")
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
        sync_directory(path.parent)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def sync_directory(path):
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def json_bytes(value):
    return json.dumps(value, sort_keys=True, indent=2).encode()


class RefreshStore:
    """Caller holds Namespace + library locks. Journal recovery is rollback-only
    until the durable commit marker; only these two outputs ever change."""
    def __init__(self, directory, state_path, config_path):
        self.directory = Path(directory)
        self.root = self.directory / ".image-refresh"
        self.state_path, self.config_path = Path(state_path), Path(config_path)

    def inputs(self):
        # Freeze exact files, including admission evidence. Catalog bytes can
        # invalidate review but never select membership or provide bodies.
        paths = [self.state_path, self.config_path]
        paths += sorted(p for p in self.directory.iterdir()
                        if p.suffix in (".lump", ".json", ".bin")
                        and not p.name.startswith("."))
        return {str(p): sha(p.read_bytes()) for p in paths if p.is_file()}

    def prepare(self, owner):
        before = self.inputs()
        rows = json.loads(self.state_path.read_bytes())["abstractions"]
        cfg = json.loads(self.config_path.read_bytes())
        image, evidence = reconstruct(cfg, rows, self.directory)
        evidence["namespace_fingerprint"] = namespace_fingerprint(rows)
        evidence["origin"] = "generic-refresh"
        evidence["sourceInputs"] = {
            path: digest for path, digest in before.items()
            if Path(path).name not in ("boot-image.bin", "boot-image.provenance.json")}
        if self.inputs() != before:
            raise ValueError("Saved inputs changed during reconstruction; prepare a fresh review")
        key = uuid.uuid4().hex
        record = dict(evidence, operationId=key, owner=owner, inputs=before,
                      expires=time.time() + 1800, status="prepared", committed=False)
        atomic(self.root / key / "image.bin", image)
        atomic(self.root / key / "record.json", json_bytes(record))
        return self.public(record)

    def read(self, key, owner):
        if not isinstance(key, str) or not re.fullmatch("[0-9a-f]{32}", key):
            raise ValueError("Invalid refresh operation identity")
        path = self.root / key / "record.json"
        if not path.is_file():
            raise ValueError("Refresh operation not found; no publication is recorded")
        record = json.loads(path.read_bytes())
        if record["owner"] != owner:
            raise ValueError("Refresh operation belongs to another session")
        return record

    def status(self, key, owner):
        record = self.read(key, owner)
        # A delayed commit request must not publish after status has told the
        # browser that nothing committed. Resolve the ticket under the same lock.
        if record["status"] == "prepared":
            record["status"] = "cancelled"
            atomic(self.root / key / "record.json", json_bytes(record))
        return self.public(record)

    def reviewed(self, key, owner):
        record = self.read(key, owner)
        if record["status"] != "prepared" or record["expires"] <= time.time():
            raise ValueError("Refresh review expired or already resolved; check commit status")
        if self.inputs() != record["inputs"]:
            raise ValueError("Saved Namespace, configuration, artifact or image changed; fresh review required")
        image = (self.root / key / "image.bin").read_bytes()
        if sha(image) != record["image_sha256"]:
            raise ValueError("Staged image hash differs from review")
        return record, image

    def public(self, record):
        return {k: v for k, v in record.items() if k not in ("owner", "inputs", "expires")}

    def commit(self, key, owner):
        record, image = self.reviewed(key, owner)
        evidence = self.public(record)
        evidence.update(status="committed", committed=True)
        outputs = {"boot-image.bin": image,
                   "boot-image.provenance.json": json_bytes(evidence)}
        journal = {"operationId": key, "phase": "pending", "previous": {}}
        for name in outputs:
            path = self.directory / name
            journal["previous"][name] = path.exists()
            if path.exists():
                atomic(self.root / key / (name + ".before"), path.read_bytes())
        atomic(self.root / "journal.json", json_bytes(journal))
        try:
            for name, raw in outputs.items():
                atomic(self.directory / name, raw)
            journal["phase"] = "committed"
            atomic(self.root / "journal.json", json_bytes(journal))
        except Exception:
            self.recover()
            raise
        self.recover()
        return self.public(self.read(key, owner))

    def recover(self):
        path = self.root / "journal.json"
        if not path.exists():
            return
        journal = json.loads(path.read_bytes())
        key = journal["operationId"]
        if not re.fullmatch("[0-9a-f]{32}", key):
            raise ValueError("Refresh journal is invalid; publication blocked")
        committed = journal["phase"] == "committed"
        if not committed:
            for name in ("boot-image.bin", "boot-image.provenance.json"):
                target = self.directory / name
                if journal["previous"][name]:
                    atomic(target, (self.root / key / (name + ".before")).read_bytes())
                elif target.exists():
                    target.unlink()
            sync_directory(self.directory)
        record_path = self.root / key / "record.json"
        record = json.loads(record_path.read_bytes())
        record.update(status="committed" if committed else "rolled_back", committed=committed)
        atomic(record_path, json_bytes(record))
        path.unlink()
        sync_directory(self.root)