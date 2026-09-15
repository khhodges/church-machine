import copy
import json
import shutil
import struct

import pytest

from server.boot_image import (
    RESIDENT_BOOT_PROFILE,
    RESIDENT_BOOT_PROFILE_NAME,
    generate_boot_image,
    parse_ns_table,
    validate_resident_boot_profile,
)


def _state_rows():
    with open("server/lumps/ns-state.json", encoding="utf-8") as source:
        return json.load(source)["abstractions"]


def test_profile_has_exact_core_map_and_current_state_matches():
    assert RESIDENT_BOOT_PROFILE_NAME == "three-lump-core-v1"
    assert RESIDENT_BOOT_PROFILE["residents"] == {
        "SelfTest": 6,
        "WukongCallHome": 7,
        "CapabilityTest": 10,
    }
    rows = validate_resident_boot_profile(
        _state_rows(), RESIDENT_BOOT_PROFILE_NAME)
    assert {rows[slot]["name"] for slot in (6, 7, 10)} == {
        "SelfTest", "WukongCallHome", "CapabilityTest"
    }
    assert rows[1]["name"] == "Boot.Thread"
    assert rows[11]["name"] == "Thread.2"
    assert rows[12]["name"] == "Thread.3"
    assert rows[8]["name"] == "Tunnel"
    assert rows[9]["name"] == "Ethernet"


@pytest.mark.parametrize("mutation", ["missing", "duplicate", "extra"])
def test_profile_rejects_ambiguous_resident_selection(mutation):
    rows = copy.deepcopy(_state_rows())
    if mutation == "missing":
        rows = [row for row in rows if row.get("slot") != 7]
    elif mutation == "duplicate":
        rows.append(copy.deepcopy(next(row for row in rows if row.get("slot") == 7)))
    else:
        rows.append({
            "name": "Tunnel",
            "slot": 8,
            "type": "Inform",
            "resident": True,
            "boot_resident": True,
        })
    with pytest.raises(ValueError):
        validate_resident_boot_profile(rows, RESIDENT_BOOT_PROFILE_NAME)


def test_profile_generation_embeds_all_three_current_bodies(tmp_path):
    source = "server/lumps"
    lumps = tmp_path / "lumps"
    shutil.copytree(source, lumps)
    with open("server/boot-config.json", encoding="utf-8") as source_cfg:
        cfg = json.load(source_cfg)
    image = generate_boot_image(
        cfg, str(lumps), boot_entry_slot=cfg["bootEntrySlot"],
        require_entry_resident=True,
    )
    words = struct.unpack(f"<{len(image) // 4}I", image)
    rows = {row["slot"]: row for row in parse_ns_table(image)}
    for slot in (6, 7, 10):
        state_row = next(row for row in _state_rows() if row["slot"] == slot)
        with open(lumps / state_row["filename"], "rb") as artifact:
            header = struct.unpack(">I", artifact.read(4))[0]
        assert words[rows[slot]["location"]] == header