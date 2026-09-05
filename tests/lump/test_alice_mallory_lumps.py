import hashlib
import json
import os
import struct
import subprocess


ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
LUMPS = os.path.join(ROOT, "server", "lumps")


def _manifest_records():
    with open(os.path.join(LUMPS, "manifest.json")) as fh:
        manifest = json.load(fh)
    return {row.get("dot_name"): row for row in manifest
            if row.get("dot_name") in {"ide.Alice", "ide.Mallory"}}


def _read_words(filename):
    raw = open(os.path.join(LUMPS, filename), "rb").read()
    return raw, list(struct.unpack(f">{len(raw) // 4}I", raw))


def _frame(words):
    header = words[0]
    cw = (header >> 10) & 0x1FFF
    start = 1 + cw
    frame_header = words[start]
    assert frame_header >> 24 == 0xAB
    assert (frame_header >> 16) & 0xFF == 0x03
    api_len = frame_header & 0xFFFF
    api_words = (api_len + 3) // 4
    api_raw = struct.pack(f">{api_words}I", *words[start + 1:start + 1 + api_words])
    api = json.loads(api_raw[:api_len].decode())
    source_len_at = start + 1 + api_words
    source_len = words[source_len_at]
    source_words = (source_len + 3) // 4
    source_raw = struct.pack(
        f">{source_words}I",
        *words[source_len_at + 1:source_len_at + 1 + source_words])
    return api, source_raw[:source_len].decode(), source_len_at + 1 + source_words


def test_alice_mallory_releases_are_atomic_canonical_and_dynamic():
    records = _manifest_records()
    assert set(records) == {"ide.Alice", "ide.Mallory"}
    for dot_name, record in records.items():
        assert record["ns_slot"] is None
        assert record["ns_slot_policy"] == "dynamic"
        assert record["boot_resident"] is False
        raw, words = _read_words(record["filename"])
        number = hashlib.sha256(dot_name.encode() + raw).hexdigest()[:8]
        assert record["token"] == number
        assert record["filename"] == f"{dot_name}.1.{number}.lump"
        assert record["binary_hash"] == hashlib.sha256(raw).hexdigest()


def test_embedded_api_source_zero_fill_and_tail_clist():
    for dot_name, record in _manifest_records().items():
        _, words = _read_words(record["filename"])
        header = words[0]
        size = 1 << (((header >> 23) & 0xF) + 6)
        cc = header & 0xFF
        api, source, content_end = _frame(words)
        assert api["name"] == dot_name
        assert all({"petName", "branchOffset", "in", "out"} <= set(method)
                   for method in api["methods"])
        assert "token" not in api and "issue" not in api
        source_file = "alice.cloomc" if dot_name == "ide.Alice" else "mallory.cloomc"
        assert source == open(os.path.join(ROOT, "simulator", "examples", source_file)).read()
        assert all(word == 0 for word in words[content_end:size - cc])
        assert words[size - cc] == 0xFEED5E1F
        assert words[size - 1] == 0xFEEDDA7A


def test_builder_is_reproducible_and_runtime_behavior_passes():
    subprocess.run(
        ["node", "scripts/build_alice_mallory_lumps.js"],
        cwd=ROOT, check=True, capture_output=True, text=True)
    subprocess.run(
        ["node", "simulator/test_alice_mallory_lumps.js"],
        cwd=ROOT, check=True, capture_output=True, text=True)