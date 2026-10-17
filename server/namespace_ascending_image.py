"""Explicit private-image codec for the ascending Namespace layout.

This is deliberately separate from boot_image.py and namespace_image_refresh.py.
The caller must select FORMAT explicitly and provide already-migrated target
rows. It never rewrites the saved Namespace, approves LUMP artifacts, or
activates an image. Candidate review records are handled by a distinct,
profile-specific store.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import struct
import tempfile
from datetime import datetime, timezone

from shared.namespace_header import pack_namespace_word0, unpack_namespace_word0
from server import boot_image as boot


FORMAT = "ascending-nst-metadata-slot0-v1"
ENTRY_WORDS = 4
MIN_WORDS = 1 << 13
MAX_WORDS = 1 << 22
THREAD_SLOT = 2
SELF_SLOT = 1


def _integer(value, label):
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise ValueError(f"{label} must be an explicit integer")
    result = int(value, 0) if isinstance(value, str) else value
    if result < 0:
        raise ValueError(f"{label} must be nonnegative")
    return result


def _sha(raw):
    return hashlib.sha256(raw).hexdigest()


class AscendingCandidateStore:
    """Profile-specific review and approval records for private image candidates.

    This store never modifies candidates or writes into the historical LUMP
    approval registry. A profile approval records review of exact bytes only;
    it does not authorize installation, activation, or hardware programming.
    """

    def __init__(self, candidate_root):
        self.candidate_root = Path(candidate_root)
        self.approval_root = self.candidate_root / "ascending-v1-approvals"

    def _candidate_id(self, candidate_id):
        if (not isinstance(candidate_id, str) or not candidate_id
                or len(candidate_id) > 128
                or candidate_id in (".", "..")
                or any(char not in "abcdefghijklmnopqrstuvwxyz"
                       "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-" for char in candidate_id)):
            raise ValueError("Candidate must be a single generated-artifacts directory name")
        if candidate_id == self.approval_root.name:
            raise ValueError("Reserved profile-approval directory is not a candidate")
        return candidate_id

    def candidate_paths(self, candidate_id):
        name = self._candidate_id(candidate_id)
        root = self.candidate_root.resolve()
        if self.candidate_root.is_symlink():
            raise ValueError("Candidate staging root must not be a symlink")
        folder = self.candidate_root / name
        if folder.is_symlink() or not folder.resolve().is_relative_to(root):
            raise ValueError("Candidate must remain in generated-artifacts")
        return folder, folder / "candidate.bin", folder / "candidate.json"

    def approval_path(self, digest):
        if not isinstance(digest, str) or len(digest) != 64 or any(
                char not in "0123456789abcdef" for char in digest):
            raise ValueError("Invalid ascending-v1 candidate digest")
        return self.approval_root / f"{digest}.json"

    def protected_paths(self, candidate_id):
        _folder, image_path, record_path = self.candidate_paths(candidate_id)
        record = {}
        if record_path.is_file() and not record_path.is_symlink():
            try:
                record = json.loads(record_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                pass
        digest = record.get("imageSha256")
        paths = [image_path, record_path]
        if isinstance(digest, str) and len(digest) == 64:
            paths.append(self.approval_path(digest))
        return paths

    def review(self, candidate_id):
        candidate_id = self._candidate_id(candidate_id)
        folder, image_path, record_path = self.candidate_paths(candidate_id)
        if (not folder.is_dir() or image_path.is_symlink() or record_path.is_symlink()
                or not image_path.is_file() or not record_path.is_file()):
            raise ValueError("Candidate must contain regular candidate.bin and candidate.json files")
        image = image_path.read_bytes()
        try:
            candidate_bytes = record_path.read_bytes()
            candidate = json.loads(candidate_bytes)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError("Candidate metadata is not valid JSON") from exc
        if not isinstance(candidate, dict):
            raise ValueError("Candidate metadata must be an object")
        if (candidate.get("format") != FORMAT
                or candidate.get("purpose") != "private-new-format-candidate"
                or candidate.get("status") != "private-candidate"):
            raise ValueError("Candidate is not a private ascending-v1 candidate")
        if (candidate.get("approvalEligible") is not False
                or candidate.get("installationAllowed") is not False
                or candidate.get("activationAllowed") is not False
                or candidate.get("hardwareProgrammingAllowed") is not False
                or candidate.get("hardwareCertified") is not False):
            raise ValueError("Candidate approval and activation flags must remain false")
        digest = _sha(image)
        if candidate.get("imageSha256") != digest:
            raise ValueError("Candidate image hash does not match its metadata")
        validation = validate_image(image, image_format=FORMAT)
        for key in ("capacityWords", "slotCount", "tableWords", "memberCount",
                    "bootTarget", "threadRows", "liveSlots", "ownedRanges"):
            if candidate.get(key) != validation[key]:
                raise ValueError(f"Candidate {key} metadata differs from validated image")
        review = {
            "format": FORMAT,
            "candidate": candidate_id,
            "imageSha256": digest,
            "candidateMetadataSha256": _sha(candidate_bytes),
            "capacityWords": validation["capacityWords"],
            "slotCount": validation["slotCount"],
            "memberCount": validation["memberCount"],
            "bootTarget": validation["bootTarget"],
            "liveSlots": validation["liveSlots"],
            "status": "profile-review-ready",
            "historicalApprovalEligible": False,
            "profileApproved": False,
            "installationAllowed": False,
            "activationAllowed": False,
            "hardwareProgrammingAllowed": False,
        }
        review["reviewId"] = _sha(json.dumps(
            review, sort_keys=True, separators=(",", ":")).encode("utf-8"))
        return review

    def approve(self, candidate_id, review_id):
        review = self.review(candidate_id)
        if not isinstance(review_id, str) or review_id != review["reviewId"]:
            raise ValueError("Review identity is stale or does not match this candidate")
        approval = {
            "format": FORMAT,
            "candidate": review["candidate"],
            "imageSha256": review["imageSha256"],
            "candidateMetadataSha256": review["candidateMetadataSha256"],
            "reviewId": review["reviewId"],
            "status": "profile-approved",
            "profileApprovalEligible": True,
            "profileApproved": True,
            "approvalScope": "ascending-v1-profile-review-only",
            "historicalApprovalEligible": False,
            "installationAllowed": False,
            "activationAllowed": False,
            "hardwareProgrammingAllowed": False,
            "hardwareCertified": False,
            "approvedAt": datetime.now(timezone.utc).isoformat(),
        }
        self.approval_root.mkdir(parents=True, exist_ok=True)
        if self.approval_root.is_symlink():
            raise ValueError("Profile approval directory must not be a symlink")
        target = self.approval_path(review["imageSha256"])
        if target.is_symlink():
            raise ValueError("Profile approval record must not be a symlink")

        def existing_approval():
            existing_record = json.loads(target.read_text(encoding="utf-8"))
            expected = {key: value for key, value in approval.items()
                        if key != "approvedAt"}
            if (not isinstance(existing_record, dict)
                    or any(existing_record.get(key) != value
                           for key, value in expected.items())
                    or not isinstance(existing_record.get("approvedAt"), str)):
                raise ValueError("A conflicting profile approval already exists")
            return existing_record

        existing = None
        if target.exists():
            return existing_approval()

        fd, temp_name = tempfile.mkstemp(prefix=".approval-", dir=self.approval_root)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as output:
                json.dump(approval, output, indent=2, sort_keys=True)
                output.write("\n")
                output.flush()
                os.fsync(output.fileno())
            try:
                os.link(temp_name, target)
            except FileExistsError:
                return existing_approval()
            directory_fd = os.open(self.approval_root, os.O_RDONLY)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
        finally:
            if os.path.exists(temp_name):
                os.unlink(temp_name)
        return approval


def _load_lump(row, lumps_dir, artifacts):
    filename = row.get("filename")
    expected = row.get("binary_hash") or row.get("binaryHash")
    if not isinstance(filename, str) or not filename or Path(filename).name != filename:
        raise ValueError(f"NS[{row['slot']}] requires an exact local LUMP filename")
    if not isinstance(expected, str) or len(expected) != 64:
        raise ValueError(f"NS[{row['slot']}] requires an exact SHA-256 binding")
    if artifacts is not None:
        try:
            raw = artifacts[filename]
        except KeyError as exc:
            raise ValueError(f"NS[{row['slot']}] selected LUMP is not in the frozen inputs") from exc
    else:
        path = Path(lumps_dir) / filename
        if path.is_symlink() or not path.resolve().is_relative_to(Path(lumps_dir).resolve()):
            raise ValueError(f"NS[{row['slot']}] selected LUMP must remain in the saved library")
        raw = path.read_bytes()
    if _sha(raw) != expected.lower():
        raise ValueError(f"NS[{row['slot']}] exact LUMP hash mismatch")
    if len(raw) < 4 or len(raw) % 4:
        raise ValueError(f"NS[{row['slot']}] LUMP is not word-aligned")
    words = list(struct.unpack(f">{len(raw) // 4}I", raw))
    header = words[0]
    size = 1 << (((header >> 23) & 15) + 6)
    cw, cc, typ = (header >> 10) & 8191, header & 255, (header >> 8) & 3
    if (header >> 27 != 31 or size != len(words) or 1 + cw + cc > size):
        raise ValueError(f"NS[{row['slot']}] selected LUMP has invalid header/allocation")
    return words, typ, cw, cc


def _write_entry(memory, slot, location, limit, sequence, cache_token=0):
    authority = boot.pack_ns_word1(limit, gt_seq=sequence, g=0, f=0)
    offset = slot * ENTRY_WORDS
    memory[offset:offset + ENTRY_WORDS] = [
        location, authority, boot.integrity32(location, authority), cache_token
    ]


def _decode_gt(word):
    return {
        "slot": word & 0xFFFF,
        "sequence": (word >> 16) & 0x1FF,
        "type": (word >> 25) & 0x3,
        "domain": (word >> 27) & 1,
        "permissions": (word >> 28) & 0x7,
    }


def build_fresh_thread_lump(*, allocation_words, stack_words, entry_slot,
                            entry_sequence):
    """Build a zero-initialized Thread with an explicit fresh entry continuation."""
    size = _integer(allocation_words, "Thread allocationWords")
    stack = _integer(stack_words, "Thread stackWords")
    target_slot = _integer(entry_slot, "Thread entry slot")
    target_sequence = _integer(entry_sequence, "Thread entry sequence")
    if target_slot == 0 or target_sequence > 511:
        raise ValueError("Fresh Thread entry binding is outside the GT fields")
    layout = boot.thread_layout(size, stack)
    if not layout["valid"]:
        raise ValueError("Fresh Thread allocation/stack geometry is invalid")

    entry_gt = boot.create_gt(target_sequence, target_slot, {"E": 1}, 1)
    words = [0] * size
    words[0] = boot.pack_lump_header(
        size.bit_length() - 7, stack, boot.THREAD_CAP_WORDS, 2)
    root_sto = layout["stack_end"] - 2
    resume_sto = root_sto - 2
    words[boot.THREAD_STO_OFFSET] = (1 << 12) | resume_sto
    words[layout["caps_start"]] = entry_gt
    # STO is the next free stack word. CHANGE reads its two-word resume
    # frame at STO+1/STO+2, just as CALL/RETURN do.
    words[resume_sto + 1] = entry_gt
    words[resume_sto + 2] = (1 << 12) | root_sto
    words[root_sto + 1] = entry_gt
    words[root_sto + 2] = (0x7FFF << 13) | (1 << 12) | layout["stack_end"]
    return struct.pack(f">{size}I", *words)


def _fresh_thread_words(raw, label):
    if len(raw) < 4 or len(raw) % 4:
        raise ValueError(f"{label}: fresh Thread image is not word-aligned")
    words = list(struct.unpack(f">{len(raw) // 4}I", raw))
    header = words[0]
    size = 1 << (((header >> 23) & 15) + 6)
    stack_words = (header >> 10) & 8191
    cap_words = header & 255
    if (header >> 27 != 31 or ((header >> 8) & 3) != 2 or size != len(words)
            or cap_words != boot.THREAD_CAP_WORDS):
        raise ValueError(f"{label}: fresh Thread image has invalid header/allocation")
    layout = boot.thread_layout(size, stack_words)
    if not layout["valid"]:
        raise ValueError(f"{label}: fresh Thread image has invalid private layout")
    entry_gt = words[layout["caps_start"]]
    fields = _decode_gt(entry_gt)
    if (entry_gt >> 31 or fields["type"] != 1 or fields["domain"] != 1
            or fields["permissions"] != 0b100):
        raise ValueError(f"{label}: fresh Thread CR0 is not an executable Inform GT")
    expected = struct.unpack(
        f">{len(words)}I",
        build_fresh_thread_lump(
            allocation_words=len(words), stack_words=stack_words,
            entry_slot=fields["slot"], entry_sequence=fields["sequence"]))
    if tuple(words) != expected:
        raise ValueError(f"{label}: Thread image is not a zero-state fresh continuation")
    return words, fields, layout


def validate_image(image, *, image_format):
    """Validate the explicit ascending-v1 byte stream, never a historical image."""
    if image_format != FORMAT:
        raise ValueError(f"Explicit format selection must be {FORMAT!r}")
    if not isinstance(image, (bytes, bytearray, memoryview)) or len(image) % 4:
        raise ValueError("Ascending Namespace image must be a whole-word byte stream")
    if len(image) < MIN_WORDS * 4:
        raise ValueError("Ascending Namespace image is smaller than 8K words")
    words = list(struct.unpack(f"<{len(image) // 4}I", image))
    if words[1] != 0:
        if words[1] == 0x4E534832:
            raise ValueError("Historical Namespace Header V2 is not an ascending-v1 image")
        raise ValueError("Ascending-v1 metadata base must be word zero")
    header = unpack_namespace_word0(words[0])
    total, slots = header["total_words"], header["slots"]
    if total != len(words):
        raise ValueError("Image byte length does not match the Namespace metadata capacity")
    if not 3 <= slots <= 0x1FFF or slots * ENTRY_WORDS > total:
        raise ValueError("Ascending Namespace slot count is outside supported geometry")
    table_words = slots * ENTRY_WORDS
    member_count = words[2]
    if words[3] != 0:
        raise ValueError("Ascending Namespace reserved metadata word must be zero")
    if member_count > slots - 2:
        raise ValueError("Ascending Namespace member count exceeds non-self slot capacity")
    if (words[2] != sum(
            1 for slot in range(2, slots)
            if any(words[slot * ENTRY_WORDS:(slot + 1) * ENTRY_WORDS]))):
        raise ValueError("Ascending Namespace member count disagrees with live descriptors")

    live = {}
    body_ranges = [(0, table_words, "Namespace metadata and ascending table")]
    for slot in range(1, slots):
        offset = slot * ENTRY_WORDS
        location, authority, seal, _cache = words[offset:offset + ENTRY_WORDS]
        if not (location or authority or seal or _cache):
            continue
        sequence = boot._ns_word1_get(authority, "gt_seq")
        limit = boot._ns_word1_get(authority, "limit_offset")
        if boot._ns_word1_get(authority, "f_flag"):
            raise ValueError(f"NS[{slot}] is marked free but contains a descriptor")
        if seal != boot.integrity32(location, authority):
            raise ValueError(f"NS[{slot}] integrity seal does not match its authority")
        if slot == SELF_SLOT:
            if (location, limit, sequence) != (0, table_words - 1, 0):
                raise ValueError("NS[1] must be the version-0 Namespace self descriptor")
            if _cache != 0:
                raise ValueError("NS[1] metadata self descriptor must not carry a cache token")
        else:
            if location < table_words and location < total:
                raise ValueError(f"NS[{slot}] body overlaps the ascending table")
            if limit >= total and location < total:
                raise ValueError(f"NS[{slot}] limit extends beyond Namespace RAM")
        live[slot] = {
            "location": location, "limit": limit, "sequence": sequence,
        }

    if SELF_SLOT not in live or THREAD_SLOT not in live:
        raise ValueError("Ascending Namespace requires self at slot 1 and entry Thread at slot 2")
    thread = live[THREAD_SLOT]
    if thread["sequence"] != 0 or thread["location"] >= total:
        raise ValueError("Entry Thread must be a resident version-0 body")
    if thread["location"] < table_words:
        raise ValueError("Entry Thread body overlaps the ascending table")
    thread_header = words[thread["location"]]
    thread_size = 1 << (((thread_header >> 23) & 15) + 6)
    thread_cw = (thread_header >> 10) & 8191
    if (thread_header >> 27 != 31 or ((thread_header >> 8) & 3) != 2
            or thread_size + thread["location"] > total
            or thread["limit"] < thread_size - 1):
        raise ValueError("NS[2] does not describe a complete in-range Thread LUMP")
    layout = boot.thread_layout(thread_size, thread_cw)
    if not layout["valid"]:
        raise ValueError("NS[2] Thread body has invalid stack/capability geometry")
    body_ranges.append((thread["location"], thread["location"] + thread_size, "Entry Thread"))

    entry_gt = words[thread["location"] + layout["caps_start"]]
    decoded = _decode_gt(entry_gt)
    if (entry_gt >> 31 or decoded["type"] != 1 or decoded["domain"] != 1
            or decoded["permissions"] != 0b100):
        raise ValueError("Entry Thread CR0 must contain an executable Inform GT")
    target = live.get(decoded["slot"])
    if (decoded["slot"] < 3 or target is None
            or decoded["sequence"] != target["sequence"]
            or target["location"] >= total):
        raise ValueError("Entry Thread CR0 does not bind to a live destination Namespace slot")
    target_header = words[target["location"]]
    if (target["location"] < table_words
            or target_header >> 27 != 31 or ((target_header >> 8) & 3) != 0):
        raise ValueError("Entry Thread CR0 target is not an ordinary in-range code LUMP")

    thread_rows = []
    for slot, entry in live.items():
        if slot in (SELF_SLOT, THREAD_SLOT):
            continue
        location, limit = entry["location"], entry["limit"]
        if location >= total:
            continue  # Explicit external/device address; no RAM body is claimed.
        lump_header = words[location]
        size = 1 << (((lump_header >> 23) & 15) + 6)
        cw, cc, typ = (lump_header >> 10) & 8191, lump_header & 255, (lump_header >> 8) & 3
        if lump_header >> 27 != 31 or location + size > total:
            raise ValueError(f"NS[{slot}] has an invalid LUMP header or allocation")
        if typ == 2:
            if limit < size - 1:
                raise ValueError(f"NS[{slot}] Thread limit does not cover its fresh allocation")
            body = words[location:location + size]
            _thread_words, target_fields, layout = _fresh_thread_words(
                struct.pack(f">{size}I", *body), f"NS[{slot}]")
            destination = live.get(target_fields["slot"])
            if (destination is None or target_fields["slot"] < 3
                    or destination["sequence"] != target_fields["sequence"]
                    or destination["location"] >= total):
                raise ValueError(
                    f"NS[{slot}] fresh Thread continuation does not bind to a live destination row")
            target_header = words[destination["location"]]
            target_size = 1 << (((target_header >> 23) & 15) + 6)
            target_cw = (target_header >> 10) & 8191
            if (target_header >> 27 != 31 or ((target_header >> 8) & 3) != 0
                    or target_cw == 0 or destination["location"] + target_size > total):
                raise ValueError(f"NS[{slot}] fresh Thread continuation target is not executable code")
            thread_rows.append({
                "slot": slot, "sequence": entry["sequence"],
                "entrySlot": target_fields["slot"],
                "entrySequence": target_fields["sequence"],
                "allocationWords": size,
                "stackWords": layout["stack_words"],
            })
            body_ranges.append((location, location + size, f"NS[{slot}] fresh Thread"))
            continue
        if typ != 0 or 1 + cw + cc > size or limit < cw:
            raise ValueError(f"NS[{slot}] is not a bounded ordinary executable LUMP")
        body_ranges.append((location, location + size, f"NS[{slot}] LUMP"))
        expected_self = boot.create_gt(entry["sequence"], slot, {"E": 1}, 1)
        if cc < 1 or words[location + size - cc] != expected_self:
            raise ValueError(f"NS[{slot}] LUMP C-list row zero is not its exact destination SELF GT")
        for index, gt in enumerate(words[location + size - cc:location + size]):
            fields = _decode_gt(gt)
            if fields["type"] != 1:
                continue
            destination = live.get(fields["slot"])
            if (gt >> 31 or fields["slot"] == 0 or destination is None
                    or destination["sequence"] != fields["sequence"]):
                raise ValueError(
                    f"NS[{slot}] C-list row {index} carries an absent or stale local Inform GT")

    body_ranges.sort()
    cursor = 0
    owned = []
    for start, end, label in body_ranges:
        if start < cursor:
            raise ValueError(f"{label} overlaps another allocated region")
        if any(words[cursor:start]):
            raise ValueError(f"Unowned nonzero image word at 0x{cursor:X}")
        cursor = end
        owned.append({"startWord": start, "endWord": end, "owner": label})
    if any(words[cursor:]):
        raise ValueError(f"Unowned nonzero image word at 0x{cursor:X}")

    return {
        "format": FORMAT,
        "baseWord": 0,
        "capacityWords": total,
        "slotCount": slots,
        "tableWords": table_words,
        "memberCount": member_count,
        "entryThread": {"slot": THREAD_SLOT, "sequence": 0, "gt": "02000002"},
        "cr15": {"word0": "02000001", "word1": 0,
                 "word2": table_words - 1, "word3": 0, "m": 1},
        "bootTarget": {"slot": decoded["slot"], "sequence": decoded["sequence"]},
        "threadRows": sorted(thread_rows, key=lambda row: row["slot"]),
        "liveSlots": sorted(live),
        "ownedRanges": owned,
        "hardwareCertified": False,
        "activationAllowed": False,
    }


def generate_image(state, config, lumps_dir, *, image_format, artifacts=None):
    """Generate and structurally validate a private image from explicit target rows.

    Rows must already use the new slot identities and exact selected artifacts.
    This routine does not migrate old rows or rewrite C-lists; stale bindings
    fail closed and must be recompiled/reapproved before a candidate can run.
    """
    if image_format != FORMAT or not isinstance(state, dict) or state.get("namespaceFormat") != FORMAT:
        raise ValueError(f"Input state and explicit selection must both be {FORMAT!r}")
    if not isinstance(config, dict) or not isinstance(config.get("step1"), dict):
        raise ValueError("New-format image generation requires explicit Step 1 geometry")
    step = config["step1"]
    total = _integer(step.get("totalNamespaceWords"), "totalNamespaceWords")
    slots = _integer(step.get("nsSlotsMax"), "nsSlotsMax")
    if (not MIN_WORDS <= total <= MAX_WORDS or total & (total - 1)
            or not 3 <= slots <= 0x1FFF or slots * ENTRY_WORDS > total):
        raise ValueError("Unsupported ascending Namespace capacity or slot count")
    rows = state.get("abstractions")
    if not isinstance(rows, list):
        raise ValueError("New-format Namespace abstractions must be a list")
    by_slot = {}
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("New-format Namespace row must be an object")
        slot = _integer(row.get("slot"), "Namespace slot")
        if slot == 0 or slot >= slots or slot in by_slot:
            raise ValueError("Slot 0 is metadata; other slots must be unique and in range")
        if row.get("archived") is True or row.get("symbolic") is True or row.get("implementationMissing") is True:
            raise ValueError(f"NS[{slot}] is not a live executable assignment")
        by_slot[slot] = dict(row)
    self_row, thread_row = by_slot.get(SELF_SLOT), by_slot.get(THREAD_SLOT)
    if not self_row or self_row.get("name") != "Boot.NS":
        raise ValueError("New-format target rows must assign Boot.NS self to slot 1")
    if (self_row.get("type") != "Inform" or self_row.get("filename")
            or _integer(self_row.get("location", 0), "NS[1] location") != 0
            or _integer(self_row.get("seq"), "NS[1] sequence") != 0):
        raise ValueError("NS[1] must be a version-0 Inform self descriptor at the Namespace base")
    if not thread_row or thread_row.get("name") != "Boot.Thread" or thread_row.get("type") != "Thread":
        raise ValueError("New-format target rows must assign the entry Thread to slot 2")
    if (_integer(thread_row.get("seq"), "NS[2] sequence") != 0
            or thread_row.get("filename")):
        raise ValueError("NS[2] entry Thread must be rebuilt as a fresh version-0 image")
    boot_rows = [row for slot, row in by_slot.items()
                 if slot >= 3 and row.get("boot") is True and row.get("backing") != "mmio"]
    if len(boot_rows) != 1:
        raise ValueError("Exactly one live executable row at slot 3 or above must be boot-selected")

    loaded = {}
    for slot, row in sorted(by_slot.items()):
        if slot in (SELF_SLOT, THREAD_SLOT) or row.get("backing") == "mmio":
            continue
        if row.get("type") not in ("Inform", "Resident", "Thread"):
            raise ValueError(f"NS[{slot}] requires an executable Inform/Resident/Thread LUMP")
        body, typ, cw, cc = _load_lump(row, lumps_dir, artifacts)
        sequence = _integer(row.get("seq"), f"NS[{slot}] sequence")
        if sequence > 511:
            raise ValueError(f"NS[{slot}] sequence is outside the 9-bit range")
        if row.get("type") == "Thread":
            binding = row.get("freshThreadImage")
            if not isinstance(binding, dict):
                raise ValueError(f"NS[{slot}] Thread requires an explicit fresh image binding")
            if (binding.get("format") != "fresh-thread-continuation-v1"
                    or _integer(binding.get("destinationSlot"), "Thread destination slot") != slot
                    or _integer(binding.get("destinationSequence"), "Thread destination sequence") != sequence):
                raise ValueError(f"NS[{slot}] fresh Thread image does not bind to its exact destination identity")
            ordinal_text = str(row.get("name", "")).removeprefix("Thread.")
            expected_entry_name = (
                "CapabilityTest" if ordinal_text.isdigit() and int(ordinal_text) <= 3
                else "SelfTest")
            if binding.get("entryName") != expected_entry_name:
                raise ValueError(
                    f"NS[{slot}] fresh Thread must explicitly target {expected_entry_name}")
            captest = next((candidate for candidate in by_slot.values()
                            if candidate.get("name") == expected_entry_name), None)
            if captest is None:
                raise ValueError(
                    f"NS[{slot}] fresh Thread has no destination {expected_entry_name} row")
            entry_slot = _integer(captest.get("slot"), f"{expected_entry_name} slot")
            entry_sequence = _integer(captest.get("seq"), f"{expected_entry_name} sequence")
            if (_integer(binding.get("entrySlot"), "Thread entry slot") != entry_slot
                    or _integer(binding.get("entrySequence"), "Thread entry sequence") != entry_sequence):
                raise ValueError(
                    f"NS[{slot}] fresh Thread has a stale {expected_entry_name} binding")
            expected = build_fresh_thread_lump(
                allocation_words=_integer(row.get("allocationWords"), "Thread allocationWords"),
                stack_words=_integer(row.get("stackWords"), "Thread stackWords"),
                entry_slot=entry_slot, entry_sequence=entry_sequence)
            actual = struct.pack(f">{len(body)}I", *body)
            if typ != 2 or actual != expected or _sha(actual) != binding.get("sha256"):
                raise ValueError(f"NS[{slot}] Thread bytes do not match the fresh destination initializer")
        else:
            if typ != 0 or cw < 1:
                raise ValueError(f"NS[{slot}] selected artifact is not an ordinary executable LUMP")
            expected_self = boot.create_gt(sequence, slot, {"E": 1}, 1)
            if cc < 1 or body[-cc] != expected_self:
                raise ValueError(
                    f"NS[{slot}] exact artifact must already contain its destination SELF GT; "
                    "recompile/reapprove rather than patching saved bytes")
        loaded[slot] = body

    memory = [0] * total
    table_words = slots * ENTRY_WORDS
    member_count = len(rows) - 1
    memory[:4] = [pack_namespace_word0(total, slots), 0, member_count, 0]
    _write_entry(memory, SELF_SLOT, 0, table_words - 1, 0)
    body_cursor = table_words
    live_rows = {SELF_SLOT}

    boot_row = boot_rows[0]
    boot_slot = _integer(boot_row["slot"], "boot target slot")
    boot_sequence = _integer(boot_row.get("seq"), "boot target sequence")
    if boot_sequence > 511:
        raise ValueError("Boot target sequence is outside the 9-bit range")
    entry_gt = boot.create_gt(boot_sequence, boot_slot, {"E": 1}, 1)
    thread_size = _integer(thread_row.get("allocationWords", step.get("threadLumpWords")),
                           "entry Thread allocationWords")
    stack_words = _integer(thread_row.get("stackWords", step.get("threadStackWords", 32)),
                           "entry Thread stackWords")
    layout = boot.thread_layout(thread_size, stack_words)
    if not layout["valid"]:
        raise ValueError("Entry Thread allocation/stack geometry is invalid")
    thread_body = [0] * thread_size
    thread_body[0] = boot.pack_lump_header(
        thread_size.bit_length() - 7, stack_words, boot.THREAD_CAP_WORDS, 2)
    sto = layout["stack_end"] - 2
    thread_body[boot.THREAD_STO_OFFSET] = (1 << 12) | sto
    thread_body[layout["caps_start"]] = entry_gt
    thread_body[sto + 1] = entry_gt
    thread_body[sto + 2] = (0x7FFF << 13) | (1 << 12) | layout["stack_end"]
    thread_location = body_cursor
    memory[thread_location:thread_location + thread_size] = thread_body
    body_cursor += thread_size
    _write_entry(memory, THREAD_SLOT, thread_location, thread_size - 1, 0)
    live_rows.add(THREAD_SLOT)

    for slot, row in sorted(by_slot.items()):
        if slot < 3:
            continue
        sequence = _integer(row.get("seq"), f"NS[{slot}] sequence")
        if not 0 <= sequence <= 511:
            raise ValueError(f"NS[{slot}] sequence is outside the 9-bit range")
        limit = _integer(row.get("limit"), f"NS[{slot}] limit")
        if limit > 0x1FFFFF:
            raise ValueError(f"NS[{slot}] limit exceeds the architecture field")
        if row.get("backing") == "mmio":
            location = _integer(row.get("location"), f"NS[{slot}] MMIO address")
            if location < total:
                raise ValueError(f"NS[{slot}] MMIO address must be outside Namespace RAM")
        else:
            body = loaded[slot]
            size = len(body)
            location = body_cursor
            memory[location:location + size] = body
            body_cursor += size
            if row.get("type") == "Thread":
                if limit < size - 1:
                    raise ValueError(f"NS[{slot}] limit does not cover its fresh Thread allocation")
            elif limit < ((body[0] >> 10) & 8191):
                raise ValueError(f"NS[{slot}] limit does not cover its executable code words")
        if body_cursor > total:
            raise ValueError("Ascending Namespace bodies exceed configured capacity")
        _write_entry(memory, slot, location, limit, sequence)
        live_rows.add(slot)

    if member_count != len(live_rows) - 1:
        raise ValueError("New-format member count must exclude only Namespace self slot 1")
    image = struct.pack(f"<{total}I", *memory)
    validation = validate_image(image, image_format=image_format)
    if validation["bootTarget"] != {"slot": boot_slot, "sequence": boot_sequence}:
        raise ValueError("Generated Thread CR0 differs from the explicit boot selection")
    return image, {
        **validation,
        "purpose": "private-new-format-candidate",
        "imageSha256": _sha(image),
        "hardwareCertified": False,
        "approvalEligible": False,
        "activationAllowed": False,
    }
