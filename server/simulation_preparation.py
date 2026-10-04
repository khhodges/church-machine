"""Private simulation review and durable approved inputs, separate from hardware."""
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
    from server.boot_image import image_artifact_selected
    bindings = []
    for row in rows:
        if not image_artifact_selected(row):
            continue
        filename = row.get("filename")
        if not filename:
            raise ValueError(f"NS[{row['slot']}] selected for image requires an exact saved artifact")
        if row.get("type") not in ("Inform", "Resident"):
            raise ValueError(
                f"NS[{row['slot']}] artifact-bound {row.get('type')!r} rows are "
                "not supported by simulation preparation. Select an executable "
                "Inform/Resident artifact, or remove this unsupported assignment "
                "from the saved Namespace before preparing.")
        expected = row.get("binary_hash") or row.get("binaryHash")
        token = row.get("token") or row.get("cache_token")
        if (not isinstance(filename, str) or os.path.basename(filename) != filename
                or not isinstance(expected, str)
                or not re.fullmatch(r"[0-9a-fA-F]{64}", expected)):
            raise ValueError(f"NS[{row['slot']}] has an invalid immutable artifact binding")
        raw = (Path(directory) / filename).read_bytes()
        if hashlib.sha256(raw).hexdigest() != expected.lower():
            raise ValueError(f"NS[{row['slot']}] saved artifact hash mismatch")
        words = _validate_body(raw)
        binding = {"slot": row["slot"], "filename": filename,
                   "token": token, "binaryHash": expected.lower()}
        from server.lump_approvals import (
            read_approvals, is_trusted_compiler_record, compiler_record_verification_key)
        approval = read_approvals(str(Path(directory) / "approvals.json")).get(expected.lower())
        if approval and approval.get("portable_binding") is not None:
            from server.portable_binding import validate_portable_binding, validate_unresolved_clist
            from server.lump_integrity import compute_number
            identity = parse_canonical_filename(filename)
            if identity is None:
                raise ValueError("Portable artifact requires its signed canonical identity")
            dot, issue, number = identity
            contract = validate_portable_binding(approval["portable_binding"], words[0] & 255)
            if {dep["relocation_row"] for dep in contract["dependencies"]} != set(range(words[0] & 255)):
                raise ValueError("Portable relocation rows must cover the exact c-list")
            if (approval.get("filename") != filename or contract["owner"] != f"{dot}#{issue}"
                    or approval.get("dot_name") != dot or approval.get("issue_n") != issue
                    or compute_number(dot, raw) != number):
                raise ValueError("Portable artifact approval identity differs from selected bytes")
            try:
                key = compiler_record_verification_key(approval.get("compiler_record"))
            except RuntimeError as exc:
                raise ValueError(f"Portable compiler evidence unavailable: {exc}") from exc
            if not is_trusted_compiler_record(approval, binary=raw, signing_key=key):
                raise ValueError("Portable simulation requires authenticated compiler evidence")
            validate_unresolved_clist(contract, words)
            binding["portableBinding"] = contract
            binding["approvalHash"] = digest(approval)
        bindings.append(binding)
    return bindings


def _localize_portable(raw, binding, rows, bindings, directory):
    """Materialize only a private derivative; retain source N/T/hash separately."""
    from server.portable_binding import mint_gt, verify_candidate
    contract = binding["portableBinding"]
    words = _validate_body(
        raw, executable=True, label=f"NS[{binding['slot']}] {binding['filename']}")
    owner = next(row for row in rows if row["slot"] == binding["slot"])
    start = len(words) - (words[0] & 255)
    for dep in contract["dependencies"]:
        target = owner
        if not dep["symbolic_self"]:
            candidates = []
            for candidate in bindings:
                identity = parse_canonical_filename(candidate["filename"])
                if identity is None:
                    continue
                dot, issue, _ = identity
                identity = f"{dot}#{issue}"
                metadata = {"N": identity, "binary_hash": candidate["binaryHash"],
                            "identity_hash": hashlib.sha256(identity.encode()).hexdigest()}
                data = (Path(directory) / candidate["filename"]).read_bytes()
                ok, _ = verify_candidate(dep, metadata, data)
                if ok:
                    candidates.append(next(row for row in rows if row["slot"] == candidate["slot"]))
            if len(candidates) != 1:
                raise ValueError(f"Portable dependency {dep['N']} requires one exact selected assignment")
            target = candidates[0]
        sequence = target.get("seq")
        if type(sequence) is not int or not 0 <= sequence <= 511:
            raise ValueError("Portable simulation destination requires an exact Namespace sequence")
        words[start + dep["relocation_row"]] = mint_gt(
            sequence, target["slot"], dep["rights"], dep["capability_type"])
    return struct.pack(f">{len(words)}I", *words), words[start]


def _static_clist_index(word):
    """Decode only statically known CR6 accesses; never guess a DR value.

    Master ISA: LOAD/SAVE operand15 = sign:1, magnitude:10, DR:4.
    Legacy fused instructions have distinct formats, not that indexed format.
    Dynamic accesses still undergo the simulator/hardware runtime checks.
    """
    if ((word >> 15) & 15) != 6:
        return None
    opcode = (word >> 27) & 31
    operand = word & 0x7FFF
    if opcode in (0, 1):
        if operand & 15:  # Only hardwired DR0 has a statically known value.
            return None
        magnitude = (operand >> 4) & 1023
        return -magnitude if operand & 0x4000 else magnitude
    if opcode == 8:
        return operand & 31  # ELOADCALL row; other bits select the method.
    if opcode == 9:
        return operand  # XLOADLAMBDA uses the full immediate.
    return None


def _validate_body(raw, executable=False, *, label="Simulation artifact"):
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
        for offset, word in enumerate(words[1:1 + cw], 1):
            index = _static_clist_index(word)
            if index is not None and not 0 <= index < cc:
                raise ValueError(
                    f"{label}: word +{offset} (0x{word:08X}) has an out-of-range "
                    f"C-list index {index}; C-list contains {cc} words. "
                    "No image was published by this validation.")
    return words


def validate_simulation_executable(path, lumps_dir, label, bootstrap_binding=None):
    with open(Path(lumps_dir) / "ns-state.json", encoding="utf-8") as source:
        rows = json.load(source)["abstractions"]
    matches = [row for row in rows if row.get("filename") == os.path.basename(path)]
    if not matches:
        raise ValueError(f"{label}: executable is not in the frozen Namespace")
    artifact_bindings(matches, lumps_dir)
    words = _validate_body(Path(path).read_bytes(), executable=True, label=label)
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
        if boot_image.image_artifact_selected(row) and row.get("filename"):
            # Prepared configuration records actual residency only for bodies
            # selected by the frozen source. The source rows remain unchanged.
            row.update(resident=True, boot_resident=True, load_policy="Resident")
    with tempfile.TemporaryDirectory(prefix="simulation-private-") as private:
        stage = Path(private)
        image_rows = copy.deepcopy(prepared)
        local_tokens = {}
        if len({binding["filename"] for binding in bindings}) != len(bindings):
            raise ValueError("Private simulation requires a unique destination per selected artifact")
        for binding in bindings:
            raw = (Path(directory) / binding["filename"]).read_bytes()
            if hashlib.sha256(raw).hexdigest() != binding["binaryHash"]:
                raise ValueError("Artifact changed while staging simulation")
            if "portableBinding" in binding:
                raw, local_gt = _localize_portable(raw, binding, rows, bindings, directory)
            else:
                # Catalog lookup identity is not the destination runtime GT.
                # Validate immutable SELF against the Namespace, then derive
                # only the private descriptor. Never rewrite the saved binding.
                words = _validate_body(raw, executable=True)
                owner = next(row for row in rows if row["slot"] == binding["slot"])
                sequence = owner.get("seq")
                if type(sequence) is not int or not 0 <= sequence <= 511:
                    raise ValueError(f"NS[{owner['slot']}] simulator resident has an invalid sequence")
                cc = words[0] & 255
                local_gt = 0x4A000000 | (sequence << 16) | owner["slot"]
                if not cc or words[len(words) - cc] != local_gt:
                    raise ValueError(f"NS[{owner['slot']}] immutable SELF row 0 differs from owning Namespace GT")
            local_hash = hashlib.sha256(raw).hexdigest()
            local_tokens[binding["slot"]] = local_gt
            staged = next(row for row in image_rows if row["slot"] == binding["slot"])
            staged.update(token=f"{local_gt:08x}", cache_token=f"{local_gt:08x}",
                          binary_hash=local_hash)
            reviewed = next(row for row in prepared if row["slot"] == binding["slot"])
            reviewed["simulationBinding"] = {
                "sourceArtifact": copy.deepcopy(binding), "localSelfGT": f"{local_gt:08x}",
                "derivativeHash": local_hash}
            (stage / binding["filename"]).write_bytes(raw)
        (stage / "ns-state.json").write_text(json.dumps({"abstractions": image_rows}))
        (stage / "manifest.json").write_text("[]")
        (stage / "approvals.json").write_text(
            '{"version":1,"algorithm":"sha256","approvals":{}}')
        image = boot_image.generate_simulation_image(cfg, private, entry_slot)
        boot_image.validate_boot_image(image, simulation_only=True)
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
            source = next(row for row in rows if row["slot"] == slot)
            if "location" in source:
                requested = source["location"]
                requested = int(requested, 0) if isinstance(requested, str) else requested
                if location != requested:
                    raise ValueError(f"NS[{slot}] generated image moved its saved Namespace location")
            raw = (stage / binding["filename"]).read_bytes()
            expected_words = struct.unpack(f">{len(raw) // 4}I", raw)
            if (not authority or location + len(expected_words) > physical["table_offset_words"]
                    or token != local_tokens[slot]
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
    """Ephemeral review/activation tickets backed by immutable approved revisions."""
    def __init__(self, ttl=1800, capacity=32, revision_store=None):
        self.records = {}
        self.lock = threading.RLock()
        self.ttl, self.capacity = ttl, capacity
        self.revision_store = revision_store

    def _history_store(self):
        return self.revision_store() if callable(self.revision_store) else self.revision_store

    def history(self):
        store = self._history_store()
        if store is None:
            return []
        return [{"revisionId": row["revision_id"], "approved": True,
                 **copy.deepcopy(row["metadata"]["provenance"])}
                for row in store.history("namespace")
                if row["metadata"].get("purpose") == "approved-simulation"]

    def reopen(self, payload):
        if not isinstance(payload, dict) or set(payload) != {"revisionId"}:
            raise ValueError("Expected revisionId only")
        store = self._history_store()
        if store is None:
            raise ValueError("Approved simulation history is unavailable")
        revision = payload["revisionId"]
        if not isinstance(revision, str):
            raise ValueError("Invalid revision identity")
        retained = store.read("namespace", revision)
        if retained["metadata"].get("purpose") != "approved-simulation":
            raise ValueError("Revision is not an approved simulation")
        provenance = copy.deepcopy(retained["metadata"]["provenance"])
        image = Path(store.file_path("namespace", revision, "simulation.bin")).read_bytes()
        if hashlib.sha256(image).hexdigest() != provenance["imageHash"]:
            raise ValueError("Retained simulation image hash mismatch")
        with self.lock:
            now = time.monotonic()
            self.records = {key: value for key, value in self.records.items()
                            if value["expires"] > now}
            if len(self.records) >= self.capacity:
                raise ValueError("Too many simulation preparations; retry after expiry")
            provenance["preparationId"] = uuid.uuid4().hex
            provenance["approvedRevisionId"] = revision
            provenance["configurationHash"] = digest({
                "revision": revision, "activation": provenance["preparationId"],
                "imageHash": provenance["imageHash"]})
            self.records[provenance["preparationId"]] = {
                "provenance": provenance, "image": image, "source": [],
                "expires": now + self.ttl, "approved": True, "activated": False}
            return dict(copy.deepcopy(provenance), approved=True, activated=False)

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
                "config": copy.deepcopy(cfg),
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
            retained = record["approved"] and provenance.get("approvedRevisionId")
            if retained:
                store = self._history_store()
                store.read("namespace", retained)
            else:
                if callable(rows):
                    rows = rows()
                if digest(rows) != provenance["sourceNamespaceFingerprint"]:
                    raise ValueError("Saved Namespace changed; prepare again")
                if artifact_bindings(record["source"], directory) != provenance["artifactBindings"]:
                    raise ValueError("Saved artifacts changed; prepare again")
            if not activate and not record["approved"] and self._history_store() is not None:
                files = {"simulation.bin": record["image"],
                         "namespace.json": json.dumps(record["source"], sort_keys=True).encode(),
                         "configuration.json": json.dumps(record["config"], sort_keys=True).encode()}
                for binding in provenance["artifactBindings"]:
                    raw = (Path(directory) / binding["filename"]).read_bytes()
                    if hashlib.sha256(raw).hexdigest() != binding["binaryHash"]:
                        raise ValueError("Saved artifacts changed during approval; prepare again")
                    files[binding["filename"]] = raw
                revision = self._history_store().publish("namespace", {
                    "purpose": "approved-simulation", "provenance": copy.deepcopy(provenance),
                }, files)
                provenance["approvedRevisionId"] = revision
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