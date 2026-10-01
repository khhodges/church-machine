"""Image membership is explicit policy, not every Namespace artifact locator."""
import ast
import copy
import hashlib
import json
import os
from pathlib import Path
import struct
import sys

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from server import boot_image as bi
from server.simulation_preparation import artifact_bindings, stage_image
from test_preparation import saved, snapshot


def dormant():
    return {"slot": 8, "name": "Tunnel", "type": "Inform",
            "filename": "Tunnel.1.9381d362.lump", "token": "00001f00",
            "binary_hash": "a" * 64, "location": "0x00000400", "seq": 0}


def helpers():
    """Exercise real candidate helpers without importing a live Flask app."""
    source = Path("server/app.py").read_text()
    tree = ast.parse(source)
    names = {"_prepare_run_candidate", "_prepare_run_candidates"}
    module = ast.Module([node for node in tree.body
                         if isinstance(node, ast.FunctionDef) and node.name in names], [])
    ns = {"os": os, "_boot_image_gen": bi,
          "_file_sha256": lambda path: hashlib.sha256(Path(path).read_bytes()).hexdigest(),
          "_read_manifest_safe": lambda path: json.loads(Path(path).read_text())}
    exec(compile(module, "server/app.py", "exec"), ns)
    return ns


@pytest.mark.parametrize("policy,expected", [
    ({}, False), ({"resident": False}, False),
    ({"load_policy": "Lazy", "resident": True}, False),
    ({"load_policy": "Resident"}, True), ({"resident": True}, True),
    ({"boot_resident": True}, True), ({"boot": True}, True),
    ({"symbolic": True, "resident": True}, False),
])
def test_selection_is_not_assignment(policy, expected):
    assert bi.image_artifact_selected({**dormant(), **policy}) is expected


@pytest.mark.parametrize("mode", ["missing", "corrupt", "no-proof"])
def test_unselected_not_read_resolved_embedded_or_in_provenance(saved, monkeypatch, mode):
    root, rows, cfg = saved
    excluded = dormant()
    rows.append(excluded)
    if mode != "missing":
        raw = b"broken" if mode == "corrupt" else struct.pack(">64I", 31 << 27, *([0] * 63))
        (root / excluded["filename"]).write_bytes(raw)
        excluded["binary_hash"] = hashlib.sha256(raw).hexdigest()
    (root / "ns-state.json").write_text(json.dumps({"abstractions": rows}))
    original = copy.deepcopy(rows)
    before = snapshot(root)
    namespace = helpers()
    resolved = []
    def candidate(probe, directory, *, pin=None):
        resolved.append(probe[0]["slot"])
        return probe[0], dict(probe[0])
    namespace["_prepare_run_candidate"] = candidate
    prepared, changes = namespace["_prepare_run_candidates"](rows, str(root))
    assert resolved == [6]
    assert prepared[-1] == excluded and not changes
    assert bi._load_boot_resident_entries(str(root / "manifest.json"))[0][0] == 6
    assert 8 not in bi._load_catalog_token_map(str(root / "manifest.json"))
    # Fail if ANY path (including cache trust/portable manifest probing)
    # attempts to read the excluded artifact.
    import builtins
    real_open = builtins.open
    def guarded_open(path, *args, **kwargs):
        if isinstance(path, (str, os.PathLike)):
            assert Path(path).name != excluded["filename"], "unselected artifact was probed"
        return real_open(path, *args, **kwargs)
    monkeypatch.setattr(builtins, "open", guarded_open)
    image, image_rows, bindings = stage_image(cfg, rows, root, 6)
    assert [b["slot"] for b in bindings] == [6]
    assert image_rows[-1] == excluded
    words = struct.unpack(f"<{len(image)//4}I", image)
    assert words[-9 * 4:-8 * 4] == (0, 0, 0, 0)
    provenance = bi.build_boot_image_provenance(image, str(root))
    assert [b["slot"] for b in provenance["resident_bindings"]] == [6]
    assert rows == original and snapshot(root) == before


def test_pin_cannot_implicitly_select_excluded_assignment(saved):
    root, rows, _ = saved
    rows.append(dormant())
    namespace = helpers()
    namespace["_prepare_run_candidate"] = lambda probe, directory, pin=None: (
        probe[0], dict(probe[0]))
    with pytest.raises(ValueError, match="unselected"):
        namespace["_prepare_run_candidates"](rows, str(root), artifact_pins={"8": {
            "filename": rows[-1]["filename"], "token": rows[-1]["token"], "revision": 1}})


def test_legacy_staging_copies_only_selected_artifacts(saved, tmp_path):
    root, rows, _ = saved
    rows.append(dormant())
    before = snapshot(root)
    stage = root / "private-stage"
    bi.copy_selected_image_inputs(root, stage, rows)
    assert {p.name for p in stage.iterdir()} == {
        "manifest.json", "approvals.json", rows[2]["filename"]}
    assert snapshot(root) == before


def test_selected_missing_proof_still_rejected_and_no_latest_promotion(saved):
    root, rows, _ = saved
    selected = copy.deepcopy(rows[-1])
    selected.update(resident=True, boot_resident=True, load_policy="Resident")
    (root / "manifest.json").write_text(json.dumps([{
        "abstraction": selected["name"], "filename": "Newer.2.99999999.lump",
        "token": "99999999", "lump_version": 200}]))
    namespace = helpers()
    before = snapshot(root)
    with pytest.raises(ValueError, match="approval"):
        namespace["_prepare_run_candidates"]([selected], str(root))
    assert snapshot(root) == before


def test_selected_resident_included_and_invalid_selected_fails(saved):
    root, rows, cfg = saved
    selected = dormant()
    selected.update(load_policy="Resident", resident=True, token="4a000008")
    raw = struct.pack(">64I", (31 << 27) | (3 << 10) | 1,
                      *([0] * 62), 0x4A000008)
    selected["binary_hash"] = hashlib.sha256(raw).hexdigest()
    (root / selected["filename"]).write_bytes(raw)
    rows.append(selected)
    before = copy.deepcopy(rows)
    image, _, bindings = stage_image(cfg, rows, root, 6)
    assert {b["slot"] for b in bindings} == {6, 8}
    words = struct.unpack(f"<{len(image)//4}I", image)
    location = words[-9 * 4]
    assert location > 0 and words[location:location + 64] == struct.unpack(">64I", raw)
    assert rows == before
    (root / selected["filename"]).write_bytes(b"broken")
    with pytest.raises(ValueError, match="hash mismatch"):
        artifact_bindings(rows, root)


def test_hardware_generation_and_admission_share_selection(saved):
    root, rows, cfg = saved
    owner = rows[-1]
    owner.update(resident=True, boot_resident=True, load_policy="Resident",
                 ns_slot_policy="static")
    raw = (root / owner["filename"]).read_bytes()
    (root / "approvals.json").write_text(json.dumps({
        "version": 1, "algorithm": "sha256", "approvals": {
            hashlib.sha256(raw).hexdigest(): {
                "binary_hash": hashlib.sha256(raw).hexdigest(),
                "filename": owner["filename"], "dot_name": "SelfTest",
                "issue_n": 1, "bootstrap_t": "4a000006",
                "bootstrap_runtime_gt": 0x4A000006,
            }},
    }))
    excluded = dormant()
    rows.append(excluded)
    (root / "ns-state.json").write_text(json.dumps({"abstractions": rows}))
    image = bi.generate_boot_image(cfg, str(root), 6, require_entry_resident=True)
    provenance = bi.build_boot_image_provenance(image, str(root))
    assert [r["slot"] for r in provenance["resident_bindings"]] == [6]
    (root / "boot-image.provenance.json").write_text(json.dumps(provenance))
    bi.validate_resident_artifact_bindings(image, str(root))
    # Explicit selection must now require genuine proof for the exact body.
    tunnel = struct.pack(">64I", (31 << 27) | (3 << 10) | 1,
                         *([0] * 62), 0x4A000008)
    (root / excluded["filename"]).write_bytes(tunnel)
    excluded.update(load_policy="Resident", resident=True, token="4a000008",
                    binary_hash=hashlib.sha256(tunnel).hexdigest())
    (root / "ns-state.json").write_text(json.dumps({"abstractions": rows}))
    with pytest.raises(ValueError, match="exact hash-bound approval required"):
        bi.generate_boot_image(cfg, str(root), 6, require_entry_resident=True)