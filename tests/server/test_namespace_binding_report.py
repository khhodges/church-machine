import hashlib
import struct

from server.namespace_binding_report import binding_report
from server.namespace_design_v1 import DesignStore, phase1_seed


def test_unfinished_entries_are_reported_not_invented(tmp_path):
    document = phase1_seed()
    report = binding_report(document, tmp_path, "fingerprint")
    assert report["status"] == "blocked"
    assert report["installed"] is False
    assert len(report["lists"]) == len([r for r in document["rows"] if r["kind"] == "lump"])
    mint = next(r for r in report["lists"] if r["name"] == "ide.Mint")
    assert mint["rows"] == []
    assert "No exact saved LUMP" in mint["reason"]
    assert list(tmp_path.iterdir()) == []


def test_legacy_gt_is_never_reused(tmp_path):
    raw = struct.pack(">64I", (31 << 27) | (1 << 10) | 1,
                      0x07230002, *([0] * 61), 0x4a000007)
    (tmp_path / "legacy.lump").write_bytes(raw)
    doc = {"rows": [dict(slot=16, name="ide.Legacy", kind="lump", sequence=2,
                        selection=dict(filename="legacy.lump", binaryHash=hashlib.sha256(raw).hexdigest()))]}
    result = binding_report(doc, tmp_path, "exact")["lists"][0]
    assert result["status"] == "blocked"
    assert "Existing GTs were not reused" in result["reason"]
    assert result["rows"][0]["previousGT"] == 0x4a000007
    assert result["rows"][0]["newGT"] is None
    assert (tmp_path / "legacy.lump").read_bytes() == raw


def test_fresh_portable_linker_result_uses_new_sequence(tmp_path, monkeypatch):
    # Isolate the authenticated admission adapter; exercise the real linker.
    import server.namespace_binding_report as module
    raw = struct.pack(">64I", (31 << 27) | (1 << 10) | 1,
                      0x07230002, *([0] * 61), 0xFEED5E1F)
    (tmp_path / "self.lump").write_bytes(raw)
    dep = dict(N="ide.Test#1", rights=["E"], capability_type=1,
               symbolic_self=True, relocation_row=0)
    monkeypatch.setattr(module, "artifact_bindings", lambda rows, directory: [
        dict(slot=rows[0]["slot"], filename="self.lump",
             portableBinding=dict(dependencies=[dep]))])
    row = dict(slot=16, name="ide.Test", kind="lump", sequence=2,
               selection=dict(filename="self.lump", binaryHash=hashlib.sha256(raw).hexdigest()))
    first = binding_report({"rows": [row]}, tmp_path, "one")
    monkeypatch.setattr(module, "_localize_portable",
                        lambda *args: (_ for _ in ()).throw(AssertionError("Inspection must not link")))
    reopened = binding_report({"rows": [row]}, tmp_path, "one", bind_now=False)
    assert reopened["lists"][0]["words"] == first["lists"][0]["words"]
    assert reopened["lists"][0]["derivativeHash"] == first["lists"][0]["derivativeHash"]
    monkeypatch.undo()
    monkeypatch.setattr(module, "artifact_bindings", lambda rows, directory: [
        dict(slot=rows[0]["slot"], filename="self.lump",
             portableBinding=dict(dependencies=[dep]))])
    row["sequence"] = 3
    stale = binding_report({"rows": [row]}, tmp_path, "two", bind_now=False)
    assert stale["status"] == "blocked"
    assert "words" not in stale["lists"][0]
    second = binding_report({"rows": [row]}, tmp_path, "two")
    assert first["status"] == second["status"] == "complete"
    assert first["lists"][0]["rows"][0]["newGT"] == 0x4a020010
    assert second["lists"][0]["rows"][0]["newGT"] == 0x4a030010
    for report in (first, second):
        item = report["lists"][0]
        assert item["boundWords"][-1] == item["rows"][0]["newGT"]
        assert item["sourceWords"][-1] == 0xFEED5E1F
        assert item["sourceHash"] == hashlib.sha256(raw).hexdigest()
        assert item["derivativeHash"] == hashlib.sha256(
            struct.pack(">64I", *item["boundWords"])).hexdigest()
    assert (tmp_path / "self.lump").read_bytes() == raw


def test_save_returns_bound_report_without_activating(tmp_path):
    live = tmp_path / "ns-state.json"
    live.write_text('{"abstractions":[]}')
    store = DesignStore(tmp_path / "draft/phase1.json", tmp_path, live, phase1=True)
    before = store.read()
    saved = store.save(dict(document=before["document"], fingerprint=before["fingerprint"]))
    assert saved["bindingReport"]["fingerprint"] == saved["fingerprint"]
    assert saved["bindingReport"]["installed"] is False
    assert store.read()["document"] == before["document"]
    assert live.read_text() == '{"abstractions":[]}'

def test_portable_missing_target_is_reported_unresolved(tmp_path, monkeypatch):
    import server.namespace_binding_report as module
    raw = struct.pack(">64I", (31 << 27) | (1 << 10) | 2,
                      0x07230002, *([0] * 62))
    (tmp_path / "self.lump").write_bytes(raw)
    deps = [
        dict(N="ide.Test#1", rights=["E"], capability_type=1,
             symbolic_self=True, relocation_row=0),
        dict(N="ide.Missing#1", rights=["E"], capability_type=1,
             symbolic_self=False, relocation_row=1)]
    monkeypatch.setattr(module, "artifact_bindings", lambda rows, directory: [
        dict(slot=rows[0]["slot"], filename="self.lump",
             binaryHash=hashlib.sha256(raw).hexdigest(),
             portableBinding=dict(dependencies=deps))])
    row = dict(slot=16, name="ide.Test", kind="lump", sequence=2,
               selection=dict(filename="self.lump", binaryHash=hashlib.sha256(raw).hexdigest()))
    report = binding_report({"rows": [row]}, tmp_path, "exact")
    assert report["status"] == "unresolved"
    item = report["lists"][0]
    assert item["status"] == "unresolved"
    assert item["rows"][0]["status"] == "bound"
    assert item["rows"][1]["status"] == "unresolved"
    assert item["rows"][1]["newGT"] == item["boundWords"][-1] == 0
    assert item["rows"][1]["targetSlot"] is None
