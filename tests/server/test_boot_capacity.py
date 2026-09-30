"""Isolated read-only capacity geometry; no live boot state is rewritten."""
import hashlib
import struct
import zlib

import pytest

from server import boot_capacity


def _fixture(tmp_path, monkeypatch, *, size=128, thread=False, second=False):
    # Replace only external boot validation in this small deterministic
    # geometry fixture; the production report still calls the real validators.
    monkeypatch.setattr(boot_capacity.boot_image, "validate_boot_image", lambda _: None)
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
    return rows, struct.pack("<%dI" % total, *image)


def test_valid_exact_saved_geometry_and_unclassified_not_padding(tmp_path, monkeypatch):
    rows, image = _fixture(tmp_path, monkeypatch)
    before = (tmp_path / "fixture1.lump").read_bytes()
    report = boot_capacity.capacity_report(rows, image, str(tmp_path))
    assert report["trusted"] and report["freeWords"] == 1280 - 256 - 16 - 128
    assert report["largestFreeWords"] == 1024 - (16 + 128)
    assert report["rows"][0]["allocatedWords"] == 128
    assert report["rows"][0]["savedAllocationWords"] == 128
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
    def invalid(_image):
        raise ValueError("invalid boot image")
    monkeypatch.setattr(boot_capacity.boot_image, "validate_boot_image", invalid)
    report = boot_capacity.capacity_report(rows, image, str(tmp_path))
    assert not report["trusted"] and report["allocatedWords"] is None
    assert report["rows"][0]["savedAllocationWords"] == 128
    assert report["rows"][0]["allocatedWords"] is None
    assert report["rows"][0]["savedPaddingWords"] is None


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