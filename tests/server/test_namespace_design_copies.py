import json

import pytest

from server.namespace_design_copies import catalog, duplicate, resolve_store
from server.namespace_design_v1 import phase1_seed, digest


@pytest.fixture
def saved(tmp_path):
    legacy = tmp_path / "ns-state.json"
    legacy.write_text('{"abstractions":[]}')
    store = resolve_store("phase1", "", tmp_path, legacy)
    document = phase1_seed()
    store.path.parent.mkdir(parents=True)
    store.path.write_text(json.dumps(document))
    return tmp_path, legacy, store, document


def payload(document, name="Development"):
    return dict(profile="phase1", sourceId="", fingerprint=digest(document), name=name)


def test_exact_independent_copy_without_binding_or_activation(saved, monkeypatch):
    root, legacy, source, document = saved
    import server.namespace_binding_report as binding
    monkeypatch.setattr(binding, "binding_report",
                        lambda *a, **k: pytest.fail("Duplication must not bind"))
    before = source.path.read_bytes(), legacy.read_bytes()
    result = duplicate(payload(document), root, legacy)
    identifier = result["copy"]["id"]
    target = resolve_store("phase1", identifier, root, legacy)
    assert target.read_document() == document
    assert result["copy"]["tested"] is False
    assert catalog(legacy)[0]["sourceFingerprint"] == digest(document)
    edited = target.read_document()
    edited["slotCount"] = 512
    target.save(dict(document=edited, fingerprint=digest(document)))
    assert target.read_document()["slotCount"] == 512
    assert (source.path.read_bytes(), legacy.read_bytes()) == before
    assert not (root / ".symbolic-bindings").exists()


@pytest.mark.parametrize("change", [
    {"fingerprint": "stale"}, {"name": ""}, {"name": "Original"},
    {"name": "\ninvalid"}, {"sourceId": "../escape"}, {"profile": "unknown"},
])
def test_reject_invalid_requests_without_copy(saved, change):
    root, legacy, source, document = saved
    request = payload(document)
    request.update(change)
    with pytest.raises((ValueError, OSError)):
        duplicate(request, root, legacy)
    assert catalog(legacy) == []
    assert source.read_document() == document


def test_name_collision_and_copy_of_copy(saved):
    root, legacy, source, document = saved
    first = duplicate(payload(document), root, legacy)["copy"]
    with pytest.raises(ValueError, match="already exists"):
        duplicate(payload(document, "development"), root, legacy)
    request = payload(document, "Another")
    request["sourceId"] = first["id"]
    second = duplicate(request, root, legacy)["copy"]
    assert second["sourceId"] == first["id"]
    assert len(catalog(legacy)) == 2
    with pytest.raises(ValueError, match="different profile"):
        resolve_store("ascending", first["id"], root, legacy)


def test_unsaved_source_is_not_a_tested_copy(tmp_path):
    legacy = tmp_path / "ns-state.json"
    with pytest.raises(ValueError, match="Save the source"):
        duplicate(payload(phase1_seed()), tmp_path, legacy)
    assert not (tmp_path / "design-drafts").exists()
