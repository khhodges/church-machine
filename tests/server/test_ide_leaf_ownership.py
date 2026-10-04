"""Real compile/save requests against disposable artifacts, never the live library."""
import copy
import json
import subprocess

import pytest
from bootstrap_test_support import isolate_application, reviewed_post

isolate_application()
from test_lump_save_endpoint import isolated_lumps
import server.app as app_module
from server import ide_leaf_policy


@pytest.fixture
def setup(isolated_lumps, monkeypatch):
    monkeypatch.setenv("COMPILER_SIGNING_SECRET", "leaf-fixture-only-" + "x" * 40)
    config_path = isolated_lumps / "ide-hierarchy.json"
    config_path.write_text(json.dumps({
        "node": "global.local",
        "aliases": {"RemoteUART": "global.remote.UART_TX"},
        "definitions": {"global.remote.UART_TX": ["W"]},
    }))
    monkeypatch.setattr(ide_leaf_policy, "CONFIG_PATH", str(config_path))
    before = (isolated_lumps / "ns-state.json").read_bytes()
    with app_module.app.test_client() as client:
        yield client, isolated_lumps, config_path
    assert (isolated_lumps / "ns-state.json").read_bytes() == before


def compile_candidate(client, declaration, extra=None):
    source = f"; @abstraction WukongCallHome\ncapabilities {{ SELF, {declaration} }}\nRETURN"
    response = client.post("/api/compile", json={
        "source": source, "language": "assembly", **(extra or {})})
    assert response.status_code == 200
    return source, response.get_json()


def payload(source, compiled):
    record = compiled["compiler_record"]
    return {"binary": compiled["words"], "metadata": {
        "abstraction": "WukongCallHome", "language": "assembly",
        "content_type": "code", "artifact_only": True,
        "capabilities": compiled["capabilities"], "submitted_source": source,
        "trust_origin": compiled["trust_origin"], "compiler_record": record,
        "compiler_identity": record["compiler_identity"],
        "compiler_version": record["compiler_version"],
    }}


def browser_save_gates(words, capabilities, config, final_plan=False):
    subprocess.run(["node", "simulator/test_thread_leaf_save_validation.js"],
                   input=json.dumps({"words": words, "capabilities": capabilities,
                                     "config": config, "finalPlan": final_plan}),
                   text=True, check=True, capture_output=True)


def save(client, candidate, browser_config=None):
    response = client.post("/api/lumps/save-plan", json=candidate)
    assert response.status_code == 201, response.get_json()
    plan = response.get_json()
    if browser_config is not None:
        browser_save_gates(plan["final_binary"], candidate["metadata"]["capabilities"],
                           browser_config, final_plan=True)
    intent = client.post("/api/lumps/approval-intent", json={
        "digest": plan["digest"], "action": plan["action"],
        "plan_id": plan["plan_id"], "confirmation": True,
        "approval": {"grants": ["E"], "capability_type": "inform"},
    })
    assert intent.status_code == 201, intent.get_json()
    result = reviewed_post(client, "/api/lumps/save", {
        "binary": plan["final_binary"],
        "metadata": dict(candidate["metadata"], compiler_record=plan.get("compiler_record", candidate["metadata"]["compiler_record"]),
                         save_plan_id=plan["plan_id"],
                         approval_intent=intent.get_json()["intent"]),
    })
    assert result.status_code == 200, result.get_json()
    return result.get_json()


def test_local_uart_permission_revision_and_history(setup):
    client, root, _ = setup
    source, compiled = compile_candidate(client, "UART_TX W")
    assert compiled["ok"], compiled
    first = save(client, payload(source, compiled))
    original = (root / first["filename"]).read_bytes()
    source, compiled = compile_candidate(client, "UART_TX RW")
    assert compiled["ok"], compiled
    assert compiled["capabilities"][1]["canonical_leaf"] == "global.local.UART_TX"
    second = save(client, payload(source, compiled))
    inspection = app_module._inspect_lump_binary(root / second["filename"])
    assert inspection["api_definition"]["capabilities"][1]["rights"] == ["R", "W"]
    assert any(path.read_bytes() == original for path in root.glob("*.lump"))
    assert second["filename"] != first["filename"]


def test_foreign_and_client_configuration_tampering(setup):
    client, root, config_path = setup
    _, good = compile_candidate(client, "RemoteUART W")
    assert good["ok"], good
    assert good["capabilities"][1]["canonical_leaf"] == "global.remote.UART_TX"
    _, bad = compile_candidate(client, "RemoteUART RW", {
        "_ide_hierarchy": {"node": "global.remote"},
        "ideHierarchy": {"node": "global.remote"},
    })
    assert not bad["ok"] and "Foreign leaf" in bad["error"]
    # Compile locally, then move to a different configured IDE. Its signed
    # binary still names the original leaf even if client metadata is replaced.
    source, compiled = compile_candidate(client, "UART_TX RW")
    candidate = payload(source, compiled)
    config_path.write_text(json.dumps({
        "node": "global.other", "definitions": {"global.local.UART_TX": ["W"]}}))
    forged = copy.deepcopy(candidate)
    forged["metadata"]["capabilities"][1]["canonical_leaf"] = "global.other.UART_TX"
    forged["metadata"]["ideHierarchy"] = {"node": "global.local"}
    rejected = client.post("/api/lumps/save-plan", json=forged)
    assert rejected.status_code == 422, rejected.get_json()
    assert "Foreign leaf" in rejected.get_json()["error"]
    assert json.loads((root / "manifest.json").read_text()) == []


def test_missing_malformed_configuration_and_self(setup):
    client, _, config_path = setup
    config_path.unlink()
    _, result = compile_candidate(client, "UART_TX RW")
    assert not result["ok"] and "Configure" in result["error"]
    config_path.write_text('{"node":"bad..path"}')
    _, result = compile_candidate(client, "UART_TX RW")
    assert not result["ok"] and "Configure" in result["error"]
    config_path.write_text('{"node":"global.local"}')
    for self_decl in ["SELF", "SELF E", "__SELF__"]:
        response = client.post("/api/compile", json={
            "language": "assembly",
            "source": f"; @abstraction SelfRule\ncapabilities {{ {self_decl} }}\nRETURN",
        }).get_json()
        assert response["ok"], response
        assert response["capabilities"][0]["rights"] == ["E"]
    response = client.post("/api/compile", json={
        "language": "assembly",
        "source": "; @abstraction SelfRule\ncapabilities { SELF RW }\nRETURN",
    }).get_json()
    assert not response["ok"]


@pytest.mark.parametrize("name", ["Thread.1", "Thread#1", "Boot.Thread"])
def test_permissionless_thread_alias_compile_save_and_foreign_guard(setup, name):
    client, root, config_path = setup
    for node, target in [("global.local", "global.local.Thread1"),
                         ("global.other", "global.local.Thread1")]:
        config_path.write_text(json.dumps({
            "node": node, "aliases": {name: target},
            "definitions": {target: []},
        }))
        source, compiled = compile_candidate(client, name)
        assert compiled["ok"], compiled
        assert compiled["capabilities"][1]["canonical_leaf"] == target
        assert compiled["capabilities"][1]["rights"] == []
        config = json.loads(config_path.read_text())
        browser_save_gates(compiled["words"], compiled["capabilities"], config)
        saved = save(client, payload(source, compiled), browser_config=config)
        cap = app_module._inspect_lump_binary(
            root / saved["filename"])["api_definition"]["capabilities"][1]
        assert cap["canonical_leaf"] == target and cap["rights"] == []
        # A legacy alias never turns the foreign leaf into a locally owned one.
        if node == "global.other":
            _, rejected = compile_candidate(client, name + " RW")
            assert not rejected["ok"] and "Foreign leaf" in rejected["error"]
        # A valid legacy alias must not poison unrelated local declarations.
        _, unrelated = compile_candidate(client, "UART_TX RW")
        assert unrelated["ok"], unrelated