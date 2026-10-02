"""Namespace byte/layout authority is independent of IDE lookup metadata."""
import copy
import hashlib
import json
import struct

import pytest

from server.simulation_preparation import stage_image, validate_simulation_executable
from test_preparation import saved, snapshot


def with_alice(saved):
    root, rows, cfg = saved
    rows[-1].update(location="0x1000", token="12345678")
    words = [(31 << 27) | (2 << 23) | (8 << 10) | 1] + [0] * 254 + [0x4A00000E]
    raw = struct.pack(">256I", *words)
    row = dict(slot=14, name="ide.Alice", type="Inform", seq=0,
               filename="ide.Alice.1.a91d33f7.lump", token="4730c311",
               binary_hash=hashlib.sha256(raw).hexdigest(),
               resident=True, load_policy="Resident", location="0x1800")
    (root / row["filename"]).write_bytes(raw)
    rows.append(row)
    (root / "ns-state.json").write_text(json.dumps({"abstractions": rows}))
    return root, rows, cfg, raw


@pytest.mark.parametrize("manifest", ["[]", "not JSON", '[{"filename":"latest.lump","archived":true}]'])
def test_lookup_tokens_and_catalog_do_not_override_saved_bytes_and_locations(saved, manifest):
    root, rows, cfg, raw = with_alice(saved)
    (root / "manifest.json").write_text(manifest)
    original, files = copy.deepcopy(rows), snapshot(root)
    assert validate_simulation_executable(root / rows[-1]["filename"], root, "Alice")[-1] == 0x4A00000E
    image, prepared, bindings = stage_image(cfg, rows, root, 6)
    words = struct.unpack(f"<{len(image)//4}I", image)
    assert words[-15 * 4] == 0x1800
    assert words[-15 * 4 + 3] == 0x4A00000E
    assert words[-7 * 4] == 0x1000
    assert words[0x1800:0x1900] == struct.unpack(">256I", raw)
    assert prepared[-1]["token"] == "4730c311"
    assert bindings[-1]["token"] == "4730c311"
    assert prepared[-1]["simulationBinding"]["localSelfGT"] == "4a00000e"
    assert rows == original and snapshot(root) == files


@pytest.mark.parametrize("location,reason", [
    ("0x1000", "overlaps NS"), ("0x0", "reserved header"),
    ("0x3f00", "bounds"), ("invalid", "word address"),
])
def test_invalid_explicit_layout_never_silently_relocated(saved, location, reason):
    root, rows, cfg, _ = with_alice(saved)
    rows[-1]["location"] = location
    before = copy.deepcopy(rows), snapshot(root)
    with pytest.raises(ValueError, match=reason):
        stage_image(cfg, rows, root, 6)
    assert (rows, snapshot(root)) == before


@pytest.mark.parametrize("defect", ["hash", "header", "self"])
def test_real_binary_failures_still_rejected(saved, defect):
    root, rows, cfg, raw = with_alice(saved)
    words = list(struct.unpack(">256I", raw))
    if defect == "header":
        words[0] = 0
    elif defect == "self":
        words[-1] = 0x4A00000F
    else:
        words[2] = 1
    changed = struct.pack(">256I", *words)
    (root / rows[-1]["filename"]).write_bytes(changed)
    if defect != "hash":
        rows[-1]["binary_hash"] = hashlib.sha256(changed).hexdigest()
    before = snapshot(root)
    with pytest.raises(ValueError, match="hash mismatch|header|SELF"):
        stage_image(cfg, rows, root, 6)
    assert snapshot(root) == before


@pytest.mark.parametrize("lookup", [None, "obsolete-ide-label"])
def test_runtime_does_not_require_catalog_lookup_or_catalog_filename(saved, lookup):
    root, rows, cfg, raw = with_alice(saved)
    row = rows[-1]
    (root / "Alice.lump").write_bytes(raw)
    row["filename"] = "Alice.lump"
    if lookup is None:
        row.pop("token")
    else:
        row["token"] = lookup
    before = copy.deepcopy(rows), snapshot(root)
    image, prepared, bindings = stage_image(cfg, rows, root, 6)
    words = struct.unpack(f"<{len(image)//4}I", image)
    assert words[-15 * 4 + 3] == 0x4A00000E
    assert bindings[-1]["token"] == lookup
    assert prepared[-1].get("token") == lookup
    assert (rows, snapshot(root)) == before


def test_explicit_generated_thread_and_header_layout(saved):
    root, rows, cfg, _ = with_alice(saved)
    cfg["step1"]["threadCount"] = 2
    rows[1]["location"] = "0x20"
    rows.append(dict(slot=11, name="Thread.2", type="Thread", seq=5, location="0x2000"))
    before = copy.deepcopy(rows), snapshot(root)
    image, _, _ = stage_image(cfg, rows, root, 6)
    words = struct.unpack(f"<{len(image)//4}I", image)
    assert words[-8] == 0x20
    assert words[-48] == 0x2000
    assert (words[-47] >> 21) & 511 == 5
    assert (rows, snapshot(root)) == before
    rows[0]["location"] = "0x400"
    with pytest.raises(ValueError, match="architectural header"):
        stage_image(cfg, rows, root, 6)


@pytest.mark.parametrize("thread_count", [1, 2])
def test_absent_catalog_has_no_allocation_or_descriptor(saved, thread_count):
    from server import boot_image

    root, rows, cfg, raw = with_alice(saved)
    cfg["step1"]["threadCount"] = thread_count
    # Root Thread occupies [0x10,0x110). This next region is free in the
    # saved Namespace, although the historical hardware catalog reserves it.
    rows[1]["location"] = "0x10"
    rows[-1]["location"] = "0x110"
    before = copy.deepcopy(rows), snapshot(root)
    image, prepared, _ = stage_image(cfg, rows, root, 6)
    words = struct.unpack(f"<{len(image)//4}I", image)
    present = {
        slot for slot in range(cfg["step1"]["nsSlotsMax"])
        if any(words[len(words) - (slot + 1) * 4:len(words) - slot * 4])
    }
    assert present == ({0, 1, 6, 14} | ({11} if thread_count == 2 else set()))
    assert words[-60] == 0x110
    assert words[0x110:0x210] == struct.unpack(">256I", raw)
    assert prepared[-1]["location"] == "0x00000110"
    boot_image.validate_boot_image(image, simulation_only=True)
    # Private Namespace admission must not weaken hardware certification.
    with pytest.raises(ValueError, match="mandatory NS slot 2"):
        boot_image.validate_boot_image(image)
    assert (rows, snapshot(root)) == before