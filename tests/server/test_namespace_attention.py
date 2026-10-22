import json
import ast
import struct
import zlib
from pathlib import Path

import pytest

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
    assert all(x["nextStep"] for x in result["items"])
    assert any("ide.Pool" in x["detail"] for x in result["items"])
    doc["rows"].append({"name": "ide.Pool", "slot": 4, "kind": "mmio"})
    result = attention_report(doc, lumps, sources, lambda _: {}, "legacy")
    assert not any(x["category"] == "missing resource" for x in result["items"])
    source.write_text("abstraction ide.Mint { capabilities { SELF E } }")
    assert attention_report(doc, lumps, sources, lambda _: {}, "legacy")["items"] == []


def test_latest_revision_and_exact_selected_history(tmp_path, monkeypatch):
    monkeypatch.setattr("server.namespace_attention.unpack_lump", lambda raw: raw)
    (tmp_path / "old.lump").write_bytes(b"\0\0\0\x01")
    (tmp_path / "new.lump").write_bytes(b"\0\0\0\x02")
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
    assert "absent.lump" in report["items"][0]["nextStep"]


def test_missing_source_has_exact_revision_next_step(tmp_path, monkeypatch):
    monkeypatch.setattr("server.namespace_attention.unpack_lump", lambda raw: raw)
    (tmp_path / "callhome.lump").write_bytes(b"\x01\0\0\0")
    doc = {"rows": [dict(name="ide.WukongCallHome", slot=7, kind="lump",
                        selection={"filename": "callhome.lump"})]}
    report = attention_report(doc, tmp_path, tmp_path, lambda _: {}, "ascending")
    step = report["items"][0]["nextStep"]
    assert "callhome.lump" in step
    assert "verified source companion" in step
    assert "does not mean the binary is defective" in step


def test_unselected_placement_has_action(tmp_path):
    doc = {"rows": [dict(name="Unselected", slot=5, kind="lump")]}
    item = attention_report(doc, tmp_path, tmp_path, lambda _: {}, "legacy")["items"][0]
    assert "slot 5" in item["nextStep"]


def test_exact_companion_source_and_verification_errors(tmp_path, monkeypatch):
    monkeypatch.setattr("server.namespace_attention.unpack_lump", lambda raw: raw)
    (tmp_path / "selected.lump").write_bytes(b"\0\0\0\x01")
    doc = {"rows": [dict(name="A", slot=3, kind="lump", selection={"filename": "selected.lump"})]}
    calls = []
    def companion(filename):
        calls.append(filename)
        return {"editing_source": "abstraction A {}"}
    assert attention_report(doc, tmp_path, tmp_path, lambda _: {}, "ascending", companion)["items"] == []
    assert calls == ["selected.lump"]
    for response in ({"unverified_source": "abstraction A {}"},
                     {"variant_error": "hash mismatch", "editing_source": "abstraction A {}"}):
        report = attention_report(doc, tmp_path, tmp_path, lambda _: {}, "ascending", lambda _: response)
        assert report["items"][0]["category"] == "inspection warning"
    report = attention_report(doc, tmp_path, tmp_path, lambda _: {}, "ascending",
                              lambda _: {"editing_source": "abstraction A {\n; not implemented\n}"})
    assert report["items"][0]["category"] == "unfinished implementation"
    assert "verified exact-revision" in report["items"][0]["evidence"]


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


@pytest.mark.parametrize("compressed", [False, True])
@pytest.mark.parametrize("source", ["abstraction CallHome { method Run { RETURN } }", ""])
def test_real_embedded_source_parser_has_no_false_warning(tmp_path, compressed, source):
    # Use the production parser without importing the app and its startup jobs.
    app = Path(__file__).resolve().parents[2] / "server" / "app.py"
    function = next(n for n in ast.parse(app.read_text()).body
                    if isinstance(n, ast.FunctionDef) and n.name == "_parse_intrinsic_lump_content")
    namespace = {"json": json, "_struct": struct}
    exec(compile(ast.Module(body=[function], type_ignores=[]), str(app), "exec"), namespace)
    parse = namespace[function.name]
    api = json.dumps({"abstraction": "CallHome", "capabilities": [], "methods": []}).encode()
    encoded = source.encode()
    if compressed:
        compressor = zlib.compressobj(wbits=-15)
        encoded = compressor.compress(encoded) + compressor.flush()
    def words(raw):
        padded = raw + b"\0" * (-len(raw) % 4)
        return list(struct.unpack(f">{len(padded)//4}I", padded))
    # 256-word LUMP with one code word, followed by API/source frame.
    body = [0xf9000400, 0, 0xab000000 | ((5 if compressed else 1) << 16) | len(api)]
    body += words(api) + [len(encoded)] + words(encoded)
    body += [0] * (256 - len(body))
    assert parse(body)["source"] == source
    raw = struct.pack(">256I", *body)
    from server.lump_file import pack_lump
    (tmp_path / "callhome.lump").write_bytes(pack_lump(raw) if compressed else raw)
    doc = {"rows": [dict(name="CallHome", slot=7, kind="lump",
                        selection={"filename": "callhome.lump"})]}
    assert attention_report(doc, tmp_path, tmp_path, parse, "ascending")["items"] == []


def test_dependency_names_use_linker_naming_context(tmp_path, monkeypatch):
    monkeypatch.setattr("server.namespace_attention.naming_context",
                        lambda: {"node": "ide", "aliases": {"console": "ide.UART_DEV"}})
    monkeypatch.setattr("server.namespace_attention.unpack_lump", lambda raw: raw)
    (tmp_path / "callhome.lump").write_bytes(b"\0\0\0\x01")
    source = "abstraction ide.CallHome { capabilities { SELF E, ide.LED_DEV RW, console RW } }"
    doc = {"rows": [
        dict(name="ide.CallHome", slot=7, kind="lump", selection={"filename": "callhome.lump"}),
        dict(name="LED_DEV", slot=3, kind="mmio"),
        dict(name="UART_DEV", slot=8, kind="mmio")]}
    parse = lambda _: {"source": source}
    assert attention_report(doc, tmp_path, tmp_path, parse, "ascending")["items"] == []
    doc["rows"].pop()
    result = attention_report(doc, tmp_path, tmp_path, parse, "ascending")
    assert len(result["items"]) == 1
    assert "console" in result["items"][0]["detail"]
    assert "ide.LED_DEV" not in result["items"][0]["detail"]
