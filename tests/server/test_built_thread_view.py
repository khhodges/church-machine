"""Independent heterogeneous Thread images, without touching live artifacts."""
import struct

from server.built_thread_view import inspect_threads


def fixture():
    words = [0] * 2048
    entries = [
        {"slot": 1, "name": "Alice.Thread", "w0": 16, "w1": 255},
        {"slot": 11, "name": "Mallory.Thread", "w0": 512, "w1": 511},
        {"slot": 20, "name": "Alice", "w0": 1200, "w1": (3 << 21) | 63},
        {"slot": 21, "name": "Mallory", "w0": 1300, "w1": (4 << 21) | 63},
    ]
    for base, size, stack in [(16, 256, 32), (512, 512, 64)]:
        n = size.bit_length() - 1 - 6
        words[base] = (31 << 27) | (n << 23) | (stack << 10) | (2 << 8) | 12
    words[16 + 18] = 0xA11CE
    words[512 + 18] = 0xBAD
    words[512 + 19] = 0xBEEF
    words[16 + 244 + 1] = 0x4A000000 | (3 << 16) | 20
    words[512 + 500 + 1] = 0x4A000000 | (4 << 16) | 21
    return words, entries


def inspect(words, entries):
    return inspect_threads(struct.pack(f"<{len(words)}I", *words), entries, 2000)


def test_each_thread_has_own_layout_heap_and_initialized_gts():
    words, entries = fixture()
    a, m = inspect(words, entries)
    assert [(t["slot"], t["sizeWords"], t["stackWords"]) for t in (a, m)] == [
        (1, 256, 32), (11, 512, 64)]
    assert a["heap"]["words"] == 194
    assert m["heap"]["words"] == 418
    assert a["heap"]["initialWords"][:2] == [0xA11CE, 0]
    assert m["heap"]["initialWords"][:2] == [0xBAD, 0xBEEF]
    assert a["capabilities"][1]["targetName"] == "Alice"
    assert m["capabilities"][1]["targetName"] == "Mallory"
    assert a["capabilities"][1]["address"] == 16 + 245
    assert m["capabilities"][1]["address"] == 512 + 501
    assert a["heap"]["definitionsStatus"] == "not-recorded"
    assert len(a["capabilities"]) == 12
    assert a["capabilities"][0]["targetStatus"] == "null"
    assert a["runtimeRegisters"] == [12, 13, 14, 15]
    for t in (a, m):
        assert sum(z["words"] for z in t["zones"]) == t["sizeWords"]


def test_names_are_optional_and_no_fixed_thread_slot_or_count():
    words, entries = fixture()
    entries[0].update(slot=42, name=None)
    entries[1].update(slot=50, name=None)
    entries[2]["name"] = None
    threads = inspect(words, entries)
    assert [t["slot"] for t in threads] == [42, 50]
    assert threads[0]["capabilities"][1]["targetStatus"] == "name-unavailable"


def test_invalid_geometry_does_not_read_adjacent_thread():
    words, entries = fixture()
    words[16] = (31 << 27) | (2 << 23) | (255 << 10) | (2 << 8)
    a, m = inspect(words, entries)
    assert a["error"] and not a["capabilities"] and a["heap"] is None
    assert m["heap"]["initialWords"][0] == 0xBAD


def test_descriptor_limit_and_image_bounds_prevent_cross_object_reads():
    words, entries = fixture()
    entries[0]["w1"] = 127
    entries[1]["w0"] = 1800
    words[1800] = words[512]
    a, m = inspect(words, entries)
    assert a["error"] and m["error"]
    assert a["heap"] is None and m["heap"] is None


def test_stale_or_missing_target_never_gets_an_unrelated_name():
    words, entries = fixture()
    entries[2]["w1"] = 4 << 21
    entries.pop()
    a, m = inspect(words, entries)
    assert a["capabilities"][1]["targetStatus"] == "generation-mismatch"
    assert m["capabilities"][1]["targetStatus"] == "slot-missing"
    assert a["capabilities"][1]["targetName"] is None
    assert m["capabilities"][1]["targetName"] is None


def test_abstract_and_outform_tokens_not_misread_as_local_slots():
    words, entries = fixture()
    for typ in (2, 3):
        words[16 + 245] = (typ << 25) | 20
        cap = inspect(words, entries)[0]["capabilities"][1]
        assert cap["targetStatus"] == "not-resolved"
        assert cap["targetSlot"] is None and cap["targetName"] is None


def test_device_addresses_and_nonthread_bodies_are_not_threads():
    words, entries = fixture()
    entries += [{"slot": 2, "name": "Fake.Thread", "w0": 0x40000014, "w1": 2}]
    assert len(inspect(words, entries)) == 2
