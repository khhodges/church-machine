import hashlib
import json
import struct
from pathlib import Path

import pytest

from server.lump_variants import build_bundle, read_variant, summary
from server.compact_rebuild import freeze_context
from tests.server.test_lump_save_endpoint import app_module, _words_with_source, isolated_lumps


def test_bundle_roundtrip_and_exact_source(tmp_path):
    source = "abstraction ide.VariantExample {\ncapabilities { SELF E }\nmethod Run() {\n; retained comment\nRETURN\n}\n}\n"
    words = _words_with_source(source)
    words[2] |= 0x030000  # this fixture retains full source, not compact source
    raw = struct.pack(f">{len(words)}I", *words)
    bundle = build_bundle(raw, source, hashlib.sha256(source.encode()).hexdigest(),
                          app_module._parse_intrinsic_lump_content,
                          freeze_context({"language": "assembly"}))
    primary = bundle["bundle_id"]
    (tmp_path / (primary + ".variants.json")).write_text(json.dumps(bundle))
    assert set(summary(bundle)) == {"api", "compact", "full"}
    assert bundle["schema"] == 3
    assert all(item["encoding"] == "gzip" for item in bundle["profiles"].values())
    for profile in ("api", "compact", "full"):
        data, _ = read_variant(tmp_path, primary, profile)
        w = struct.unpack(f">{len(data)//4}I", data)
        content = app_module._parse_intrinsic_lump_content(w)
        assert w[1] == words[1] and w[-1] == words[-1]
        if profile == "api":
            assert content["source"] is None
        if profile == "full":
            assert content["source"] == source
    with pytest.raises(ValueError, match="attested source"):
        build_bundle(raw, source + "changed", bundle["source_sha256"],
                     app_module._parse_intrinsic_lump_content)
    bundle["profiles"]["full"]["sha256"] = "0" * 64
    (tmp_path / (primary + ".variants.json")).write_text(json.dumps(bundle))
    with pytest.raises(ValueError, match="hash|identity"):
        read_variant(tmp_path, primary, "full")


def test_variant_routes_and_exact_editor_source(tmp_path, monkeypatch):
    source = "abstraction ide.VariantExample {\ncapabilities { SELF E }\nmethod Run() {\nRETURN\n}\n}\n"
    words = _words_with_source(source)
    words[2] |= 0x030000
    raw = struct.pack(f">{len(words)}I", *words)
    bundle = build_bundle(raw, source, hashlib.sha256(source.encode()).hexdigest(),
                          app_module._parse_intrinsic_lump_content,
                          freeze_context({"language": "assembly"}))
    primary = bundle["bundle_id"]
    path = tmp_path / "primary.lump"
    path.write_bytes(raw)
    (tmp_path / (primary + ".variants.json")).write_text(json.dumps(bundle))
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(tmp_path))
    with app_module.app.test_client() as client:
        assert client.get(f"/api/lump-variants/{primary}").status_code == 200
        for profile in ("full", "api", "compact"):
            response = client.get(f"/api/lump-variants/{primary}/{profile}")
            assert response.status_code == 200
            assert hashlib.sha256(response.data).hexdigest() == bundle["profiles"][profile]["sha256"]
            from server.lump_file import unpack_lump
            packaged = client.get(summary(bundle)[profile]["url"])
            assert packaged.status_code == 200
            assert packaged.data[:2] == b"\x1f\x8b"
            assert unpack_lump(packaged.data) == response.data
            assert len(packaged.data) == summary(bundle)[profile]["file_bytes"]
            assert "Content-Encoding" not in packaged.headers
    result = {}
    app_module._attach_unverified_exact_source(result, str(path), {"variant_bundle_id": primary})
    assert result["editing_source"] == source
    # A new primary with the same display name cannot borrow the old source.
    path.write_bytes(raw + b"\0\0\0\0")
    result = {}
    app_module._attach_unverified_exact_source(result, str(path), {"variant_bundle_id": primary})
    assert "editing_source" not in result


@pytest.mark.parametrize("fail_bundle_write", [False, True])
@pytest.mark.parametrize("browser_candidate", [False, True])
@pytest.mark.parametrize("primary_tier", [None, 0])
def test_compile_plan_and_atomic_bundle_save(isolated_lumps, monkeypatch, fail_bundle_write, browser_candidate, primary_tier):
    monkeypatch.setenv("COMPILER_SIGNING_SECRET", "isolated-variant-test-key-" + "x" * 40)
    source = "// full source comment\nabstraction ide.VariantExample {\nmethod Read() {\nreturn(7);\n}\n}"
    with app_module.app.test_client() as client:
        compile_request = {"source": source, "language": "javascript"}
        if primary_tier is not None:
            compile_request["tier"] = primary_tier
        compiled = client.post("/api/compile", json=compile_request).get_json()
        assert compiled["ok"], compiled
        record = compiled["compiler_record"]
        payload = {"binary": compiled["words"], "metadata": {
            "abstraction": "ide.VariantExample", "language": "javascript",
            "artifact_only": True, "content_type": "code", "grants": ["E"],
            "capabilities": compiled["capabilities"], "submitted_source":
                app_module._parse_intrinsic_lump_content(compiled["words"])["source"],
            "source_required": True, "original_source": source, "save_variants": True,
            "compiler_record": record, "trust_origin": compiled["trust_origin"],
            "compiler_identity": record["compiler_identity"],
            "compiler_version": record["compiler_version"],
        }}
        if browser_candidate:
            for key in ("compiler_record", "trust_origin", "compiler_identity", "compiler_version"):
                payload["metadata"].pop(key)
            payload["metadata"]["compiler_candidate"] = True
        planned = client.post("/api/lumps/save-plan", json=payload)
        assert planned.status_code == 201, planned.get_json()
        plan = planned.get_json()
        intent = client.post("/api/lumps/approval-intent", json={
            "digest": plan["digest"], "action": plan["action"], "plan_id": plan["plan_id"],
            "confirmation": True, "approval": {"grants": ["E"], "capability_type": "inform"}})
        assert intent.status_code == 201, intent.get_json()
        payload["binary"] = plan["final_binary"]
        payload["metadata"].update(save_plan_id=plan["plan_id"],
                                    approval_intent=intent.get_json()["intent"])
        if isinstance(plan.get("compiler_record"), dict):
            payload["metadata"]["compiler_record"] = plan["compiler_record"]
        if fail_bundle_write:
            original = app_module.os.replace
            def fail(source_path, destination):
                if str(destination).endswith(".variants.json"):
                    raise OSError("injected variant publication failure")
                return original(source_path, destination)
            monkeypatch.setattr(app_module.os, "replace", fail)
        response = client.post("/api/lumps/save", json=payload)
        assert response.status_code == 428, response.get_json()
        response = client.post("/api/lumps/save", json=payload, headers={
            "X-Change-Confirmation": response.get_json()["change_confirmation"]["id"]})
        if fail_bundle_write:
            assert response.status_code == 500, response.get_json()
            assert not list(isolated_lumps.glob("*.variants.json"))
            assert json.loads((isolated_lumps / "manifest.json").read_text()) == []
        else:
            assert response.status_code == 200, response.get_json()
            assert len(list(isolated_lumps.glob("*.variants.json"))) == 1
            latest = client.get('/api/lumps/latest-primary/ide.VariantExample')
            assert latest.status_code == 200, latest.json
            assert latest.json["source"] == source
            assert latest.json["verified_bundle_source"] is True
            assert latest.json["intrinsic_source"] is (primary_tier is None)
            assert latest.json["words"] == payload["binary"]
