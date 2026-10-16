"""Real signed compile and save planning; all storage is isolated by fixtures."""
from test_idx1_save_endpoint import client, isolated_lumps


def test_missing_target_compiles_and_reaches_signed_save_plan(client, isolated_lumps, monkeypatch):
    source = ("abstraction test.SymbolicCaller {\n"
              "capabilities { SELF E, ide.SelfTest E, ide.WukongCallHome E }\n"
              "method Run() {\nCALL ide.SelfTest.Run\nCALL ide.WukongCallHome.Run\nRETURN\n}\n}\n")
    response = client.post("/api/compile", json={
        "source": source, "language": "javascript", "tier": 2})
    compiled = response.get_json()
    assert response.status_code == 200 and compiled["ok"], compiled
    assert compiled["binding_status"] == "unresolved"
    assert compiled["warnings"] == []
    response = client.post("/api/lumps/save-plan", json={
        "binary": compiled["words"],
        "metadata": {
            "abstraction": "test.SymbolicCaller", "language": compiled["language"],
            "content_type": "code", "artifact_only": True,
            "capabilities": compiled["capabilities"],
            "original_source": source, "submitted_source": source, "output_profile": "full",
            "issue_number": 1,
        },
    })
    planned = response.get_json()
    assert response.status_code == 201 and planned.get("compiler_record"), planned
    from tests.server.test_idx1_save_endpoint import save
    from server import app as app_module
    from server.symbolic_binding import embedded
    import struct
    saved, _ = save(client, {
        "binary": compiled["words"],
        "metadata": {
            "abstraction": "test.SymbolicCaller", "language": compiled["language"],
            "content_type": "code", "artifact_only": True,
            "capabilities": compiled["capabilities"], "original_source": source,
            "submitted_source": source, "issue_number": 1,
        },
    })
    raw = (isolated_lumps / saved["filename"]).read_bytes()
    words = list(struct.unpack(f">{len(raw)//4}I", raw))
    assert embedded(words)["calls"][0]["full_name"] == "ide.SelfTest.Run"
    from server.simulation_preparation import artifact_bindings, _localize_symbolic
    import hashlib
    row = {"slot": 16, "seq": 1, "name": "test.SymbolicCaller", "type": "Inform",
           "resident": True, "boot_resident": True, "load_policy": "Resident",
           "filename": saved["filename"], "binary_hash": hashlib.sha256(raw).hexdigest(),
           "token": saved["token"]}
    bindings = artifact_bindings([row], isolated_lumps)
    assert bindings[0]["portableBinding"]["schema"] == "church.symbolic-lump-binding/v1"
    bound, _ = _localize_symbolic(raw, bindings[0], [row], bindings, isolated_lumps, bind_now=True)
    assert bindings[0]["symbolicReport"]["status"] == "unresolved"
    monkeypatch.setattr("server.symbolic_binding.bind",
                        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("Unexpected rebind")))
    loaded, _ = _localize_symbolic(raw, bindings[0], [row], bindings, isolated_lumps)
    assert loaded == bound
    assert (isolated_lumps / saved["filename"]).read_bytes() == raw
