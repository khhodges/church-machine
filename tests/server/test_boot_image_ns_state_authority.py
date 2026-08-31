import json

from server.boot_image import _load_boot_resident_entries, _load_ns_state_token_map


def _write(path, value):
    path.write_text(json.dumps(value), encoding="utf-8")


def test_rich_ns_state_does_not_infer_missing_token_from_files(tmp_path):
    _write(tmp_path / "ns-state.json", {
        "abstractions": [{"name": "CapabilityTest", "slot": 10, "type": "Inform"}]
    })
    (tmp_path / "CapabilityTest.1.deadbeef.lump").write_bytes(b"\0" * 256)

    assert _load_ns_state_token_map(str(tmp_path)) == {}


def test_resident_binding_comes_exactly_from_ns_state_not_manifest(tmp_path):
    _write(tmp_path / "ns-state.json", {
        "abstractions": [{
            "name": "CapabilityTest",
            "slot": 10,
            "type": "Inform",
            "token": "11111111",
            "filename": "CapabilityTest.1.current.lump",
            "resident": True,
        }]
    })
    _write(tmp_path / "manifest.json", [{
        "abstraction": "CapabilityTest",
        "token": "22222222",
        "filename": "CapabilityTest.1.newer.lump",
        "lump_version": 999,
        "boot_resident": True,
    }])

    assert _load_boot_resident_entries(str(tmp_path / "manifest.json")) == [
        (10, "11111111", "CapabilityTest.1.current.lump")
    ]


def test_unbound_rich_ns_entry_is_not_selected_from_manifest(tmp_path):
    _write(tmp_path / "ns-state.json", {
        "abstractions": [{"name": "CapabilityTest", "slot": 10, "type": "Inform"}]
    })
    _write(tmp_path / "manifest.json", [{
        "abstraction": "CapabilityTest",
        "token": "22222222",
        "filename": "CapabilityTest.1.newer.lump",
        "boot_resident": True,
    }])

    assert _load_boot_resident_entries(str(tmp_path / "manifest.json")) == []