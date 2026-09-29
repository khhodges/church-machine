import pytest
import json
import struct

from server import app as app_module


def test_symbolic_namespace_row_accepts_only_code_free_metadata():
    app_module._validate_symbolic_namespace_entries([{
        "name": "Future.Service",
        "slot": 14,
        "symbolic": True,
        "implementationMissing": True,
        "resident": False,
    }])


@pytest.mark.parametrize("field,value", [
    ("token", "abc12345"),
    ("filename", "Future.Service.1.abc12345.lump"),
    ("binaryHash", "a" * 64),
    ("binary_hash", "a" * 64),
    ("identityHash", "b" * 64),
    ("identity_hash", "b" * 64),
    ("cacheToken", 123),
    ("cache_token", 123),
    ("resident", True),
    ("boot_resident", True),
])
def test_symbolic_namespace_row_rejects_binary_metadata(field, value):
    row = {
        "name": "Future.Service",
        "slot": 14,
        "symbolic": True,
        "implementationMissing": True,
        field: value,
    }
    with pytest.raises(ValueError, match="cannot carry binary or resident metadata"):
        app_module._validate_symbolic_namespace_entries([row])


def test_symbolic_namespace_row_requires_missing_implementation_marker():
    with pytest.raises(ValueError, match="implementationMissing"):
        app_module._validate_symbolic_namespace_entries([{
            "name": "Future.Service",
            "slot": 14,
            "symbolic": True,
        }])


@pytest.mark.parametrize("selection", [
    {"status": "missing", "diagnostic": "Not in saved library."},
    {"status": "invalid", "diagnostic": "Invalid LUMP header",
     "token": "deadbeef", "filename": "Broken.deadbeef.lump"},
    {"status": "unresolved", "diagnostic": "Design only; not installed.",
     "token": "1234abcd", "binaryHash": "a" * 64},
])
def test_design_placement_roundtrip_is_non_executable(tmp_path, selection):
    row = {"name": "Future service idea!", "slot": 14, "symbolic": True,
           "implementationMissing": True, "resident": False,
           "location": "0x00000000", "selection": selection}
    # Isolated disk roundtrip: production uses the same ns-state abstractions
    # array and never writes a LUMP or materializes selected bytes.
    state_file = tmp_path / "ns-state.json"
    state_file.write_text(json.dumps({"abstractions": [row]}))
    restored = json.loads(state_file.read_text())["abstractions"]
    app_module._validate_symbolic_namespace_entries(restored)
    app_module._validate_active_namespace_lumps(restored)
    assert restored[0]["selection"] == selection
    assert not any(key in restored[0] for key in ("token", "filename", "binaryHash"))
    image = struct.pack("<64I", *([0] * 64))
    app_module._validate_symbolic_namespace_image(restored, image)
    bad = bytearray(image)
    struct.pack_into("<I", bad, (64 - (14 + 1) * 4) * 4, 0x800)
    with pytest.raises(ValueError, match="W0=0"):
        app_module._validate_symbolic_namespace_image(restored, bytes(bad))


def test_design_placement_cannot_become_boot_or_resident():
    row = {"name": "Future.Broken", "slot": 14, "symbolic": True,
           "implementationMissing": True, "selection": {
               "status": "invalid", "diagnostic": "Bad header"}}
    for invalid in ({"boot": True}, {"resident": True},
                    {"token": "deadbeef"}, {"selection": {
                        "status": "valid", "diagnostic": "Pretend executable"}}):
        with pytest.raises(ValueError):
            app_module._validate_symbolic_namespace_entries([{**row, **invalid}])