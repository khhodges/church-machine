"""Reject new unresolved CALLs; reopen/bind historical saved bytes in isolation."""
from test_idx1_save_endpoint import client, isolated_lumps
from test_symbolic_binding import historical_words


def test_missing_target_compile_does_not_issue_save_evidence(client, isolated_lumps):
    source = ("abstraction test.SymbolicCaller {\n"
              "capabilities { SELF E, ide.SelfTest E, ide.WukongCallHome E, ide.LED_DEV RW, ide.Thread.2, ide.Thread.3 }\n"
              "method Run() {\nCALL ide.SelfTest.Run\nCALL ide.WukongCallHome.Run\nRETURN\n}\n}\n")
    response = client.post("/api/compile", json={
        "source": source, "language": "javascript", "tier": 2})
    compiled = response.get_json()
    assert not compiled["ok"], compiled
    assert "Cannot encode CALL" in compiled["error"]
    assert "words" not in compiled
    assert not compiled.get("compiler_record")


def test_historical_saved_lump_bind_and_reopen(client, isolated_lumps, monkeypatch):
    from server.symbolic_binding import embedded
    from server.lump_integrity import compute_number
    from server.lump_approvals import (
        configured_compiler_tcb_key, sign_compiler_record, write_approvals)
    import hashlib
    import struct
    words = historical_words()
    raw = struct.pack(f">{len(words)}I", *words)
    token = compute_number("ide.Probe", raw)
    saved = {"filename": f"ide.Probe.1.{token}.lump", "token": token}
    (isolated_lumps / saved["filename"]).write_bytes(raw)
    digest = hashlib.sha256(raw).hexdigest()
    # Model an already admitted historical artifact, not a new compile/save.
    # Sign only with the private fixture key; production verification stays real.
    write_approvals(str(isolated_lumps / "approvals.json"), {digest: {
        "binary_hash": digest, "filename": saved["filename"],
        "dot_name": "ide.Probe", "issue_n": 1,
        "portable_binding": embedded(words),
        "trust_origin": "trusted-home-ide",
        "compiler_identity": "historical-test-fixture", "compiler_version": "legacy",
        "compiler_record": sign_compiler_record(
            {"binary_hash": digest}, signing_key=configured_compiler_tcb_key()),
    }})
    assert embedded(words)["calls"][0]["full_name"] == "ide.SelfTest.Run"
    from server.simulation_preparation import artifact_bindings, _localize_symbolic
    row = {"slot": 16, "seq": 1, "name": "ide.Probe", "type": "Inform",
           "resident": True, "boot_resident": True, "load_policy": "Resident",
           "filename": saved["filename"], "binary_hash": hashlib.sha256(raw).hexdigest(),
           "token": saved["token"]}
    bindings = artifact_bindings([row], isolated_lumps)
    assert bindings[0]["portableBinding"]["schema"] == "church.symbolic-lump-binding/v1"
    # Preparation/loading without an explicit Bind preserves every portable
    # byte, including NULL SELF; it must not produce a local 4A... token.
    unbound, self_gt = _localize_symbolic(raw, bindings[0], [row], bindings, isolated_lumps)
    assert unbound == raw
    assert self_gt == 0
    assert not (isolated_lumps / ".symbolic-bindings").exists()
    bound, _ = _localize_symbolic(raw, bindings[0], [row], bindings, isolated_lumps, bind_now=True)
    assert bindings[0]["symbolicReport"]["status"] == "unresolved"
    from server.namespace_binding_report import binding_report
    document = {"rows": [dict(slot=16, sequence=1, name="ide.Probe", kind="lump",
        selection=dict(filename=saved["filename"], token=saved["token"],
                       binaryHash=hashlib.sha256(raw).hexdigest()))]}
    report = binding_report(document, isolated_lumps, "selected")
    assert report["status"] == "unresolved"
    item = report["lists"][0]
    assert item["words"] == list(struct.unpack(f">{len(bound)//4}I", bound))
    assert item["sourceWords"] == words
    assert item["derivativeHash"] == hashlib.sha256(bound).hexdigest()
    monkeypatch.setattr("server.symbolic_binding.bind",
                        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("Unexpected rebind")))
    loaded, _ = _localize_symbolic(raw, bindings[0], [row], bindings, isolated_lumps)
    assert loaded == bound
    reopened = binding_report(document, isolated_lumps, "selected", bind_now=False)
    assert reopened == report
    document["rows"][0]["sequence"] = 2
    stale = binding_report(document, isolated_lumps, "changed", bind_now=False)
    assert stale["status"] == "blocked"
    assert "words" not in stale["lists"][0]
    assert "No binding snapshot" in stale["lists"][0]["reason"]
    assert (isolated_lumps / saved["filename"]).read_bytes() == raw
