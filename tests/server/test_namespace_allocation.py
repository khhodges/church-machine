"""Isolated allocation/CAS coverage; never reads the programmer's library."""
import copy
import hashlib
import json
import multiprocessing
from pathlib import Path
import struct
import concurrent.futures
import threading

import pytest

from server.namespace_allocation import validate_allocation_change, namespace_guard, validate_document
from server.namespace_authority import namespace_fingerprint
from test_namespace_table_save import isolated


CONFIG = {"step1": {"totalNamespaceWords": 4096, "nsSlotsMax": 64,
                    "threadLumpWords": 256}}


@pytest.fixture(autouse=True)
def private_environment(tmp_path, monkeypatch):
    config = tmp_path / ".allocation-config.json"
    config.write_text(json.dumps(CONFIG))
    monkeypatch.setenv("CHURCH_TEST_ISOLATED_MODE", "1")
    monkeypatch.setenv("CHURCH_TEST_LUMPS_DIR", str(tmp_path))
    monkeypatch.setenv("CHURCH_TEST_BOOT_CONFIG_PATH", str(config))
    monkeypatch.setenv("CHURCH_TEST_BUILD_SNAPSHOTS_DIR", str(tmp_path / "builds"))
    monkeypatch.setenv("CHURCH_TEST_DB_PATH", str(tmp_path / "test.db"))


def body(size=256):
    exponent = size.bit_length() - 7
    return struct.pack(f">{size}I", (31 << 27) | (exponent << 23) | (1 << 10),
                       *([0] * (size - 1)))


def row(root, slot=14, location=512, size=256):
    raw = body(size)
    filename = f"fixture{slot}-{size}.lump"
    (root / filename).write_bytes(raw)
    return dict(slot=slot, name=f"fixture{slot}", type="Inform", resident=True,
                location=location, limit=1, filename=filename,
                binary_hash=hashlib.sha256(raw).hexdigest(), seq=0)


@pytest.fixture
def setup(tmp_path):
    first = row(tmp_path, 7, 272, 1024)
    return tmp_path, [dict(slot=1, name="Boot.Thread", type="Thread", location=16), first]


@pytest.mark.parametrize("operation", ["add", "move", "resize", "policy", "replace"])
def test_full_range_blocks_changed_claims(setup, operation):
    root, before = setup
    candidate = row(root, 14, 1536)
    if operation != "add":
        before.append(copy.deepcopy(candidate))
    after = copy.deepcopy(before)
    if operation == "add":
        after.append(row(root, 14, 1024))
    elif operation == "move":
        after[-1]["location"] = 1024
    elif operation == "resize":
        before[-1]["location"] = 1296
        after[-1] = row(root, 14, 1024, 512)
    elif operation == "replace":
        after[-1] = row(root, 14, 1024, 512)
    else:
        before[-1].update(resident=False, load_policy="Lazy", location=1024)
        after[-1].update(resident=True, load_policy="Resident", location=1024)
    with pytest.raises(ValueError, match=r"NS\[14\].*overlaps NS\[7\]"):
        validate_allocation_change(before, after, root, CONFIG)


def test_legacy_overlaps_remain_editable_and_removable(setup):
    root, before = setup
    before.append(row(root, 14, 1024))
    after = copy.deepcopy(before)
    after[-1].update(name="changed label", token="abcddcba", limit=2)
    validate_allocation_change(before, after, root, CONFIG)
    after[-1].update(symbolic=True, implementationMissing=True)
    validate_allocation_change(before, after, root, CONFIG)
    validate_allocation_change(before, before[:-1], root, CONFIG)


def test_unknown_design_is_not_a_physical_claim(setup):
    root, before = setup
    bad = dict(slot=15, name="unresolved", symbolic=True,
               implementationMissing=True, resident=True, location=0,
               filename="absent.lump")
    validate_allocation_change(before, before + [bad], root, CONFIG)
    bad.pop("symbolic")
    bad.pop("implementationMissing")
    with pytest.raises(ValueError, match="allocation cannot be established"):
        validate_allocation_change(before, before + [bad], root, CONFIG)


@pytest.mark.parametrize("location,match", [(0, "header"), (3840, "table"), (4000, "exceeds")])
def test_reserved_ranges(setup, location, match):
    root, before = setup
    with pytest.raises(ValueError, match=match if location else "header|NS\\[1\\]"):
        validate_allocation_change(before, before + [row(root, 14, location)], root, CONFIG)


def test_staged_growth_is_checked_before_any_publication(tmp_path):
    existing = row(tmp_path, 14, 512)
    neighbor = row(tmp_path, 15, 768)
    snapshot = {p.name: p.read_bytes() for p in tmp_path.iterdir()}
    pending = body(512)
    changed = dict(existing, binary_hash=hashlib.sha256(pending).hexdigest())
    with pytest.raises(ValueError, match="overlaps"):
        validate_allocation_change([existing, neighbor], [changed, neighbor], tmp_path,
                                   CONFIG, pending={existing["filename"]: pending})
    assert snapshot == {p.name: p.read_bytes() for p in tmp_path.iterdir()}


def test_capacity_change_checks_retained_claims(tmp_path):
    existing = row(tmp_path, 14, 3072)
    smaller = {"step1": dict(CONFIG["step1"], totalNamespaceWords=2048)}
    with pytest.raises(ValueError, match="exceeds"):
        validate_allocation_change([existing], [existing], tmp_path, smaller,
                                   before_config=CONFIG)


def _competing_save(path, root, proposal, fingerprint, barrier, results):
    barrier.wait()
    with namespace_guard(path):
        current = json.loads(Path(path).read_text())["abstractions"]
        if namespace_fingerprint(current) != fingerprint:
            results.put("stale")
            return
        validate_document(path, proposal, root, CONFIG)
        Path(path).write_text(json.dumps({"abstractions": proposal}))
        results.put("saved")


def test_cross_process_cas_only_one_claim_commits(tmp_path):
    path = tmp_path / "ns-state.json"
    path.write_text('{"abstractions":[]}')
    first, second = row(tmp_path, 14, 512), row(tmp_path, 15, 512)
    ctx = multiprocessing.get_context("fork")
    barrier, results = ctx.Barrier(2), ctx.Queue()
    args = (str(path), str(tmp_path))
    processes = [ctx.Process(target=_competing_save, args=(
        *args, [candidate], namespace_fingerprint([]), barrier, results))
        for candidate in (first, second)]
    for process in processes:
        process.start()
    for process in processes:
        process.join(15)
        assert process.exitcode == 0
    assert sorted([results.get(timeout=2), results.get(timeout=2)]) == ["saved", "stale"]
    assert len(json.loads(path.read_text())["abstractions"]) == 1


def test_standalone_admission_rejects_before_any_side_effect(tmp_path):
    from server.lump_admission_service import NavanaService, AdmissionError
    path = tmp_path / "ns-state.json"
    path.write_text('{"abstractions":[]}')
    candidate = row(tmp_path, 14, 0)
    before = {p.name: p.read_bytes() for p in tmp_path.iterdir()}
    with pytest.raises(AdmissionError, match="overlaps"):
        NavanaService().publish(
            raw=body(), destination={"filename": candidate["filename"]},
            state={"abstractions": [candidate]}, lumps_dir=str(tmp_path),
            state_path=str(path), expected_namespace_fingerprint=namespace_fingerprint([]))
    assert {p.name: p.read_bytes() for p in tmp_path.iterdir()
            if p.name != ".namespace-commit.lock"} == before


def test_standalone_admission_has_same_cas_and_allocation_guard(tmp_path):
    from server.lump_admission_service import NavanaService, AdmissionError
    path = tmp_path / "ns-state.json"
    path.write_text('{"abstractions":[]}')
    candidate = row(tmp_path, 14, 512)
    kwargs = dict(raw=body(), destination={"filename": candidate["filename"]},
                  manifest=[], state={"abstractions": [candidate]},
                  evidence={"binary_hash": candidate["binary_hash"],
                            "approval_record": {"binary_hash": candidate["binary_hash"]}},
                  lumps_dir=str(tmp_path), state_path=str(path),
                  manifest_path=str(tmp_path / "manifest.json"),
                  evidence_path=str(tmp_path / "evidence.json"),
                  approvals_path=str(tmp_path / "approvals.json"), approvals={},
                  expected_namespace_fingerprint=namespace_fingerprint([]))
    NavanaService().publish(**kwargs)
    assert json.loads(path.read_text())["abstractions"] == [candidate]
    before = {p.name: p.read_bytes() for p in tmp_path.iterdir() if p.is_file()}
    with pytest.raises(AdmissionError, match="changed"):
        NavanaService().publish(**kwargs)
    assert {p.name: p.read_bytes() for p in tmp_path.iterdir() if p.is_file()} == before


def test_mmio_address_does_not_hide_file_backed_ram(tmp_path):
    selected = row(tmp_path, 14, 0x40000000)
    with pytest.raises(ValueError, match="exceeds"):
        validate_allocation_change([], [selected], tmp_path, CONFIG)


def test_real_table_review_rejects_overlap_without_writes(isolated):
    app, payload, state, paths, scope = isolated
    rows = json.loads(state.read_text())["abstractions"]
    payload["ns_state"]["abstractions"] = rows + [row(state.parent, 15, 1024)]
    before = {p: p.read_bytes() for p in paths}
    response = app.test_client().post("/api/namespace/save-table", json=payload)
    assert response.status_code == 409
    assert "overlaps NS[14]" in response.json["message"]
    assert {p: p.read_bytes() for p in paths} == before


def test_concurrent_real_confirmed_commits_only_one_can_allocate(isolated):
    app, initial, state, paths, scope = isolated
    scope["_namespace_commit_guard"] = lambda: namespace_guard(state)
    plans, clients, reviews = [], [], []
    for slot in (15, 16):
        client = app.test_client()
        payload = copy.deepcopy(initial)
        payload["ns_state"]["abstractions"].append(row(state.parent, slot, 2560))
        response = client.post("/api/namespace/save-table", json=payload)
        assert response.status_code == 428, response.json
        plans.append(payload)
        reviews.append(response.json["change_confirmation"]["id"])
        clients.append(client)
    barrier = threading.Barrier(2)
    before = {p: p.read_bytes() for p in paths if p != state}
    def commit(i):
        barrier.wait()
        return clients[i].post("/api/namespace/save-table", json=plans[i],
                               headers={"X-Change-Confirmation": reviews[i]}).status_code
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(commit, (0, 1)))
    assert sorted(results) == [200, 409]
    assert len(json.loads(state.read_text())["abstractions"]) == 2
    assert {p: p.read_bytes() for p in paths if p != state} == before