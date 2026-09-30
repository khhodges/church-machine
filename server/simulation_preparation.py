"""Ephemeral, exact-configuration simulation consent, separate from publication."""
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import tempfile
import threading
import time
import uuid

from server.lump_integrity import parse_canonical_filename


def digest(value):
    return hashlib.sha256(json.dumps(
        value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def artifact_bindings(rows, directory):
    """Verify exact saved locators, not manifest history or latest versions."""
    from server.boot_image import _MMIO_SLOT_SPECS, generated_thread_label
    generated = {0, 1, *_MMIO_SLOT_SPECS}
    bindings = []
    for row in rows:
        filename = row.get("filename")
        if not filename:
            is_thread = (row.get("slot", -1) >= 11
                         and row.get("name") == generated_thread_label(row["slot"]))
            if (row.get("slot") not in generated and not is_thread
                    and row.get("type") in ("Inform", "Resident")
                    and row.get("symbolic") is not True):
                raise ValueError(f"NS[{row['slot']}] requires an exact saved artifact")
            continue
        if row.get("type") not in ("Inform", "Resident"):
            raise ValueError(
                f"NS[{row['slot']}] artifact-bound {row.get('type')!r} rows are "
                "not supported by simulation preparation. Select an executable "
                "Inform/Resident artifact, or remove this unsupported assignment "
                "from the saved Namespace before preparing.")
        expected = row.get("binary_hash") or row.get("binaryHash")
        token = row.get("token") or row.get("cache_token")
        if (not isinstance(filename, str) or os.path.basename(filename) != filename
                or parse_canonical_filename(filename) is None
                or not isinstance(expected, str)
                or not re.fullmatch(r"[0-9a-fA-F]{64}", expected)
                or not isinstance(token, str)
                or not re.fullmatch(r"[0-9a-fA-F]{8}", token)):
            raise ValueError(f"NS[{row['slot']}] has an invalid immutable artifact binding")
        raw = (Path(directory) / filename).read_bytes()
        if hashlib.sha256(raw).hexdigest() != expected.lower():
            raise ValueError(f"NS[{row['slot']}] saved artifact hash mismatch")
        _validate_body(raw)
        bindings.append({"slot": row["slot"], "filename": filename,
                         "token": token, "binaryHash": expected.lower()})
    return bindings


def _validate_body(raw, executable=False):
    if not raw or len(raw) % 4:
        raise ValueError("Simulation artifact must contain whole big-endian words")
    words = list(struct.unpack(f">{len(raw) // 4}I", raw))
    header = words[0]
    allocation = 1 << (((header >> 23) & 15) + 6)
    cw, cc, typ = (header >> 10) & 8191, header & 255, (header >> 8) & 3
    if header >> 27 != 31 or allocation != len(words) or 1 + cw + cc > allocation:
        raise ValueError("Simulation artifact has an invalid header/allocation")
    if executable and (typ != 0 or not cw):
        raise ValueError("Simulation target is not structurally executable")
    if executable:
        for word in words[1:1 + cw]:
            if (((word >> 27) & 31) in (0, 1, 8, 9)
                    and ((word >> 15) & 15) == 6 and (word & 31) >= cc):
                raise ValueError("Simulation executable has an unresolved c-list reference")
    return words


def validate_simulation_executable(path, lumps_dir, label, bootstrap_binding=None):
    with open(Path(lumps_dir) / "ns-state.json", encoding="utf-8") as source:
        rows = json.load(source)["abstractions"]
    matches = [row for row in rows if row.get("filename") == os.path.basename(path)]
    if not matches:
        raise ValueError(f"{label}: executable is not in the frozen Namespace")
    artifact_bindings(matches, lumps_dir)
    words = _validate_body(Path(path).read_bytes(), executable=True)
    cc = words[0] & 255
    if cc < 1:
        raise ValueError(f"{label}: simulator resident requires a complete SELF row 0")
    for row in matches:
        sequence = row.get("seq")
        if type(sequence) is not int or not 0 <= sequence <= 511:
            raise ValueError(f"{label}: simulator resident has an invalid sequence")
        expected = 0x4A000000 | (sequence << 16) | row["slot"]
        if words[len(words) - cc] != expected:
            raise ValueError(f"{label}: immutable SELF row 0 differs from owning Namespace GT")
        if int(row.get("token") or row.get("cache_token"), 16) != expected:
            raise ValueError(f"{label}: Namespace token must bind descriptor W3 to the full SELF GT")
    return words


def validate_simulator_resident_inventory(image):
    """Match ChurchSimulator._bootstrapResidentInventory on actual image words.

    This is an image admission check, not hardware/compiler certification.
    Check every physical type-0 descriptor, including generator-created ones,
    rather than trusting resident flags or just the selected boot-entry row.
    """
    from server.boot_image import read_namespace_header_info, _ns_word1_get
    physical = read_namespace_header_info(image)
    words = struct.unpack(f"<{len(image) // 4}I", image)
    table_base = physical["table_offset_words"]
    for slot in range(physical["slot_count"]):
        offset = len(words) - (slot + 1) * 4
        location, authority, _, token = words[offset:offset + 4]
        if location + 1 >= table_base:
            continue
        header = words[location]
        if header >> 27 != 31 or ((header >> 8) & 3) != 0:
            continue
        size, cc = 1 << (((header >> 23) & 15) + 6), header & 255
        if cc < 1 or location + size > table_base:
            raise ValueError(f"NS[{slot}] simulator resident has no complete SELF row 0")
        expected = 0x4A000000 | (_ns_word1_get(authority, "gt_seq") << 16) | slot
        if words[location + size - cc] != expected:
            raise ValueError(f"NS[{slot}] simulator resident SELF row 0 does not match its descriptor")
        if token != expected:
            raise ValueError(f"NS[{slot}] simulator resident descriptor W3 does not match its SELF GT")


def stage_image(cfg, rows, directory, entry_slot):
    """Copy only selected bytes; the generator never sees mutable library history."""
    from server import boot_image
    from server.namespace_authority import validate_namespace_rows
    validate_namespace_rows(rows)
    bindings = artifact_bindings(rows, directory)
    prepared = copy.deepcopy(rows)
    cfg = copy.deepcopy(cfg)
    # Old Step-2 selectors are a hardware/UI compatibility projection, not
    # authority. The private simulator uses only frozen Namespace rows.
    cfg["step2"] = {"lumps": []}
    for row in prepared:
        if row.get("filename") and row.get("type") in ("Inform", "Resident"):
            # No runtime catalog/lazy substitution after activation. All
            # selected executable bodies belong to this private image.
            row.update(resident=True, boot_resident=True, load_policy="Resident")
    with tempfile.TemporaryDirectory(prefix="simulation-private-") as private:
        stage = Path(private)
        for binding in bindings:
            raw = (Path(directory) / binding["filename"]).read_bytes()
            if hashlib.sha256(raw).hexdigest() != binding["binaryHash"]:
                raise ValueError("Artifact changed while staging simulation")
            (stage / binding["filename"]).write_bytes(raw)
        (stage / "ns-state.json").write_text(json.dumps({"abstractions": prepared}))
        (stage / "manifest.json").write_text("[]")
        (stage / "approvals.json").write_text(
            '{"version":1,"algorithm":"sha256","approvals":{}}')
        image = boot_image.generate_simulation_image(cfg, private, entry_slot)
        boot_image.validate_boot_image(image)
        validate_simulator_resident_inventory(image)
        # The generator's resident inventory validates what exists, not that
        # every frozen assignment was included. Prove the reverse direction
        # too: every reviewed binding must own a real descriptor and its exact
        # immutable body in the resulting image.
        physical = boot_image.read_namespace_header_info(image)
        image_words = struct.unpack(f"<{len(image) // 4}I", image)
        for binding in bindings:
            slot = binding["slot"]
            if not 0 <= slot < physical["slot_count"]:
                raise ValueError(f"NS[{slot}] frozen artifact has no physical simulation descriptor")
            offset = len(image_words) - (slot + 1) * 4
            location, authority, _, token = image_words[offset:offset + 4]
            raw = (stage / binding["filename"]).read_bytes()
            expected_words = struct.unpack(f">{len(raw) // 4}I", raw)
            if (not authority or location + len(expected_words) > physical["table_offset_words"]
                    or token != int(binding["token"], 16)
                    or image_words[location:location + len(expected_words)] != expected_words):
                raise ValueError(
                    f"NS[{slot}] frozen artifact is missing or differs from its "
                    "physical simulation descriptor/body; no preparation was created")
    words = struct.unpack(f"<{len(image) // 4}I", image)
    for row in prepared:
        offset = len(words) - (row["slot"] + 1) * 4
        if offset < 0:
            raise ValueError("Prepared descriptor is outside the image")
        location, authority, seal, _ = words[offset:offset + 4]
        if location or authority:
            row.update(location=f"0x{location:08X}", limit=f"0x{authority & 0x1FFFFF:05X}",
                       seq=(authority >> 21) & 511, g=(authority >> 30) & 1,
                       f=(authority >> 31) & 1, seal=f"0x{seal:08X}")
    return image, prepared, bindings


class PreparationStore:
    """Bounded process-private store. Restart/expiry requires fresh consent."""
    def __init__(self, ttl=1800, capacity=32):
        self.records = {}
        self.lock = threading.RLock()
        self.ttl, self.capacity = ttl, capacity

    def prepare(self, rows, cfg, directory, entry_slot, stage=stage_image):
        with self.lock:
            now = time.monotonic()
            self.records = {key: value for key, value in self.records.items()
                            if value["expires"] > now}
            if len(self.records) >= self.capacity:
                raise ValueError("Too many simulation preparations; retry after expiry")
            source = copy.deepcopy(rows)
            image, prepared, bindings = stage(copy.deepcopy(cfg), copy.deepcopy(source),
                                              directory, entry_slot)
            changes = [{"slot": row["slot"], "before": before, "after": row}
                       for before, row in zip(source, prepared) if before != row]
            provenance = {
                "preparationId": uuid.uuid4().hex,
                "sourceNamespaceFingerprint": digest(source),
                "preparedRows": prepared, "layoutChanges": changes,
                "artifactBindings": bindings, "hardwareCertified": False,
                "approvalRequired": True, "bootEntrySlot": entry_slot,
                "imageHash": hashlib.sha256(image).hexdigest(),
            }
            provenance["configurationHash"] = digest({"provenance": provenance, "config": cfg})
            self.records[provenance["preparationId"]] = {
                "provenance": provenance, "image": image, "source": source,
                "expires": now + self.ttl, "approved": False, "activated": False}
            return copy.deepcopy(provenance)

    def transition(self, payload, rows, directory, activate=False):
        if not isinstance(payload, dict) or set(payload) != {"preparationId", "configurationHash"}:
            raise ValueError("Expected preparationId and configurationHash only")
        with self.lock:
            key = payload["preparationId"]
            record = self.records.get(key) if isinstance(key, str) else None
            if record is None or record["expires"] <= time.monotonic():
                raise ValueError("Simulation preparation missing or expired; prepare again")
            provenance = record["provenance"]
            if payload["configurationHash"] != provenance["configurationHash"]:
                raise ValueError("Simulation configuration hash mismatch")
            if record["activated"]:
                raise ValueError("Simulation preparation already activated; prepare again")
            if digest(rows) != provenance["sourceNamespaceFingerprint"]:
                raise ValueError("Saved Namespace changed; prepare again")
            if artifact_bindings(record["source"], directory) != provenance["artifactBindings"]:
                raise ValueError("Saved artifacts changed; prepare again")
            result = copy.deepcopy(provenance)
            if activate:
                if not record["approved"]:
                    raise ValueError("Approve this exact simulation configuration before activation")
                record["activated"] = True
                image = record["image"]
                result.update(activated=True, approved=True,
                              words=list(struct.unpack(f"<{len(image) // 4}I", image)),
                              totalWords=len(image) // 4, entries=copy.deepcopy(provenance["preparedRows"]))
            else:
                record["approved"] = True
                result["approved"] = True
            return result