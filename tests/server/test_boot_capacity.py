"""Isolated read-only capacity geometry; no live boot state is rewritten."""
import hashlib
import json
import struct
import zlib

import pytest

from server import boot_capacity


def _fixture(tmp_path, monkeypatch, *, size=128, thread=False, second=False):
    # Replace only external boot validation in this small deterministic
    # geometry fixture; the production report still calls the real validators.
    monkeypatch.setattr(boot_capacity.boot_image, "validate_boot_image",
                        lambda _image, *, check_layout=True: None)
    monkeypatch.setattr(boot_capacity.boot_image, "validate_resident_boot_profile",
                        lambda _: None)
    monkeypatch.setattr(boot_capacity.boot_image, "namespace_boot_marker_slot",
                        lambda _: 2)
    monkeypatch.setattr(boot_capacity.boot_image, "read_namespace_header_info",
                        lambda _: {"table_offset_words": 1024, "slot_count": 64})
    total = 1280
    image = [0] * total
    rows = []
    for slot, location in ([(1, 16)] if not second else [(1, 16), (2, 300)]):
        typ = 2 if thread else 0
        cw, cc = (32, 12) if thread else (2, 1)
        header = ((31 << 27) | ((size.bit_length() - 7) << 23)
                  | (cw << 10) | (typ << 8) | cc)
        image[location] = header
        image[total - (slot + 1) * 4] = location
        image[total - (slot + 1) * 4 + 1] = size - 1
        row = {"slot": slot, "name": "Fixture%d" % slot, "resident": True,
               "location": hex(location), "limit": hex(size - 1), "lump_version": 4}
        if not thread:
            raw = struct.pack(">%dI" % size, header, *([0] * (size - 1)))
            name = "fixture%d.lump" % slot
            (tmp_path / name).write_bytes(raw)
            row.update({"filename": name, "token": "%08x" % slot,
                        "binary_hash": hashlib.sha256(raw).hexdigest()})
        rows.append(row)
    raw_image = struct.pack("<%dI" % total, *image)
    (tmp_path / "boot-image.provenance.json").write_text(json.dumps({
        "namespace_fingerprint": boot_capacity.boot_image.namespace_fingerprint(rows),
        "image_sha256": hashlib.sha256(raw_image).hexdigest(),
    }))
    return rows, raw_image


def test_valid_exact_saved_geometry_and_unclassified_not_padding(tmp_path, monkeypatch):
    rows, image = _fixture(tmp_path, monkeypatch)
    before = (tmp_path / "fixture1.lump").read_bytes()
    report = boot_capacity.capacity_report(rows, image, str(tmp_path))
    assert report["trusted"] and report["freeWords"] == 1280 - 256 - 16 - 128
    assert report["largestFreeWords"] == 1024 - (16 + 128)
    assert report["rows"][0]["allocatedWords"] == 128
    assert report["rows"][0]["savedAllocationWords"] == 128
    assert report["reservedRanges"] == [
        {"name": "Namespace header", "locationWord": 0, "allocatedWords": 16},
        {"name": "Namespace table", "locationWord": 1024, "allocatedWords": 256},
    ]
    assert sum(part["allocatedWords"] for part in report["reservedRanges"]) == report["reservedWords"]
    assert report["allocatedWords"] == report["reservedWords"] + report["rows"][0]["allocatedWords"]
    assert report["rows"][0]["paddingWords"] is None
    assert report["rows"][0]["unclassifiedWords"] == 124
    assert before == (tmp_path / "fixture1.lump").read_bytes()


def test_thread_heap_and_stack_are_in_body_not_additional_free(tmp_path, monkeypatch):
    rows, image = _fixture(tmp_path, monkeypatch, size=256, thread=True)
    report = boot_capacity.capacity_report(rows, image, str(tmp_path))
    assert report["trusted"]
    assert report["rows"][0]["threadHeapWords"] == 194
    assert report["rows"][0]["threadStackWords"] == 32
    assert report["rows"][0]["paddingWords"] == 0
    assert report["allocatedWords"] == 256 + 16 + 256


def test_complete_content_frame_counts_only_confirmed_zero_tail(tmp_path, monkeypatch):
    rows, image = _fixture(tmp_path, monkeypatch)
    name = tmp_path / rows[0]["filename"]
    data = bytearray(name.read_bytes())
    struct.pack_into(">I", data, 3 * 4, 0xAB000004)
    struct.pack_into(">I", data, 4 * 4, 0x7B7D2020)
    name.write_bytes(data)
    rows[0]["binary_hash"] = hashlib.sha256(data).hexdigest()
    item = boot_capacity.capacity_report(rows, image, str(tmp_path))["rows"][0]
    assert item["paddingWords"] == 122
    assert item["unclassifiedWords"] == 0
    struct.pack_into(">I", data, 5 * 4, 0x1234)
    name.write_bytes(data)
    rows[0]["binary_hash"] = hashlib.sha256(data).hexdigest()
    item = boot_capacity.capacity_report(rows, image, str(tmp_path))["rows"][0]
    assert item["paddingWords"] is None
    assert item["unclassifiedWords"] == 124
    struct.pack_into(">I", data, 4 * 4, 0xDEADBEEF)
    name.write_bytes(data)
    rows[0]["binary_hash"] = hashlib.sha256(data).hexdigest()
    assert boot_capacity.capacity_report(rows, image, str(tmp_path))[
        "rows"][0]["savedPaddingWords"] is None


def test_source_length_and_compression_follow_content_frame_contract(tmp_path, monkeypatch):
    rows, image = _fixture(tmp_path, monkeypatch)
    name = tmp_path / rows[0]["filename"]
    data = bytearray(name.read_bytes())
    compressor = zlib.compressobj(wbits=-15)
    source = compressor.compress(b"abc") + compressor.flush()
    struct.pack_into(">I", data, 3 * 4, 0xAB050004)
    struct.pack_into(">I", data, 4 * 4, 0x7B7D2020)
    struct.pack_into(">I", data, 5 * 4, len(source))
    data[6 * 4:6 * 4 + len(source)] = source
    name.write_bytes(data)
    rows[0]["binary_hash"] = hashlib.sha256(data).hexdigest()
    assert boot_capacity.capacity_report(rows, image, str(tmp_path))[
        "rows"][0]["savedPaddingWords"] == 128 - (6 + (len(source) + 3) // 4) - 1
    struct.pack_into(">I", data, 5 * 4, 500)
    name.write_bytes(data)
    rows[0]["binary_hash"] = hashlib.sha256(data).hexdigest()
    assert boot_capacity.capacity_report(rows, image, str(tmp_path))[
        "rows"][0]["savedPaddingWords"] is None


def test_invalid_image_still_lists_hash_verified_saved_cost(tmp_path, monkeypatch):
    rows, image = _fixture(tmp_path, monkeypatch)
    def invalid(_image, *, check_layout=True):
        raise ValueError("invalid boot image")
    monkeypatch.setattr(boot_capacity.boot_image, "validate_boot_image", invalid)
    report = boot_capacity.capacity_report(rows, image, str(tmp_path))
    assert not report["trusted"] and report["allocatedWords"] is None
    assert report["reservedRanges"] == []
    assert report["rows"][0]["savedAllocationWords"] == 128
    assert report["rows"][0]["allocatedWords"] is None
    assert report["rows"][0]["savedPaddingWords"] is None


def test_invalid_layout_retains_verified_installed_size(tmp_path, monkeypatch):
    rows, image = _fixture(tmp_path, monkeypatch)
    def layout_only(_image, *, check_layout=True):
        if check_layout:
            raise ValueError("overlapping bodies")
    monkeypatch.setattr(boot_capacity.boot_image, "validate_boot_image", layout_only)
    report = boot_capacity.capacity_report(rows, image, str(tmp_path))
    assert not report["trusted"]
    assert report["freeWords"] is None
    assert report["rows"][0]["savedAllocationWords"] == 128
    assert report["rows"][0]["allocatedWords"] == 128
    assert any("overlapping bodies" in warning for warning in report["warnings"])


def test_negative_slot_is_never_used_to_index_a_descriptor(tmp_path, monkeypatch):
    rows, image = _fixture(tmp_path, monkeypatch)
    rows.append({"slot": -1, "resident": True, "name": "Bad"})
    report = boot_capacity.capacity_report(rows, image, str(tmp_path))
    assert not report["trusted"]
    assert any("invalid Namespace slot" in warning for warning in report["warnings"])
    assert all(item["slot"] >= 0 for item in report["rows"])


@pytest.mark.parametrize("change", ["overlap", "outside", "missing", "symbolic",
                                    "stale_location", "hash"])
def test_uncertain_or_invalid_state_suppresses_capacity(tmp_path, monkeypatch, change):
    rows, image = _fixture(tmp_path, monkeypatch, second=change == "overlap")
    words = list(struct.unpack("<1280I", image))
    if change == "overlap":
        rows[1]["location"] = hex(100)
        words[1280 - (2 + 1) * 4] = 100
        words[100] = words[300]
    elif change == "outside":
        words[16] = words[16] | (3 << 23)  # 128 -> 1024, extends beyond table
    elif change == "missing":
        (tmp_path / "fixture1.lump").unlink()
    elif change == "symbolic":
        rows[0].update(symbolic=True, implementationMissing=True)
    elif change == "stale_location":
        rows[0]["location"] = "0x25"
    elif change == "hash":
        rows[0]["binary_hash"] = "a" * 64
    report = boot_capacity.capacity_report(
        rows, struct.pack("<1280I", *words), str(tmp_path))
    assert not report["trusted"] and report["warnings"]
    assert report["freeWords"] is None and report["largestFreeWords"] is None


def test_advisory_only_on_wukong_sized_window(tmp_path, monkeypatch):
    rows, image = _fixture(tmp_path, monkeypatch)
    assert not boot_capacity.capacity_report(rows, image, str(tmp_path),
        target_board="wukong-xc7a100t")["advisory"]["applies"]
    assert not boot_capacity.capacity_report([], bytes(16384 * 4), str(tmp_path))[
        "advisory"]["applies"]
    assert boot_capacity.capacity_report([], bytes(16384 * 4), str(tmp_path),
        target_board="wukong-xc7a100t")[
        "advisory"]["applies"]


def test_all_assignments_and_mmio_are_visible_without_ram_claims(tmp_path, monkeypatch):
    rows, image = _fixture(tmp_path, monkeypatch)
    rows.extend([
        {"slot": 13, "name": "M_BIT_DEV", "location": "0xFFFFFF1C"},
        {"slot": 15, "name": "ide.Design", "location": "0x0",
         "symbolic": True, "implementationMissing": True},
        {"slot": 16, "name": "ide.Unverified", "load_policy": "Lazy"},
    ])
    report = boot_capacity.capacity_report(rows, image, str(tmp_path))
    mapped = {row["slot"]: row for row in report["rows"]}
    assert set(mapped) == {1, 13, 15, 16}
    assert mapped[13]["physicalByteAddress"] == 0xFFFFFF1C
    assert mapped[13]["ramWords"] == 0
    assert mapped[13]["allocatedWords"] is None
    assert mapped[15]["entryKind"] == "design"
    assert mapped[16]["allocatedWords"] is None


def test_mismatch_retains_full_overlap_evidence_and_exact_header_fields(tmp_path, monkeypatch):
    rows, image = _fixture(tmp_path, monkeypatch, second=True)
    words = list(struct.unpack("<1280I", image))
    words[1280 - 12] = 100
    words[100] = words[300] + (1 << 10)
    rows[1]["location"] = hex(100)
    report = boot_capacity.capacity_report(rows, struct.pack("<1280I", *words), str(tmp_path))
    mismatch = report["rows"][1]
    assert mismatch["allocatedWords"] is None
    assert mismatch["imageEvidence"]["allocatedWords"] == 128
    assert "code words=2" in mismatch["status"]
    assert "code words=3" in mismatch["status"]
    assert any("0x64–0x8F" in warning for warning in report["warnings"])
    assert report["freeWords"] is None


def test_symbolic_executable_contradiction_is_not_normalized(tmp_path, monkeypatch):
    rows, image = _fixture(tmp_path, monkeypatch)
    rows[0].update(symbolic=True, implementationMissing=True)
    report = boot_capacity.capacity_report(rows, image, str(tmp_path))
    assert "Contradictory Namespace assignment" in report["rows"][0]["status"]
    assert rows[0]["resident"] is True and rows[0]["filename"]


def test_stale_namespace_fingerprint_never_claims_current_installation(tmp_path, monkeypatch):
    rows, image = _fixture(tmp_path, monkeypatch)
    rows[0]["name"] = "ide.NewApprovedName"
    report = boot_capacity.capacity_report(rows, image, str(tmp_path))
    assert not report["imageMatchesNamespaceRevision"]
    assert not report["trusted"]
    assert report["freeWords"] is None
    assert not report["rows"][0]["imageEvidence"]["verifiedSelection"]
    assert report["rows"][0]["name"] == "ide.NewApprovedName"


def test_devices_are_not_ram_and_bad_device_assignment_is_current(tmp_path, monkeypatch):
    rows, image = _fixture(tmp_path, monkeypatch)
    for slot in (2, 3, 4, 5):
        address, limit = boot_capacity.boot_image._MMIO_SLOT_SPECS[slot]
        rows.append(dict(slot=slot, name="Device", location=hex(address), limit=hex(limit)))
    report = boot_capacity.capacity_report(rows, image, str(tmp_path))
    assert all(r["entryKind"] == "mmio" for r in report["rows"][1:])
    assert not any("Missing or invalid committed image location" in w for w in report["warnings"])
    rows[-1]["limit"] = "0xFFFF"
    report = boot_capacity.capacity_report(rows, image, str(tmp_path))
    assert any("I/O limit" in w for w in report["namespaceWarnings"])
    assert not any("I/O limit" in w for w in report["imageWarnings"])


def test_dormant_body_cost_is_not_an_installed_body(tmp_path, monkeypatch):
    rows, image = _fixture(tmp_path, monkeypatch)
    dormant = dict(rows[0], slot=8, name="Tunnel", location="0x200", limit="0x3f", resident=False)
    rows.append(dormant)
    words = list(struct.unpack("<1280I", image))
    words[1280 - 9 * 4] = 512
    words[1280 - 9 * 4 + 1] = 63
    report = boot_capacity.capacity_report(rows, struct.pack("<1280I", *words), str(tmp_path))
    item = report["rows"][-1]
    assert item["entryKind"] == "unselected"
    assert item["savedAllocationWords"] == 128
    assert item["allocatedWords"] is None
    assert not any("NS[8]" in w for w in report["warnings"])
    assert any(r["name"] == "NS[8] old-image reservation" and r["allocatedWords"] == 64
               for r in report["reservedRanges"])


def test_saved_conflicts_are_separate_from_old_image_and_do_not_need_token(tmp_path, monkeypatch):
    rows, image = _fixture(tmp_path, monkeypatch)
    rows.append(dict(rows[0], slot=14, name="Alice"))
    rows[-1].pop("token")
    config = {"step1": {"threadLumpWords": 128, "totalNamespaceWords": 1280, "nsSlotsMax": 64}}
    report = boot_capacity.capacity_report(rows, image, str(tmp_path), config=config)
    assert any("NS[14] Alice" in w and "overlaps" in w for w in report["namespaceWarnings"])
    assert report["rows"][-1]["savedAllocationWords"] == 128
    assert any("Stored image is not proven" in w for w in report["imageWarnings"])
    assert not report["trusted"] and report["freeWords"] is None


def test_duplicate_image_overlap_is_one_diagnostic(tmp_path, monkeypatch):
    rows, image = _fixture(tmp_path, monkeypatch, second=True)
    rows[1]["location"] = "0x40"
    words = list(struct.unpack("<1280I", image))
    words[64] = words[300]
    words[1280 - 3 * 4] = 64
    def validate(_, *, check_layout=True):
        if check_layout:
            raise ValueError("validate_boot_image: NS slot 1 [16, 144) overlaps NS slot 2 [64, 192)")
    monkeypatch.setattr(boot_capacity.boot_image, "validate_boot_image", validate)
    report = boot_capacity.capacity_report(rows, struct.pack("<1280I", *words), str(tmp_path))
    assert len([w for w in report["imageWarnings"] if "overlap" in w.lower()]) == 1
    assert report["freeWords"] is None