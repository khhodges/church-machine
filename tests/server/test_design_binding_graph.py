"""Preparation must look up every binding against the same saved graph."""
import copy
import hashlib
import struct

from server import design_simulation as ds
from server.simulation_preparation import portable_snapshot_key


def test_binding_lookup_graph_does_not_absorb_prior_derivatives(tmp_path, monkeypatch):
    rows = [
        dict(slot=n, name=f"Program{n}", type="Inform", seq=0,
             filename=f"program{n}.lump", binary_hash="original")
        for n in (3, 4)
    ]
    source = []
    for row in rows:
        raw = struct.pack(">64I", *([0] * 64))
        (tmp_path / row["filename"]).write_bytes(raw)
        row["binary_hash"] = hashlib.sha256(raw).hexdigest()
        source.append(dict(slot=row["slot"], filename=row["filename"],
                           binaryHash=row["binary_hash"], portableBinding={}))
    original_rows, original_source = copy.deepcopy(rows), copy.deepcopy(source)
    monkeypatch.setattr(ds, "bindings", lambda *_: source)
    monkeypatch.setattr(ds, "selected_rows", lambda *_: copy.deepcopy(rows))
    monkeypatch.setattr("server.namespace_binding_targets.non_lump_rows", lambda *_: [])
    monkeypatch.setattr("server.namespace_binding_targets.naming_context", lambda: {})
    monkeypatch.setattr(ds, "api_only", lambda raw: raw)
    calls = []

    def localize(raw, binding, graph, contracts, directory):
        expected = portable_snapshot_key(raw, binding, original_rows, original_source)
        assert portable_snapshot_key(raw, binding, graph, contracts) == expected
        assert graph == original_rows
        assert contracts == original_source
        calls.append(binding["slot"])
        binding["symbolicReport"] = {"status": "bound"}
        # Even linker-owned mutations cannot contaminate the next lookup.
        graph[0]["binary_hash"] = "mutated by linker"
        contracts[0]["binaryHash"] = "mutated by linker"
        return raw[:-4] + struct.pack(">I", 0x4A000000 | binding["slot"]), 0

    monkeypatch.setattr(ds, "_localize_portable", localize)
    monkeypatch.setattr(ds, "generate_image", lambda *a, **k: (bytes(256), {}))
    document = {"rows": [dict(slot=r["slot"], name=r["name"],
                              sequence=0, kind="lump") for r in rows]}
    _, prepared, returned = ds.stage({}, document, tmp_path, 3)
    assert calls == [3, 4]
    assert all(r["binary_hash"] != original_rows[0]["binary_hash"] for r in prepared)
    assert all(r["simulationBinding"]["localizationReport"]["status"] == "bound"
               for r in prepared)
    assert returned == original_source
    assert rows == original_rows
