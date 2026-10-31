"""Ordinary compile/finalize/review/save/reopen, in a disposable artifact directory."""
import json
import subprocess
from pathlib import Path
from bootstrap_test_support import isolate_application, reviewed_post

isolate_application()
import server.app as app_module


def test_typed_mint_compiles_saves_and_reopens_exactly(tmp_path, monkeypatch):
    monkeypatch.setenv("COMPILER_SIGNING_SECRET", "isolated-mint-v4-test-signing-" + "a" * 32)
    for name in ("LUMPS_DIR", "_LUMPS_DIR"):
        monkeypatch.setattr(app_module, name, str(tmp_path))
    monkeypatch.setattr(app_module, "LUMPS_MANIFEST_PATH", str(tmp_path / "manifest.json"))
    (tmp_path / "manifest.json").write_text("[]")
    (tmp_path / "ns-state.json").write_text(json.dumps({"revision": 0, "abstractions": []}))
    source = subprocess.check_output(
        ["node", "-e", "process.stdout.write(require('./scripts/build_mint_v4_candidate').build().source)"],
        cwd=Path(__file__).resolve().parents[2], text=True)
    with app_module.app.test_client() as client:
        response = client.post("/api/compile", json={"source": source, "language": "assembly"})
        assert response.status_code == 200
        compiled = response.get_json()
        assert compiled["ok"], compiled
        metadata = {"abstraction": "ide.Mint", "dot_name": "ide.Mint", "issue_n": 1,
                    "source": source, "language": "assembly", "artifact_only": True,
                    **{key: compiled[key] for key in (
                        "trust_origin", "compiler_identity", "compiler_version", "compiler_record")}}
        response = client.post("/api/lumps/finalize", json={
            "binary": compiled["words"], "metadata": metadata})
        assert response.status_code == 201, response.get_json()
        finalized = response.get_json()
        metadata.update(compiler_record=finalized["compiler_record"], save_plan=finalized["plan"])
        response = reviewed_post(client, "/api/lumps/save", {
            "binary": finalized["final_binary"], "metadata": metadata})
        assert response.status_code == 200, response.get_json()
        saved = response.get_json()
        assert saved["committed"]
        response = client.get(f"/api/lump/{saved['token']}/words")
        assert response.status_code == 200, response.get_json()
        reopened = response.get_json()
        assert reopened.get("editing_source") == source or reopened.get("source") == source
        assert json.loads((tmp_path / "ns-state.json").read_text())["abstractions"] == []
