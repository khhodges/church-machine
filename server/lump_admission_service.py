"""The server-owned boundary for admission of unknown LUMPs.

This module intentionally has no Flask or browser dependencies.  Quarantine is
an immutable input to the service; only this boundary can make a copy visible
to the executable catalogue and publish a Namespace row.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from copy import deepcopy


GATES = ("gate0", "gate1", "gate2", "gate3", "gate4", "gate5")
MAX_NAMESPACE_SLOTS = 0x1FFF
PROTECTED_NAMESPACE_SLOTS = frozenset({
    0, 1,              # foundational Namespace and Thread
    2, 3, 4, 5, 13,   # hardware/MMIO identities
    6, 7, 10, 11, 12, # resident watchdog/call-home/test and Thread objects
})


class AdmissionError(ValueError):
    def __init__(self, message, gates=None, status=422):
        super().__init__(message)
        self.gates = gates or {}
        self.status = status


class MintService:
    """The sole owner of destination-local executable GT issuance."""
    def issue_egt(self, *, generation, slot, capability_type=1):
        if not isinstance(generation, int) or not 0 <= generation <= 0x1ff:
            raise AdmissionError("invalid destination generation")
        if not isinstance(slot, int) or not 0 <= slot <= 0xffff:
            raise AdmissionError("invalid destination slot")
        # E/Inform v2 encoding.  Keeping this in MintService prevents routes
        # and Namespace code from manufacturing executable capabilities.
        return f"{((4 << 28) | (1 << 27) | ((capability_type & 3) << 25) | ((generation & 0x1ff) << 16) | slot):08x}"


class NavanaService:
    """Stages and CAS-publishes artifact, catalogue, Namespace and evidence."""
    JOURNAL_NAME = ".navana-admission-transaction.json"

    def __init__(self, replace_func=None):
        self._replace = replace_func or os.replace

    def recover(self, lumps_dir):
        """Finish or roll back a publication interrupted by process death."""
        journal_path = os.path.join(lumps_dir, self.JOURNAL_NAME)
        try:
            with open(journal_path, encoding="utf-8") as stream:
                journal = json.load(stream)
        except FileNotFoundError:
            return False
        entries = journal.get("entries")
        if not isinstance(entries, list):
            raise AdmissionError("admission recovery journal is invalid", status=500)
        committed = journal.get("phase") == "committed"
        for entry in reversed(entries):
            target = entry.get("target")
            backup = entry.get("backup")
            if not isinstance(target, str) or not isinstance(backup, str):
                raise AdmissionError("admission recovery journal is invalid",
                                     status=500)
            if committed:
                try:
                    os.unlink(backup)
                except FileNotFoundError:
                    pass
                continue
            if os.path.exists(backup):
                try:
                    os.unlink(target)
                except FileNotFoundError:
                    pass
                os.replace(backup, target)
            elif not entry.get("existed"):
                try:
                    os.unlink(target)
                except FileNotFoundError:
                    pass
        os.unlink(journal_path)
        _fsync_directory(lumps_dir)
        return True

    def publish(self, *, raw, destination, manifest, state, evidence,
                lumps_dir, manifest_path, state_path, evidence_path,
                 approvals_path, approvals, original_raw=None,
                 original_path=None):
        self.recover(lumps_dir)
        stage = tempfile.mkdtemp(prefix=".navana-", dir=lumps_dir)
        replaced = []
        journal_path = os.path.join(lumps_dir, self.JOURNAL_NAME)
        try:
            artifact = os.path.join(stage, destination["filename"])
            with open(artifact, "wb") as stream:
                stream.write(raw)
            if original_raw is not None and original_path:
                original_stage = os.path.join(stage, "portable-original.lump")
                with open(original_stage, "wb") as stream:
                    stream.write(original_raw)
            _atomic_json(os.path.join(stage, "manifest.json"), manifest)
            _atomic_json(os.path.join(stage, "state.json"), state)
            _atomic_json(os.path.join(stage, "evidence.json"), evidence)
            # CAS is held by the caller's manifest lock.  Stage all bytes
            # before the first replace, so validation/I/O failures cannot
            # expose a partial admission.
            targets = [(artifact, os.path.join(lumps_dir, destination["filename"])),
                       (os.path.join(stage, "manifest.json"), manifest_path),
                       (os.path.join(stage, "state.json"), state_path)]
            os.makedirs(os.path.dirname(evidence_path), exist_ok=True)
            if original_path:
                os.makedirs(os.path.dirname(original_path), exist_ok=True)
            targets.append((os.path.join(stage, "evidence.json"), evidence_path))
            try:
                from lump_approvals import write_approvals
            except ImportError:
                from server.lump_approvals import write_approvals
            approval_record = evidence["approval_record"]
            write_approvals(os.path.join(stage, "approvals.json"),
                            {**approvals, evidence["binary_hash"]: approval_record})
            targets.append((os.path.join(stage, "approvals.json"), approvals_path))
            if original_raw is not None and original_path:
                targets.append((os.path.join(stage, "portable-original.lump"), original_path))
            entries = [{
                "source": source,
                "target": target,
                "backup": target + ".navana-backup",
                "existed": os.path.exists(target),
            } for source, target in targets]
            _atomic_json(journal_path, {
                "schema": "church.navana-admission-transaction/v1",
                "phase": "prepared",
                "entries": entries,
            })
            backups = []
            for source, target in targets:
                backup = target + ".navana-backup"
                if os.path.exists(target):
                    self._replace(target, backup)
                    backups.append((backup, target))
                self._replace(source, target)
                replaced.append(target)
            _atomic_json(journal_path, {
                "schema": "church.navana-admission-transaction/v1",
                "phase": "committed",
                "entries": entries,
            })
            for backup, _ in backups:
                try:
                    os.unlink(backup)
                except OSError:
                    pass
            os.unlink(journal_path)
            _fsync_directory(lumps_dir)
        except Exception:
            self.recover(lumps_dir)
            raise
        finally:
            for filename in os.listdir(stage):
                try:
                    os.unlink(os.path.join(stage, filename))
                except OSError:
                    pass
            try:
                os.rmdir(stage)
            except OSError:
                pass


def _gate(status, reason=None, **facts):
    value = {"status": status}
    if reason:
        value["reason"] = reason
    value.update(facts)
    return value


def derive_capability_requirements(raw):
    """Return UI-compatible rights implied by the serialized c-list."""
    if not isinstance(raw, bytes) or len(raw) < 4:
        return []
    header = int.from_bytes(raw[:4], "big")
    size = 1 << (((header >> 23) & 0xf) + 6)
    cc = header & 0xff
    required = set()
    for index in range(cc):
        offset = (size - cc + index) * 4
        if offset + 4 > len(raw):
            continue
        word = int.from_bytes(raw[offset:offset + 4], "big")
        names = ("L", "S", "E") if word & (1 << 27) else ("R", "W", "X")
        perm = (word >> 28) & 7
        required.update(names[bit] for bit in range(3) if perm & (1 << bit))
    return sorted(required)


def derive_capability_targets(raw):
    """Return exact external c-list capabilities for programmer authorization."""
    if not isinstance(raw, bytes) or len(raw) < 4:
        return []
    header = int.from_bytes(raw[:4], "big")
    size = 1 << (((header >> 23) & 0xf) + 6)
    cc = header & 0xff
    if len(raw) != size * 4 or cc < 1 or cc > size:
        return []
    targets = []
    clist_start = size - cc
    for index in range(1, cc):
        word = int.from_bytes(
            raw[(clist_start + index) * 4:(clist_start + index + 1) * 4],
            "big")
        if not word:
            continue
        church = bool(word & (1 << 27))
        perm = (word >> 28) & 7
        names = ("L", "S", "E") if church else ("R", "W", "X")
        targets.append({
            "row": index,
            "token": f"{word:08x}",
            "slot": word & 0xffff,
            "generation": (word >> 16) & 0x1ff,
            "permissions": [names[bit] for bit in range(3)
                            if perm & (1 << bit)],
        })
    return targets


def verify_gates(raw, *, token, expected_digest, authorization, requested, granted):
    """Verify all six gates and return the canonical, non-boolean report."""
    digest = hashlib.sha256(raw).hexdigest()
    gates = {name: _gate("unavailable", "not evaluated") for name in GATES}
    if not isinstance(raw, bytes) or len(raw) < 4 or len(raw) % 4:
        gates["gate0"] = _gate("rejected", "truncated or impossible file representation")
        raise AdmissionError("upload transport is invalid", gates)
    header = int.from_bytes(raw[:4], "big")
    magic = (header >> 27) & 0x1f
    n = ((header >> 23) & 0xf) + 6
    size = 1 << n
    cw, typ, cc = (header >> 10) & 0x1fff, (header >> 8) & 3, header & 0xff
    if magic != 0x1f or len(raw) != size * 4 or not 6 <= n <= 21 or cw < 1 or 1 + cw + cc > size:
        gates["gate0"] = _gate("passed", transport="exact")
        gates["gate1"] = _gate("rejected", "invalid LUMP magic, allocation, or geometry")
        raise AdmissionError("invalid LUMP structure", gates)
    gates["gate0"] = _gate("passed", transport="exact")
    gates["gate1"] = _gate("passed", magic=magic, allocation_words=size,
                            code_words=cw, clist_count=cc)
    # Row zero is the compiler-owned Self authority.  A zero row is not an
    # admissible executable artifact; XE (mixed Turing/Church) is prohibited.
    row0 = int.from_bytes(raw[(size - cc) * 4:(size - cc + 1) * 4], "big")
    permission = (row0 >> 28) & 0xf
    if row0 == 0 or permission == 5:
        gates["gate2"] = _gate("rejected", "row-zero SELF authority or permission is invalid",
                               lump_type=typ)
        raise AdmissionError("claimed type or SELF authority is invalid", gates)
    gates["gate2"] = _gate("passed", lump_type=typ, self_authority=True)
    if (not re.fullmatch(r"[0-9a-f]{64}", str(expected_digest))
            or digest != str(expected_digest)
            or not re.fullmatch(r"[0-9a-f]{8}", str(token))
            or digest[:8] != str(token)):
        gates["gate3"] = _gate("rejected", "quarantined bytes do not match token",
                               binary_hash=digest)
        raise AdmissionError("quarantined bytes are tampered", gates, 409)
    gates["gate3"] = _gate("passed", binary_hash=digest,
                           identity_seal="unavailable",
                           source_seal="unavailable",
                           portable_seal="unavailable")
    # Gate 4 is deliberately based on the server-issued one-use record.  A
    # caller supplied human_authorized boolean is never consulted.
    if not isinstance(authorization, dict):
        gates["gate4"] = _gate("rejected", "session-bound approval intent required")
        raise AdmissionError("a valid approval intent is required", gates, 403)
    approved_grants = authorization.get("grants")
    approved_targets = authorization.get("capabilities")
    if not isinstance(approved_grants, list) or not isinstance(approved_targets, list):
        gates["gate4"] = _gate(
            "rejected", "approval intent lacks exact grants or capability targets")
        raise AdmissionError("approval intent is not bound to exact containment", gates, 403)
    gates["gate4"] = _gate("passed", authority="bootstrap-authorized",
                           human_vouched=True, genesis_certificate="unavailable")
    if not isinstance(granted, list):
        gates["gate5"] = _gate("rejected", "capability arrays are required")
        raise AdmissionError("requested and granted capabilities are required", gates)
    # Reachability is derived from serialized c-list words.  Requested
    # metadata is advisory only and is never an authority.
    clist_start = size - cc
    req = set()
    for index in range(cc):
        word = int.from_bytes(raw[(clist_start + index) * 4:(clist_start + index + 1) * 4], "big")
        if word:
            church = bool(word & (1 << 27))
            perm = (word >> 28) & 7
            names = ("L", "S", "E") if church else ("R", "W", "X")
            req.update(names[bit] for bit in range(3) if perm & (1 << bit))
    # The structural register encodings are reserved by the ISA.  Reject the
    # statically recognizable row-zero write forms; dynamic checks remain in
    # the Church Machine.
    code_start, code_end = 1, 1 + cw
    prohibited_ops = []
    for index in range(code_start, code_end):
        word = int.from_bytes(raw[index * 4:(index + 1) * 4], "big")
        if ((word >> 24) & 0xff) in {0x31, 0x32} and (word & 0xff) == 0:
            prohibited_ops.append(index)
    if prohibited_ops:
        gates["gate5"] = _gate("rejected", "static write to protected structural register",
                               required_rights=sorted(req),
                               prohibited_static_operations=prohibited_ops)
        raise AdmissionError("prohibited structural write", gates, 403)
    normalized_granted = sorted({str(x).upper() for x in granted})
    normalized_approved = sorted({str(x).upper() for x in approved_grants})
    if normalized_granted != normalized_approved:
        gates["gate5"] = _gate(
            "rejected", "request grants differ from the consumed approval intent")
        raise AdmissionError("capability grant substitution rejected", gates, 403)
    actual_targets = derive_capability_targets(raw)
    if actual_targets != approved_targets:
        gates["gate5"] = _gate(
            "rejected", "external capability identities differ from the approved set",
            required_capabilities=actual_targets,
            approved_capabilities=approved_targets)
        raise AdmissionError("capability target substitution rejected", gates, 403)
    grant = set(normalized_approved)
    prohibited = {"WRITE_ROW_ZERO", "WRITE_ROW0", "STRUCTURAL_REGISTER",
                  "WRITE_STRUCTURAL_REGISTER"}
    if not req.issubset(grant) or req & prohibited:
        gates["gate5"] = _gate("rejected", "requested reachability exceeds grants or is prohibited",
                               requested=sorted(req), granted=sorted(grant))
        raise AdmissionError("capability containment rejected", gates, 403)
    gates["gate5"] = _gate(
        "passed", required_rights=sorted(req), granted=sorted(grant),
        approved_capabilities=approved_targets,
        prohibited_static_operations=[])
    return gates


def _atomic_json(path, value):
    directory = os.path.dirname(os.path.abspath(path))
    fd, temporary = tempfile.mkstemp(dir=directory, suffix=".admission")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(value, stream, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        _fsync_directory(directory)
    except Exception:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


def _fsync_directory(path):
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def validate_active_manifest_selections(rows, manifest, lumps_dir,
                                        pending_artifacts=None):
    """Require every concrete Namespace artifact selector to name one live row."""
    if not isinstance(rows, list) or not isinstance(manifest, list):
        raise AdmissionError("Namespace or manifest data is invalid", status=409)
    pending_artifacts = pending_artifacts or {}
    for row in rows:
        if not isinstance(row, dict) or row.get("symbolic") is True:
            continue
        filename = row.get("filename")
        binary_hash = row.get("binary_hash", row.get("binaryHash"))
        if filename in (None, "") and binary_hash in (None, ""):
            continue
        if (not isinstance(filename, str)
                or os.path.basename(filename) != filename
                or not isinstance(binary_hash, str)
                or not re.fullmatch(r"[0-9a-f]{64}", binary_hash.lower())):
            raise AdmissionError(
                f"Namespace slot {row.get('slot')} lacks an exact LUMP filename and hash",
                status=409)
        matches = [
            entry for entry in manifest
            if isinstance(entry, dict)
            and entry.get("archived") is not True
            and entry.get("filename") == filename
        ]
        if len(matches) == 1 and filename in pending_artifacts:
            located_hash = hashlib.sha256(
                pending_artifacts[filename]).hexdigest()
        elif len(matches) == 1:
            try:
                with open(os.path.join(lumps_dir, filename), "rb") as stream:
                    located_hash = hashlib.sha256(stream.read()).hexdigest()
            except OSError:
                located_hash = None
        else:
            located_hash = None
        if len(matches) != 1 or located_hash != binary_hash.lower():
            raise AdmissionError(
                f"Namespace slot {row.get('slot')} must select exactly one active manifest row",
                status=409)


def admit(*, quarantine_path, lumps_dir, state_path, manifest_path, token,
          expected_digest,
          name, revision, destination_slot, replace, resident, boot,
          authorization, requested, granted, lock, portable_binding=None,
          portable_seal=None, navana=None, namespace_capacity=256,
          protected_slots=PROTECTED_NAMESPACE_SLOTS):
    """Verify, mint and publish one exact admission under ``lock``."""
    if not isinstance(revision, int) or isinstance(revision, bool) or revision < 1:
        raise AdmissionError("exact artifact revision is required", status=400)
    choices = (isinstance(destination_slot, int) and not isinstance(destination_slot, bool)
               and isinstance(replace, bool) and isinstance(resident, bool)
               and isinstance(boot, bool))
    if not choices:
        raise AdmissionError("explicit revision, destination, replace, resident, and boot choices are required",
                             status=400)
    if (isinstance(namespace_capacity, bool)
            or not isinstance(namespace_capacity, int)
            or not 1 <= namespace_capacity <= MAX_NAMESPACE_SLOTS):
        raise AdmissionError("configured Namespace capacity is invalid",
                             status=409)
    if not 0 <= destination_slot < namespace_capacity:
        raise AdmissionError(
            f"destination slot must be in 0..{namespace_capacity - 1}",
            status=400)
    if destination_slot in set(protected_slots or ()):
        raise AdmissionError(
            f"Namespace slot {destination_slot} is protected and cannot admit an upload",
            status=403)
    if boot and not resident:
        raise AdmissionError(
            "a boot entry must also be explicitly resident", status=400)
    mint = MintService()
    navana = navana or NavanaService()
    with lock:
        with open(quarantine_path, "rb") as stream:
            raw = stream.read()
        gates = verify_gates(raw, token=token, expected_digest=expected_digest,
                             authorization=authorization,
                             requested=requested, granted=granted)
        state = json.load(open(state_path, encoding="utf-8"))
        rows = state.get("abstractions")
        if not isinstance(rows, list):
            raise AdmissionError("Namespace state is invalid", gates)
        matches = [row for row in rows if isinstance(row, dict) and
                   row.get("slot") == destination_slot]
        if len(matches) > 1 or (matches and not replace):
            raise AdmissionError("destination is occupied; explicit replace is required", gates, 409)
        if matches and matches[0].get("boot") is True and not boot:
            raise AdmissionError(
                "replacing the current boot entry requires an explicit new boot selection",
                gates, 409)
        old_seq = matches[0].get("seq", 0) if matches else 0
        if not isinstance(old_seq, int) or not 0 <= old_seq < 0x1ff:
            raise AdmissionError("destination generation is invalid", gates)
        sequence = old_seq + 1
        if not name or os.path.basename(name) != name or "/" in name:
            raise AdmissionError("invalid artifact name", gates, 400)
        manifest = json.load(open(manifest_path, encoding="utf-8")) if os.path.exists(manifest_path) else []
        approvals_path = os.path.join(lumps_dir, "approvals.json")
        try:
            from lump_approvals import read_approvals
        except ImportError:
            from server.lump_approvals import read_approvals
        approvals = read_approvals(approvals_path)
        egt = mint.issue_egt(generation=sequence, slot=destination_slot)
        header = int.from_bytes(raw[:4], "big")
        allocation = 1 << (((header >> 23) & 0xf) + 6)
        cc = header & 0xff
        derivative_raw = bytearray(raw)
        if cc:
            offset = (allocation - cc) * 4
            derivative_raw[offset:offset + 4] = int(egt, 16).to_bytes(4, "big")
        derivative_raw = bytes(derivative_raw)
        # Keep the two byte identities distinct.  The quarantine digest is the
        # identity checked by Gate 3 and is also the provenance of the portable
        # original; replacing the SELF row creates a different executable
        # derivative with its own manifest/evidence digest.
        original_digest = hashlib.sha256(raw).hexdigest()
        digest = hashlib.sha256(derivative_raw).hexdigest()
        artifact_number = digest[:8]
        executable_token = egt if resident else artifact_number
        filename = f"{name}.{revision}.{artifact_number}.lump"
        destination = os.path.join(lumps_dir, filename)
        collisions = [
            entry for entry in manifest
            if isinstance(entry, dict) and entry.get("token") == executable_token
        ]
        if collisions:
            raise AdmissionError(
                "destination-local executable token collides with another artifact",
                gates, 409)
        if matches:
            prior_filename = matches[0].get("filename")
            prior_token = matches[0].get("token")
            for entry in manifest:
                if (isinstance(entry, dict)
                        and entry.get("filename") == prior_filename
                        and entry.get("token") == prior_token
                        and entry.get("archived") is not True):
                    entry["archived"] = True
        manifest.append({
            "token": executable_token,
            "filename": filename,
            "abstraction": name,
            "lump_version": revision,
            "binary_hash": digest,
        })
        row = {"name": name, "slot": destination_slot, "seq": sequence,
               "token": executable_token, "filename": filename,
               "resident": resident, "boot_resident": resident,
               "ns_slot_policy": "static" if resident else "dynamic",
               "load_policy": "Resident" if resident else "Dynamic",
               "type": "Inform", "admission": "bootstrap-authorized"}
        if boot:
            row["boot"] = True
        row["binary_hash"] = digest
        state = deepcopy(state)
        if boot:
            for existing in state["abstractions"]:
                existing.pop("boot", None)
        state["abstractions"] = [r for r in state["abstractions"]
                                 if r.get("slot") != destination_slot] + [row]
        state["revision"] = int(state.get("revision", 0)) + 1
        validate_active_manifest_selections(
            state["abstractions"], manifest, lumps_dir,
            pending_artifacts={filename: derivative_raw})
        evidence = {"schema": "church.admission-evidence/v1",
                    "token": executable_token, "portable_token": token,
                    "binary_hash": digest, "revision": revision,
                    "gates": gates, "egt": egt, "namespace": row}
        evidence["portable_original_sha256"] = original_digest
        evidence["approval_record"] = {
            "binary_hash": digest, "filename": filename,
            "token": executable_token,
            "abstraction": name, "dot_name": name, "issue_n": revision,
            "grants": sorted(set(granted or [])),
            "capability_type": 1, "trust_origin": "bootstrap-authorized",
            "integrity_record": {
                "binary_hash": digest, "admission": "bootstrap-authorized",
                "gate_schema": gates, "mint_egt": egt,
            },
        }
        try:
            from bootstrap_identity import publication_uses_bootstrap_authority
        except ImportError:
            from server.bootstrap_identity import publication_uses_bootstrap_authority
        if publication_uses_bootstrap_authority(row, portable_binding):
            evidence["approval_record"]["bootstrap_t"] = egt
            evidence["approval_record"]["bootstrap_runtime_gt"] = int(egt, 16)
        if portable_binding is not None:
            try:
                from portable_binding import bind_portable_derivative, validate_portable_binding
            except ImportError:
                from server.portable_binding import bind_portable_derivative, validate_portable_binding
            portable_binding = validate_portable_binding(
                portable_binding, cc=raw[3] & 0xff)
            derivative = bind_portable_derivative(
                raw, portable_seal or evidence["binary_hash"],
                {"slot": destination_slot, "sequence": sequence},
                evidence={"admission": "bootstrap-authorized"})
            evidence["portable_seal"] = derivative["portable_seal"]
            evidence["local_binding"] = derivative["binding"]
            evidence["portable_binding"] = portable_binding
            evidence["approval_record"]["portable_binding"] = portable_binding
        navana.publish(
            raw=derivative_raw, destination={"filename": filename}, manifest=manifest,
            state=state, evidence=evidence, lumps_dir=lumps_dir,
            manifest_path=manifest_path, state_path=state_path,
            evidence_path=os.path.join(lumps_dir, "admission-evidence",
                                       executable_token + ".json"),
            approvals_path=approvals_path,
            approvals=approvals,
            original_raw=raw,
            original_path=os.path.join(lumps_dir, "portable-original",
                                       token + ".lump"))
        return {"token": executable_token, "portable_token": token,
                "filename": filename, "gates": gates,
                "mint_egt": egt, "admission": "bootstrap-authorized",
                "portable_original_sha256": original_digest,
                "derivative_sha256": digest, "revision": revision,
                "admission_evidence": evidence}