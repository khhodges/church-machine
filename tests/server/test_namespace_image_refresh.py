"""Private reconstruction/publication tests; never refresh the live image."""
import copy
import hashlib
import json
import os
from pathlib import Path
import struct

import pytest

from server import namespace_image_refresh as refresh
from server.boot_capacity import capacity_report


def fixture(root):
    root.mkdir(parents=True, exist_ok=True)
    cfg = {"step1": {"totalNamespaceWords": 8192, "nsSlotsMax": 64,
                    "threadLumpWords": 256, "threadStackWords": 32}}
    words = [refresh.boot.pack_lump_header(0, 1, 1, 0), 0x18000000] + [0] * 61 + [0x4A030014]
    raw = struct.pack(">64I", *words)
    (root / "selected.lump").write_bytes(raw)
    rows = [
        dict(slot=0, name="Boot.NS", type="Namespace", location=0, limit=4095, seq=0),
        dict(slot=23, name="AnyThread", type="Thread", location=512, limit=7, seq=2),
        dict(slot=20, name="Exact", type="Inform", location=1024, limit=1, seq=3,
             filename="selected.lump", token="4a030014", binary_hash=refresh.sha(raw),
             boot=True, load_policy="Resident"),
        dict(slot=3, name="LED_DEV", type="Device", location=0xFFFF0000, limit=0, seq=0),
        dict(slot=9, name="Unselected", type="Inform", location=1700, limit=63, seq=0,
             load_policy="Lazy"),
    ]
    rows[3]["location"], rows[3]["limit"] = refresh.boot._MMIO_SLOT_SPECS[3]
    (root / "ns-state.json").write_text(json.dumps({"abstractions": rows}))
    (root / "config.json").write_text(json.dumps(cfg))
    (root / "manifest.json").write_text("[]")
    (root / "approvals.json").write_text('{"version":1,"algorithm":"sha256","approvals":{}}')
    (root / "unselected.lump").write_bytes(b"not a selected artifact")
    return cfg, rows


def store(root):
    return refresh.RefreshStore(root, root / "ns-state.json", root / "config.json")


def compiler_marker_fixture(root, monkeypatch):
    from server.lump_approvals import sign_compiler_record, write_approvals
    cfg, rows = fixture(root)
    raw = (root / "selected.lump").read_bytes()[:-4] + struct.pack(">I", 0xFEED5E1F)
    digest = refresh.sha(raw)
    name = f"Exact.1.{digest[:8]}.lump"
    (root / name).write_bytes(raw)
    rows[2].update(filename=name, binary_hash=digest)
    key = b"compiler-self-test-only-key" * 2
    monkeypatch.setattr(refresh.boot, "compiler_record_verification_key", lambda _: key)
    approval = dict(binary_hash=digest, filename=name, dot_name="Exact", issue_n=1,
                    trust_origin="trusted-home-ide", compiler_identity="CLOOMC",
                    compiler_version="test",
                    compiler_record=sign_compiler_record({"binary_hash": digest}, signing_key=key))
    write_approvals(str(root / "approvals.json"), {digest: approval})
    (root / "ns-state.json").write_text(json.dumps({"abstractions": rows}))
    return cfg, rows, raw, approval


@pytest.mark.parametrize("sequence", [3, 7])
def test_verified_marker_private_refresh(tmp_path, monkeypatch, sequence):
    cfg, rows, raw, _ = compiler_marker_fixture(tmp_path, monkeypatch)
    rows[2]["seq"] = sequence
    before = {p.name: p.read_bytes() for p in tmp_path.iterdir()}
    image, evidence = refresh.reconstruct(cfg, rows, tmp_path)
    words = struct.unpack("<8192I", image)
    expected = refresh.boot.create_gt(sequence, 20, {"E": 1}, 1)
    source = struct.unpack(">64I", raw)
    assert words[1024:1087] == source[:-1]  # actual header/code unchanged
    assert words[1087] == words[8192 - 21 * 4 + 3] == expected
    assert evidence["artifactBindings"][0]["derivativeHash"] != refresh.sha(raw)
    assert before == {p.name: p.read_bytes() for p in tmp_path.iterdir()}


@pytest.mark.parametrize("defect", ["missing", "forged", "missing-key", "bytes", "wrong-self", "old-destination"])
def test_marker_evidence_fail_closed(tmp_path, monkeypatch, defect):
    from server.lump_approvals import write_approvals
    cfg, rows, raw, approval = compiler_marker_fixture(tmp_path, monkeypatch)
    if defect == "missing":
        write_approvals(str(tmp_path / "approvals.json"), {})
    elif defect == "forged":
        approval["compiler_record"]["signature"] = "0" * 64
        write_approvals(str(tmp_path / "approvals.json"), {refresh.sha(raw): approval})
    elif defect == "missing-key":
        def unavailable(_):
            raise RuntimeError("compiler key unavailable")
        monkeypatch.setattr(refresh.boot, "compiler_record_verification_key", unavailable)
    else:
        words = list(struct.unpack(">64I", raw))
        if defect == "bytes":
            words[1] ^= 1
        else:
            words[-1] = 0x12345678 if defect == "wrong-self" else 0x4A020014
        raw = struct.pack(">64I", *words)
        (tmp_path / rows[2]["filename"]).write_bytes(raw)
        rows[2]["binary_hash"] = refresh.sha(raw)
    before = {p.name: p.read_bytes() for p in tmp_path.iterdir()}
    with pytest.raises(ValueError, match="SELF"):
        refresh.reconstruct(cfg, rows, tmp_path)
    assert before == {p.name: p.read_bytes() for p in tmp_path.iterdir()}


def test_shared_simulation_validator_accepts_only_verified_marker(tmp_path, monkeypatch):
    from server.simulation_preparation import validate_simulation_executable
    cfg, rows, raw, _ = compiler_marker_fixture(tmp_path, monkeypatch)
    path = tmp_path / rows[2]["filename"]
    assert validate_simulation_executable(path, tmp_path, "test") == list(struct.unpack(">64I", raw))
    (tmp_path / "approvals.json").write_text('{"version":1,"algorithm":"sha256","approvals":{}}')
    with pytest.raises(ValueError, match="compiler SELF"):
        validate_simulation_executable(path, tmp_path, "test")


def test_compiler_marker_shared_staging(tmp_path, monkeypatch):
    from server.simulation_preparation import stage_image
    cfg, rows, raw, _ = compiler_marker_fixture(tmp_path, monkeypatch)
    cfg["step1"]["namespaceLumpWords"] = 64
    rows[2].update(slot=6, name="SelfTest")
    rows = [rows[0], rows[2]]
    (tmp_path / "ns-state.json").write_text(json.dumps({"abstractions": rows}))
    before = {p.name: p.read_bytes() for p in tmp_path.iterdir()}
    image, prepared, bindings = stage_image(cfg, rows, str(tmp_path), 6)
    words = struct.unpack("<8192I", image)
    assert words[1024:1087] == struct.unpack(">64I", raw)[:-1]
    assert words[1087] == words[8192 - 7 * 4 + 3] == 0x4A030006
    derivative = next(r for r in prepared if r["slot"] == 6)["simulationBinding"]
    assert derivative["sourceArtifact"]["binaryHash"] == refresh.sha(raw)
    assert derivative["derivativeHash"] != refresh.sha(raw)
    assert before == {p.name: p.read_bytes() for p in tmp_path.iterdir()}


def test_compiler_marker_boot_generator(tmp_path, monkeypatch):
    cfg, rows, raw, _ = compiler_marker_fixture(tmp_path, monkeypatch)
    cfg["step1"]["namespaceLumpWords"] = 64
    rows[2].update(slot=6, name="SelfTest", resident=True, boot_resident=True)
    (tmp_path / "ns-state.json").write_text(json.dumps({"abstractions": [rows[0], rows[2]]}))
    image = refresh.boot.generate_boot_image(cfg, str(tmp_path), 6)
    words = struct.unpack("<8192I", image)
    loc = words[8192 - 7 * 4]
    assert words[loc:loc + 63] == struct.unpack(">64I", raw)[:-1]
    assert words[loc + 63] == words[8192 - 7 * 4 + 3] == 0x4A030006
    assert (tmp_path / rows[2]["filename"]).read_bytes() == raw


def test_saved_thread_design_generates_only_assigned_instances(tmp_path):
    cfg, rows = fixture(tmp_path)
    cfg["step1"]["threadCount"] = 3
    rows[1].update(slot=11, name="Renamed context", type="Inform")
    before = copy.deepcopy(rows)
    image, evidence = refresh.reconstruct(cfg, rows, tmp_path)
    words = struct.unpack("<8192I", image)
    assert (words[512] >> 8) & 3 == 2
    assert words[8192 - 12 * 4] == 512
    assert words[8192 - 2 * 4] == 0  # no implied Boot.Thread
    assert words[8192 - 13 * 4] == 0  # no implied Thread.3
    assert rows == before
    report = capacity_report(rows, image, str(tmp_path), config=cfg)
    assert report["namespaceWarnings"] == []


def test_thread_name_outside_saved_design_is_not_synthesized(tmp_path):
    cfg, rows = fixture(tmp_path)
    cfg["step1"]["threadCount"] = 1
    rows[1].update(name="Thread.2", type="Inform", load_policy="Resident")
    with pytest.raises(ValueError, match="no exact LUMP selected"):
        refresh.reconstruct(cfg, rows, tmp_path)


def test_capacity_never_requires_legacy_catalog(tmp_path, monkeypatch):
    cfg, rows = fixture(tmp_path)
    def forbidden(*args, **kwargs):
        raise AssertionError("Legacy catalog must not select Namespace membership")
    monkeypatch.setattr(refresh.boot, "validate_resident_boot_profile", forbidden)
    report = capacity_report(rows, None, str(tmp_path), config=cfg)
    assert not any("missing fixed Namespace" in warning for warning in report["warnings"])
    assert report["namespaceWarnings"] == []


def test_capacity_uses_saved_only_validation_even_for_old_image(tmp_path, monkeypatch):
    cfg, rows = fixture(tmp_path)
    image, _ = refresh.reconstruct(cfg, rows, tmp_path)
    original = refresh.boot.validate_boot_image
    calls = []
    def validate(*args, **kwargs):
        calls.append(kwargs)
        assert kwargs.get("saved_namespace_only") is True
        return original(*args, **kwargs)
    monkeypatch.setattr(refresh.boot, "validate_boot_image", validate)
    report = capacity_report(rows, image, str(tmp_path), config=cfg)
    assert calls
    assert report["namespaceWarnings"] == []
    assert not any("missing fixed Namespace" in warning for warning in report["warnings"])


def test_refresh_reports_all_unbound_slots_without_substitution(tmp_path):
    cfg, rows = fixture(tmp_path)
    for slot in (1, 11, 12):
        rows.append(dict(slot=slot, name=f"Unbound{slot}", type="Inform",
                         location=2048, limit=255, seq=0, load_policy="Resident"))
    with pytest.raises(ValueError) as error:
        refresh.reconstruct(cfg, rows, tmp_path)
    for slot in (1, 11, 12):
        assert f"NS[{slot}]" in str(error.value)
    assert "stored image unchanged" in str(error.value)


def test_zero_reconstruction_and_full_allocation(tmp_path):
    cfg, rows = fixture(tmp_path)
    # An old image has stale descriptors and stale bytes, including memory
    # now legitimately owned by a retained LUMP. It is never an input.
    (tmp_path / "boot-image.bin").write_bytes(b"\xff" * 16384)
    before = {p.name: p.read_bytes() for p in tmp_path.iterdir()}
    image, evidence = refresh.reconstruct(cfg, rows, tmp_path)
    assert refresh.reconstruct(cfg, list(reversed(rows)), tmp_path)[0] == image
    words = struct.unpack("<8192I", image)
    assert words[8192 - 24 * 4] == 512  # arbitrary Thread slot/address
    assert words[8192 - 10 * 4:8192 - 9 * 4] == (0, 0, 0, 0)
    assert words[8192 - 19 * 4:8192 - 18 * 4] == (0, 0, 0, 0)
    assert all(word == 0 for word in words[1100:1700])
    assert words[1024:1088] == struct.unpack(">64I", before["selected.lump"])
    assert "256 words" in "\n".join(evidence["slotResults"])
    assert {p.name: p.read_bytes() for p in tmp_path.iterdir()} == before
    # Full body collision, despite access limit of only 7.
    rows[2]["location"] = 700
    with pytest.raises(ValueError, match="overlap"):
        refresh.reconstruct(cfg, rows, tmp_path)


def test_saved_thread_is_exact_lump_not_regenerated(tmp_path):
    cfg, rows = fixture(tmp_path)
    image, _ = refresh.reconstruct(cfg, rows, tmp_path)
    words = list(struct.unpack("<8192I", image))[512:768]
    words[30] = 0x12345678  # preserve saved private content
    raw = struct.pack(">256I", *words)
    (tmp_path / "thread.lump").write_bytes(raw)
    rows[1].update(filename="thread.lump", binary_hash=refresh.sha(raw))
    cfg["step1"]["threadLumpWords"] = 1024  # exact header remains authority
    image, _ = refresh.reconstruct(cfg, rows, tmp_path)
    assert struct.unpack("<8192I", image)[512:768] == tuple(words)


def test_generic_slot_one_thread_keeps_its_saved_enter_target(tmp_path):
    cfg, rows = fixture(tmp_path)
    image, _ = refresh.reconstruct(cfg, rows, tmp_path)
    raw = struct.pack(">256I", *struct.unpack("<8192I", image)[512:768])
    (tmp_path / "thread.lump").write_bytes(raw)
    rows[1].update(slot=1, filename="thread.lump", binary_hash=refresh.sha(raw))
    rows[2]["boot"] = False
    target = dict(rows[2], slot=21, location=1200, filename="second.lump", boot=True)
    second = list(struct.unpack(">64I", (tmp_path / "selected.lump").read_bytes()))
    second[-1] = refresh.boot.create_gt(3, 21, {"E": 1}, 1)
    second_raw = struct.pack(">64I", *second)
    (tmp_path / "second.lump").write_bytes(second_raw)
    target.update(token=f"{second[-1]:08x}", binary_hash=refresh.sha(second_raw))
    rows.append(target)
    rebuilt, _ = refresh.reconstruct(cfg, rows, tmp_path)
    assert struct.unpack("<8192I", rebuilt)[512:768] == struct.unpack(">256I", raw)


def test_thread_petname_does_not_install_lazy_inform(tmp_path):
    cfg, rows = fixture(tmp_path)
    expected, _ = refresh.reconstruct(cfg, rows, tmp_path)
    rows[4]["name"] = "Thread.NotAThread"
    actual, evidence = refresh.reconstruct(cfg, rows, tmp_path)
    assert actual == expected
    assert any("Thread.NotAThread" in line and "omitted" in line for line in evidence["slotResults"])
    (tmp_path / "ns-state.json").write_text(json.dumps({"abstractions": rows}))
    service = store(tmp_path)
    plan = service.prepare("owner")
    service.commit(plan["operationId"], "owner")
    saved = json.loads((tmp_path / "ns-state.json").read_bytes())["abstractions"]
    report = capacity_report(saved, (tmp_path / "boot-image.bin").read_bytes(), str(tmp_path), config=cfg)
    assert report["trusted"], report["warnings"]


@pytest.mark.parametrize("saved_type", ["Thread", "Inform"])
def test_saved_continuation_and_independent_cr0(tmp_path, saved_type):
    cfg, rows = fixture(tmp_path)
    image, _ = refresh.reconstruct(cfg, rows, tmp_path)
    words = list(struct.unpack("<8192I", image))[512:768]
    layout = refresh.boot.thread_layout(256, 32)
    sto = words[refresh.boot.THREAD_STO_OFFSET] & 0xFFF
    words[sto + 2] &= 0x1FFF  # Ordinary continuation NIA zero, not root sentinel.
    words[layout["caps_start"]] = refresh.boot.create_gt(0, 9, {"E": 1}, 1)
    raw = struct.pack(">256I", *words)
    (tmp_path / "thread.lump").write_bytes(raw)
    rows[1].update(type=saved_type, filename="thread.lump", binary_hash=refresh.sha(raw),
                   load_policy="Resident")
    rebuilt, _ = refresh.reconstruct(cfg, rows, tmp_path)
    assert struct.unpack("<8192I", rebuilt)[512:768] == tuple(words)
    words[sto + 2] |= 1 << 13  # cw=1: continuation at 1 is out of bounds.
    invalid = struct.pack(">256I", *words)
    (tmp_path / "thread.lump").write_bytes(invalid)
    rows[1]["binary_hash"] = refresh.sha(invalid)
    with pytest.raises(ValueError, match="non-executable CHURCH"):
        refresh.reconstruct(cfg, rows, tmp_path)


@pytest.mark.parametrize("defect", ["missing", "hash", "header", "outside", "mmio"])
def test_fail_closed(tmp_path, defect):
    cfg, rows = fixture(tmp_path)
    if defect == "missing":
        (tmp_path / "selected.lump").unlink()
    elif defect == "hash":
        rows[2]["binary_hash"] = "0" * 64
    elif defect == "header":
        raw = b"\0" * 256
        (tmp_path / "selected.lump").write_bytes(raw)
        rows[2]["binary_hash"] = refresh.sha(raw)
    elif defect == "outside":
        rows[2]["location"] = 7900
    else:
        rows[3]["location"] = 16
    with pytest.raises((ValueError, OSError)):
        refresh.reconstruct(cfg, rows, tmp_path)


def test_commit_capacity_and_preserved_inputs(tmp_path):
    cfg, rows = fixture(tmp_path)
    protected = {p.name: p.read_bytes() for p in tmp_path.iterdir()}
    service = store(tmp_path)
    plan = service.prepare("owner")
    result = service.commit(plan["operationId"], "owner")
    assert result["committed"] is True
    image = (tmp_path / "boot-image.bin").read_bytes()
    saved = json.loads((tmp_path / "ns-state.json").read_bytes())["abstractions"]
    report = capacity_report(saved, image, str(tmp_path), config=cfg)
    assert report["trusted"], report["warnings"]
    assert report["imageMatchesNamespaceRevision"]
    assert report["allocatedWords"] == 16 + 256 + 256 + 64
    assert {name: (tmp_path / name).read_bytes() for name in protected if name != "ns-state.json"} == {
        name: raw for name, raw in protected.items() if name != "ns-state.json"}
    by_slot = {r["slot"]: r for r in saved}
    assert refresh.integer(by_slot[20]["location"]) == 16
    assert refresh.integer(by_slot[23]["location"]) == 80
    assert by_slot[3]["location"] == rows[3]["location"]
    assert struct.unpack("<8192I", image)[4] == 16 * 4
    assert refresh.reconstruct(cfg, saved, tmp_path)[0] == image
    second = service.prepare("owner")
    assert second["relocations"] == []
    assert (service.root / second["operationId"] / "image.bin").read_bytes() == image
    with pytest.raises(ValueError, match="already resolved"):
        service.commit(plan["operationId"], "owner")


@pytest.mark.parametrize("filename", ["ns-state.json", "config.json", "selected.lump", "manifest.json"])
def test_stale_review(tmp_path, filename):
    fixture(tmp_path)
    service = store(tmp_path)
    plan = service.prepare("owner")
    with (tmp_path / filename).open("ab") as stream:
        stream.write(b" ")
    with pytest.raises(ValueError, match="changed"):
        service.commit(plan["operationId"], "owner")
    assert not (tmp_path / "boot-image.bin").exists()


def test_compaction_repairs_old_overlap_without_changing_sources(tmp_path):
    cfg, rows = fixture(tmp_path)
    rows[2]["location"] = rows[1]["location"]
    before = copy.deepcopy(rows)
    image, evidence = refresh.reconstruct(cfg, rows, tmp_path, compact=True)
    assert rows == before
    compacted = {r["slot"]: r for r in evidence["compactedRows"]}
    assert refresh.integer(compacted[20]["location"]) == 16
    assert refresh.integer(compacted[23]["location"]) == 80
    words = struct.unpack("<8192I", image)
    assert not any(words[336:7936])
    assert words[8192 - 10 * 4:8192 - 9 * 4] == (0, 0, 0, 0)


def test_compaction_overflow_preserves_namespace(tmp_path):
    cfg, rows = fixture(tmp_path)
    rows[1]["allocationWords"] = 8192
    before = copy.deepcopy(rows)
    with pytest.raises(ValueError, match="outside body RAM"):
        refresh.reconstruct(cfg, rows, tmp_path, compact=True)
    assert rows == before


def test_staged_namespace_tampering_blocks_commit(tmp_path):
    fixture(tmp_path)
    service = store(tmp_path)
    original = service.state_path.read_bytes()
    plan = service.prepare("owner")
    (service.root / plan["operationId"] / "namespace.json").write_text("{}")
    with pytest.raises(ValueError, match="Staged Namespace hash"):
        service.commit(plan["operationId"], "owner")
    assert service.state_path.read_bytes() == original
    assert not (tmp_path / "boot-image.bin").exists()


def test_transaction_failure_and_restart_recovery(tmp_path, monkeypatch):
    fixture(tmp_path)
    old_state = (tmp_path / "ns-state.json").read_bytes()
    service = store(tmp_path)
    (tmp_path / "boot-image.bin").write_bytes(b"old-image")
    (tmp_path / "boot-image.provenance.json").write_bytes(b"old-provenance")
    plan = service.prepare("owner")
    original = refresh.atomic
    failed = False
    def fail_second(path, raw):
        nonlocal failed
        if Path(path).name == "boot-image.provenance.json" and not failed:
            failed = True
            raise OSError("injected write failure")
        return original(path, raw)
    monkeypatch.setattr(refresh, "atomic", fail_second)
    with pytest.raises(OSError, match="injected"):
        service.commit(plan["operationId"], "owner")
    assert (tmp_path / "boot-image.bin").read_bytes() == b"old-image"
    assert (tmp_path / "boot-image.provenance.json").read_bytes() == b"old-provenance"
    assert service.read(plan["operationId"], "owner")["status"] == "rolled_back"
    assert (tmp_path / "ns-state.json").read_bytes() == old_state
    monkeypatch.setattr(refresh, "atomic", original)
    plan = service.prepare("owner")
    failed = False
    def interrupt(path, raw):
        nonlocal failed
        if Path(path).name == "boot-image.provenance.json":
            raise KeyboardInterrupt()
        return original(path, raw)
    monkeypatch.setattr(refresh, "atomic", interrupt)
    with pytest.raises(KeyboardInterrupt):
        service.commit(plan["operationId"], "owner")
    monkeypatch.setattr(refresh, "atomic", original)
    store(tmp_path).recover()
    assert (tmp_path / "ns-state.json").read_bytes() == old_state
    assert (tmp_path / "boot-image.bin").read_bytes() == b"old-image"
    assert (tmp_path / "boot-image.provenance.json").read_bytes() == b"old-provenance"


def test_status_resolves_uncertain_ticket_and_blocks_late_commit(tmp_path):
    fixture(tmp_path)
    service = store(tmp_path)
    plan = service.prepare("owner")
    assert service.status(plan["operationId"], "owner")["committed"] is False
    with pytest.raises(ValueError, match="already resolved"):
        service.commit(plan["operationId"], "owner")
    with pytest.raises(ValueError, match="another session"):
        service.read(plan["operationId"], "intruder")


@pytest.mark.parametrize("design_type,design_name", [("Thread", "Unimplemented"),
                                                   ("Inform", "Thread.Draft")])
def test_real_protected_endpoint(tmp_path, monkeypatch, design_type, design_name):
    assert os.environ.get("CHURCH_TEST_ISOLATED_MODE") == "1"
    for key in ("CHURCH_TEST_LUMPS_DIR", "CHURCH_TEST_BOOT_CONFIG_PATH",
                "CHURCH_TEST_BUILD_SNAPSHOTS_DIR", "CHURCH_TEST_DB_PATH"):
        assert os.environ.get(key)
    from server import app as app_module
    cfg, rows = fixture(tmp_path)
    rows.append(dict(slot=24, name=design_name, type=design_type, symbolic=True,
                     implementationMissing=True, location=0, limit=0, seq=0))
    rows[1]["allocationWords"] = cfg["step1"].pop("threadLumpWords")
    (tmp_path / "config.json").write_text(json.dumps(cfg))
    (tmp_path / "ns-state.json").write_text(json.dumps({"abstractions": rows}))
    for name, value in {
        "LUMPS_DIR": tmp_path, "NS_STATE_PATH": tmp_path / "ns-state.json",
        "LUMPS_MANIFEST_PATH": tmp_path / "manifest.json",
        "BOOT_CONFIG_PATH": tmp_path / "config.json",
        "BOOT_IMAGE_PATH": tmp_path / "boot-image.bin",
        "BOOT_IMAGE_PROVENANCE_PATH": tmp_path / "boot-image.provenance.json",
    }.items():
        monkeypatch.setattr(app_module, name, str(value))
    client = app_module.app.test_client()
    plan = client.post("/api/namespace/image-refresh/prepare", json={})
    assert plan.status_code == 200, plan.json
    payload = {"operationId": plan.json["operationId"]}
    review = client.post("/api/namespace/image-refresh/commit", json=payload)
    assert review.status_code == 428, review.json
    assert not (tmp_path / "boot-image.bin").exists()
    response = client.post("/api/namespace/image-refresh/commit", json=payload,
        headers={"X-Change-Confirmation": review.json["change_confirmation"]["id"]})
    assert response.status_code == 200, response.json
    assert response.json["committed"]
    words = struct.unpack("<8192I", (tmp_path / "boot-image.bin").read_bytes())
    assert words[8192-25*4:8192-24*4] == (0, 0, 0, 0)
    assert any("NS[24]" in line and "omitted" in line for line in response.json["slotResults"])
    assert client.get("/api/boot-image/capacity").json["trusted"]
    assert client.get("/api/boot-image/binary?simulator=1").status_code == 200
    assert client.get("/api/boot-image/download").status_code == 200