import json

from server.namespace_attention import attention_report, source_findings


def test_fault_labels_are_not_todos():
    assert not source_findings("TODO_BAD_INPUT:\n HARDFAULT \"invalid input\"")
    assert source_findings('HARDFAULT "Mint.DESTROY: not implemented"')


def test_fresh_sources_bindings_and_no_writes(tmp_path):
    lumps, sources = tmp_path / "lumps", tmp_path / "sources"
    lumps.mkdir()
    sources.mkdir()
    (lumps / "manifest.json").write_text("[]")
    source = sources / "mint.cloomc"
    source.write_text("abstraction ide.Mint {\ncapabilities { SELF E, ide.Pool RW }\n"
                      '; implementation in progress\n}')
    doc = {"rows": [{"name": "ide.Mint", "slot": 3, "kind": "mmio"}]}

    def snapshot():
        return {str(p): p.read_bytes() for p in tmp_path.rglob("*") if p.is_file()}

    before = snapshot()
    result = attention_report(doc, lumps, sources, lambda _: {}, "legacy")
    assert snapshot() == before
    assert {x["name"] for x in result["items"]} == {"ide.Mint"}
    assert any("ide.Pool" in x["detail"] for x in result["items"])
    doc["rows"].append({"name": "ide.Pool", "slot": 4, "kind": "mmio"})
    result = attention_report(doc, lumps, sources, lambda _: {}, "legacy")
    assert not any(x["category"] == "missing resource" for x in result["items"])
    source.write_text("abstraction ide.Mint { capabilities { SELF E } }")
    assert attention_report(doc, lumps, sources, lambda _: {}, "legacy")["items"] == []


def test_latest_revision_and_exact_selected_history(tmp_path, monkeypatch):
    monkeypatch.setattr("server.namespace_attention.unpack_lump", lambda raw: raw)
    (tmp_path / "old.lump").write_bytes(b"\x01\0\0\0")
    (tmp_path / "new.lump").write_bytes(b"\x02\0\0\0")
    (tmp_path / "manifest.json").write_text(json.dumps([
        dict(abstraction="A", filename="old.lump", compiled_at=1, lump_version=1),
        dict(abstraction="A", filename="new.lump", compiled_at=2, lump_version=2),
    ]))
    parse = lambda words: {"source": "abstraction A {\n; not implemented\n}" if words[0] == 1
                          else "abstraction A {}"}
    doc = {"rows": []}
    assert attention_report(doc, tmp_path, tmp_path, parse, "phase1")["items"] == []
    doc["rows"] = [dict(name="A", slot=4, kind="lump", selection={"filename": "old.lump"})]
    result = attention_report(doc, tmp_path, tmp_path, parse, "phase1")
    assert len(result["items"]) == 1
    assert result["items"][0]["evidence"] == "Saved LUMP: old.lump"


def test_missing_artifact_is_visible(tmp_path):
    (tmp_path / "manifest.json").write_text(json.dumps([
        dict(abstraction="Broken", filename="absent.lump")
    ]))
    doc = {"rows": [dict(name="Broken", slot=7, kind="lump",
                        selection={"filename": "absent.lump"})]}
    report = attention_report(doc, tmp_path, tmp_path, lambda _: {}, "ascending")
    assert report["items"][0]["category"] == "inspection warning"


def test_unassigned_sources_and_catalog_are_excluded(tmp_path):
    (tmp_path / "other.cloomc").write_text(
        "abstraction Unassigned {\n; not implemented\n}")
    (tmp_path / "manifest.json").write_text(json.dumps([
        dict(abstraction="Unassigned", filename="absent.lump")
    ]))
    assert attention_report({"rows": []}, tmp_path, tmp_path, lambda _: {}, "legacy")["items"] == []
    placed = {"rows": [dict(name="Unassigned", slot=3, kind="mmio")]}
    assert attention_report(placed, tmp_path, tmp_path, lambda _: {}, "phase1")["items"]
    assert attention_report({"rows": []}, tmp_path, tmp_path, lambda _: {}, "ascending")["items"] == []
