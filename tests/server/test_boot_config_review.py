"""Read-only review tests. Never import the production Flask app/storage."""
import ast
import copy
import json
import os
from pathlib import Path

from flask import Flask, request

from server.change_confirmation import describe_boot_config_change


def evidence():
    cfg = {
        "schemaVersion": 1, "targetBoard": "wukong-xc7a100t",
        "bootEntrySlot": 10, "slotRules": {"10": "Resident"},
        "step1": {"totalNamespaceWords": 16384, "namespaceLumpWords": 64,
                  "threadLumpWords": 256, "threadStackWords": 32,
                  "nsSlotsMax": 64, "threadCount": 3},
        "step2": {"lumps": []}, "step3": {"emptySlotCount": 0},
    }
    rows = [{"slot": 10, "name": "CapabilityTest", "token": "4a00000a",
             "filename": "CapabilityTest.exact.lump", "binary_hash": "a" * 64,
             "seq": 99, "issue_n": 7}]
    manifest = [{"token": "4a00000a", "filename": "CapabilityTest.exact.lump",
                 "binary_hash": "a" * 64, "abstraction": "CapabilityTest",
                 "lump_version": 33, "version": "semantic-not-saved-version"}]
    return cfg, rows, manifest


def review(before, after, rows, manifest, **kwargs):
    snapshot = copy.deepcopy((before, after, rows, manifest))
    result = "\n".join(describe_boot_config_change(before, after, rows, manifest, **kwargs))
    assert snapshot == (before, after, rows, manifest)
    return result


def test_step1_geometry_shows_pet_names_exact_saved_versions_and_deltas():
    before, rows, manifest = evidence()
    after = copy.deepcopy(before)
    after["step1"]["threadCount"] = 4
    result = review(before, after, rows, manifest)
    assert "step1.threadCount: 3 → 4" in result
    assert "NS[10]: pet name CapabilityTest" in result
    assert "saved version v33" in result
    assert "unchanged saved revision" in result
    assert "v99" not in result and "v7" not in result
    assert "semantic-not-saved-version" not in result
    assert "no new LUMP version" in result


def test_same_token_revisions_are_not_guessed_from_latest():
    before, rows, manifest = evidence()
    manifest.append(dict(manifest[0], filename="new.lump", lump_version=34,
                         binary_hash="b" * 64))
    result = review(before, before, rows, manifest)
    assert "saved version v33" in result and "v34" not in result
    del rows[0]["filename"]
    del rows[0]["binary_hash"]
    result = review(before, before, rows, manifest)
    assert "ambiguous saved revision" in result
    assert "saved version v" not in result


def test_resident_add_remove_and_preload_hash_select_exact_revision():
    before, rows, manifest = evidence()
    manifest.append(dict(manifest[0], filename="new.lump", lump_version=34,
                         binary_hash="b" * 64))
    after = copy.deepcopy(before)
    after["step2"]["lumps"] = [{"nsSlot": 10, "loadPolicy": "Preload",
                               "lumpToken": "4a00000a", "binaryHash": "b" * 64,
                               "lumpSize": 1024}]
    result = review(before, after, rows, manifest)
    assert "saved version v33" in result and "saved version v34" in result
    assert 'NS[10] placement.loadPolicy: (absent) → "Preload"' in result
    assert "added to Step-2 configuration" in result
    removed = review(after, before, rows, manifest)
    assert "removed from Step-2 configuration; saved binary is not deleted" in removed


def test_slot_policy_only_change_and_prepare_show_target_without_new_version():
    before, rows, manifest = evidence()
    after = copy.deepcopy(before)
    after["slotRules"]["10"] = "Lazy"
    result = review(before, after, rows, manifest, prepare=True)
    assert 'slotRules.10: "Resident" → "Lazy"' in result
    assert "Explicit Prepare" in result
    assert "Namespace boot target: NS[10] → NS[10]" in result
    assert "saved version v33" in result


def test_missing_generated_and_duplicate_evidence_is_explicit():
    before, rows, manifest = evidence()
    rows[0].pop("token")
    rows[0].pop("filename")
    rows[0].pop("binary_hash")
    assert "no exact saved record" in review(before, before, rows, manifest)
    before, rows, manifest = evidence()
    manifest[0].pop("lump_version")
    assert "missing saved lump_version" in review(before, before, rows, manifest)
    manifest.append(dict(manifest[0]))
    assert "ambiguous saved revision" in review(before, before, rows, manifest)
    before, rows, manifest = evidence()
    manifest[0]["lump_version"] = 0
    assert "saved version v0" in review(before, before, rows, manifest)
    rows.append(dict(rows[0], name="ConflictingPet"))
    assert "ambiguous Namespace slot" in review(before, before, rows, manifest)


def test_real_manifest_without_hash_requires_exact_binary_verification():
    before, rows, manifest = evidence()
    manifest[0].pop("binary_hash")
    assert "no exact saved record" in review(before, before, rows, manifest)
    inspected = []

    def verified_hash(record):
        inspected.append(record["filename"])
        return "a" * 64

    result = review(before, before, rows, manifest, binary_hash_for=verified_hash)
    assert "saved version v33" in result
    assert set(inspected) == {"CapabilityTest.exact.lump"}
    result = review(before, before, rows, manifest, binary_hash_for=lambda record: "b" * 64)
    assert "no exact saved record" in result


def test_actual_normalizer_preserves_labels_and_ignores_stale_boot_projection():
    before, rows, manifest = evidence()
    before["slotLabels"] = {"10": "CapabilityTest"}
    module = ast.parse((Path(__file__).parents[2] / "server/app.py").read_text())
    node = next(n for n in module.body if isinstance(n, ast.FunctionDef)
                and n.name == "_validated_boot_config_candidate")
    scope = {
        "_normalize_thread_config_policies": lambda data, rows: copy.deepcopy(data),
        "_validate_step1": lambda *args: None,
        "_normalize_step2_preload_bindings": lambda step2: (step2, None),
        "_validate_step2": lambda *args: None,
        "_validate_step3": lambda *args: None,
        "_validate_namespace_boot_marker": lambda authority: 10,
        "_validate_slot_rules": lambda rules: None,
        "BOOT_CONFIG_SCHEMA_VERSION": 1,
    }
    exec(compile(ast.Module(body=[node], type_ignores=[]), "<candidate>", "exec"), scope)
    # Actual Designer payload: complete step1/2/3; omitted slotRules/slotLabels.
    payload = {k: copy.deepcopy(before[k]) for k in ("targetBoard", "step1", "step2", "step3")}
    payload["bootEntrySlot"] = 99
    payload["step1"]["threadStackWords"] = 64
    payload["step2"]["lumps"] = [{
        "nsSlot": 18, "loadPolicy": "Resident", "abstraction": "SelectedPet",
        "lumpToken": "abcdef00", "physAddr": 8192, "lumpSize": 128,
    }]
    candidate, error = scope[node.name](payload, existing=before, authority_rows=rows)
    assert error is None
    assert candidate["slotLabels"] == before["slotLabels"]
    assert candidate["slotRules"] == before["slotRules"]
    manifest.append({"token": "abcdef00", "abstraction": "SelectedPet",
                     "filename": "selected.lump", "lump_version": 12})
    result = review(before, candidate, rows, manifest)
    assert "step1.threadStackWords: 32 → 64" in result
    assert "saved version v12" in result and "LUMP SelectedPet" in result
    assert "NS[99]" not in result
    assert "NS[18] placement.physAddr: (absent) → 8192" in result


def test_production_review_uses_normalized_candidate_and_saved_evidence(tmp_path):
    """Extract just review function; no application import or commit routes."""
    before, rows, manifest = evidence()
    config_path, manifest_path = tmp_path / "config.json", tmp_path / "manifest.json"
    config_path.write_text(json.dumps(before))
    manifest_path.write_text(json.dumps(manifest))
    module = ast.parse((Path(__file__).parents[2] / "server/app.py").read_text())
    node = next(n for n in module.body if isinstance(n, ast.FunctionDef)
                and n.name == "_describe_protected_change")
    calls = []

    def normalize(payload, existing, authority_rows):
        calls.append(payload)
        assert existing == before and authority_rows == rows
        normalized = copy.deepcopy(before)
        normalized["step1"]["threadCount"] = 4
        # Client bootEntrySlot is ignored by the real normalizer.
        return normalized, None

    scope = {"__file__": str(tmp_path / "server/app.py"), "request": request,
             "os": os, "json": json, "BOOT_CONFIG_PATH": str(config_path),
             "LUMPS_MANIFEST_PATH": str(manifest_path),
             "_read_authoritative_namespace_rows": lambda: (rows, {}),
             "_validated_boot_config_candidate": normalize,
             "_describe_boot_config_change": describe_boot_config_change}
    exec(compile(ast.Module(body=[node], type_ignores=[]), "<review>", "exec"), scope)
    app = Flask(__name__)
    payload = {"targetBoard": before["targetBoard"], "step1": before["step1"],
               "step2": {"lumps": []}, "step3": {"emptySlotCount": 0},
               "bootEntrySlot": 99}
    with app.test_request_context("/api/boot-config", method="POST", json=payload):
        result = "\n".join(scope[node.name](payload))
    assert calls == [payload]
    assert "saved version v33" in result
    assert "NS[99]" not in result
    assert "threadCount: 3 → 4" in result
    assert json.loads(config_path.read_text()) == before
    # Unreadable authority must not become a silently empty catalogue.
    manifest_path.write_text("invalid JSON")
    with app.test_request_context("/api/boot-config", method="POST", json=payload):
        result = "\n".join(scope[node.name](payload))
    assert "Authoritative boot review unavailable" in result
    assert "do not approve from hashes alone" in result