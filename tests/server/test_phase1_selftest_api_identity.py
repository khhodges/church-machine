"""Exact-byte identity inspection; never import app startup or write live stores.

The historical artifact is read only by a frozen filename + full SHA-256, copied
to tmp_path, and inspected there. Synthetic control artifacts are test data, NOT
a proposed replacement SelfTest or evidence of compiler/execution qualification.
"""
import copy
import hashlib
import json
from pathlib import Path
import struct

import pytest

from server.namespace_design_v1 import DesignStore, api_size, phase1_seed

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = json.loads((ROOT / "docs/reviews/phase1-baseline/"
                       "selftest-api-identity-evidence.json").read_text())


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def control_bytes(name):
    """Independent small big-endian legacy-API fixture with one SELF row."""
    api = json.dumps({"name": name}, separators=(",", ":")).encode()
    raw = bytearray(256)
    # 64 words, cw=2, cc=1; frame at word 3, JSON at word 4.
    struct.pack_into(">I", raw, 0, 0xF8000801)
    struct.pack_into(">I", raw, 12, 0xAB000000 | len(api))
    raw[16:16 + len(api)] = api
    struct.pack_into(">I", raw, 252, 0x4A000006)
    return bytes(raw)


def isolated_store(tmp_path, raw):
    directory = tmp_path / "lumps"
    directory.mkdir()
    row = copy.deepcopy(EVIDENCE["selectedRow"])
    row["selection"]["binaryHash"] = sha(raw)
    (directory / row["selection"]["filename"]).write_bytes(raw)
    document = phase1_seed()
    document["rows"] = [row if r["slot"] == 6 else r for r in document["rows"]]
    path = tmp_path / "phase1.json"
    path.write_text(json.dumps(document))
    legacy = tmp_path / "ns-state.json"
    # Any accidental legacy lookup fails rather than quietly selecting a row.
    legacy.write_text("legacy must not be read")
    return DesignStore(path, directory, legacy, phase1=True), row


def tree_bytes(path):
    return {str(p.relative_to(path)): p.read_bytes()
            for p in path.rglob("*") if p.is_file()}


def assert_inspection(store, row, tmp_path, warning):
    before = tree_bytes(tmp_path)
    result = store.read()
    projected = next(r for r in result["projection"]["rows"] if r["slot"] == 6)
    selected = next(r for r in result["document"]["rows"] if r["slot"] == 6)
    assert selected == row
    assert projected["selection"] == row["selection"]
    assert projected["name"] == "SelfTest" and projected["policy"] == "Resident"
    assert projected["sequence"] == 0 and projected["boot"] is False
    warnings = [w for w in result["projection"]["warnings"] if w.startswith("SelfTest:")]
    assert warnings == ([warning] if warning else [])
    assert result["projection"]["activationAllowed"] is False
    assert result["projection"]["buildReady"] is False
    assert tree_bytes(tmp_path) == before
    return projected


def test_exact_observed_selected_bytes_declare_runabstraction(tmp_path):
    selected = EVIDENCE["selectedRow"]["selection"]
    raw = (ROOT / "server/lumps" / selected["filename"]).read_bytes()
    assert sha(raw) == selected["binaryHash"], "Frozen evidence artifact changed"
    b = EVIDENCE["binary"]
    assert len(raw) == b["bytes"] == b["words"] * 4
    words = struct.unpack(f">{b['words']}I", raw)
    assert f"{words[0]:08x}" == b["headerHex"]
    assert (words[0] >> 10) & 8191 == b["cw"]
    assert words[0] & 255 == b["cc"]
    assert b["frameWordOffset"] == b["cw"] + 1
    assert f"{words[b['frameWordOffset']]:08x}" == b["frameHex"]
    assert b["apiByteOffset"] == (b["cw"] + 2) * 4
    assert words[b["frameWordOffset"]] & 65535 == b["apiByteLength"]
    api = raw[b["apiByteOffset"]:b["apiByteOffset"] + b["apiByteLength"]]
    assert api == b["apiUtf8"].encode()
    assert sha(api) == b["apiSha256"]
    assert raw[b["nameByteOffset"]:b["nameByteOffset"] + b["nameByteLength"]] == b"RunAbstraction"
    assert json.loads(api)["name"] == "RunAbstraction"
    assert f"{words[b['selfWordOffset']]:08x}" == b["selfHex"]
    store, row = isolated_store(tmp_path, raw)
    assert row == EVIDENCE["selectedRow"]
    projected = assert_inspection(store, row, tmp_path, EVIDENCE["expectedWarning"])
    assert projected["allocationWords"] == 1024  # API-only estimate, not installed size
    assert api_size(row, store.lumps)[1] == EVIDENCE["expectedWarning"].split(": ", 1)[1]


@pytest.mark.parametrize("api_name", ["SelfTest", "RunAbstraction", "Other.Service"])
@pytest.mark.parametrize("catalog", ["absent", "conflicting", "malformed"])
def test_selected_identity_is_independent_of_catalog_and_unselected_bytes(
        tmp_path, api_name, catalog):
    store, row = isolated_store(tmp_path, control_bytes(api_name))
    # Opposite identity in unselected bytes must neither hide nor create a warning.
    other = "RunAbstraction" if api_name == "SelfTest" else "SelfTest"
    (store.lumps / "unselected.lump").write_bytes(control_bytes(other))
    if catalog == "conflicting":
        (store.lumps / "manifest.json").write_text(json.dumps({"lumps": [
            {"name": "SelfTest", "filename": "unselected.lump", "active": True,
             "lump_version": 999, "token": row["selection"]["token"]},
            {"name": other, "filename": row["selection"]["filename"], "active": False},
        ]}))
    elif catalog == "malformed":
        (store.lumps / "manifest.json").write_text("catalog must not be decoded")
    (store.lumps / "SelfTest.1.8b19abd7.json").write_text(json.dumps({"name": other}))
    warning = (None if api_name == "SelfTest" else
               f"SelfTest: Embedded API names {api_name}, not SelfTest; identity needs review")
    assert_inspection(store, row, tmp_path, warning)


@pytest.mark.parametrize("problem", ["missing", "changed"])
def test_no_fallback_from_missing_or_changed_selected_bytes(tmp_path, problem):
    store, row = isolated_store(tmp_path, control_bytes("SelfTest"))
    (store.lumps / "newer.lump").write_bytes(control_bytes("SelfTest"))
    (store.lumps / "manifest.json").write_text(json.dumps({"lumps": [
        {"name": "SelfTest", "filename": "newer.lump", "active": True, "lump_version": 999}
    ]}))
    selected = store.lumps / row["selection"]["filename"]
    if problem == "missing":
        selected.unlink()
    else:
        selected.write_bytes(control_bytes("RunAbstraction"))
    before = tree_bytes(tmp_path)
    response = store.read()
    projected = next(r for r in response["projection"]["rows"] if r["slot"] == 6)
    assert projected["unresolved"] and projected["allocationWords"] == 0
    assert projected["selection"] == row["selection"]
    warnings = [w for w in response["projection"]["warnings"] if w.startswith("SelfTest:")]
    assert len(warnings) == 1
    assert ("No such file" if problem == "missing" else "hash has changed") in warnings[0]
    assert "Embedded API names" not in warnings[0]
    assert tree_bytes(tmp_path) == before
