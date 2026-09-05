import hashlib
import json
import struct
import sys
import threading
import types

import pytest

# Keep this focused server test independent of the live hardware boot catalogue,
# which deliberately validates the mutable IDE-selected resident binding at
# import time.
_trace_stub = types.ModuleType("hardware.wukong_trace_symbols")
_trace_stub.trace_metadata = lambda _nia: None
_trace_stub._disassemble_word = lambda word: f"0x{word:08X}"
sys.modules.setdefault("hardware.wukong_trace_symbols", _trace_stub)

import server.app as app_module


def _lump(cw=2, cc=1):
    words = [0] * 64
    words[0] = (0x1F << 27) | (cw << 10) | cc
    words[1] = 0x1F000000
    return struct.pack(">64I", *words)


def _self_defining_lump(source="return exact;"):
    api = json.dumps({"name": "Available"}, separators=(",", ":")).encode()
    api_words = (len(api) + 3) // 4
    source_bytes = source.encode()
    source_words = (len(source_bytes) + 3) // 4
    words = [0] * 64
    words[0] = (0x1F << 27) | (1 << 10) | 1
    words[1] = 0x1F000000
    words[2] = (0xAB << 24) | (0x03 << 16) | len(api)
    words[3:3 + api_words] = struct.unpack(
        f">{api_words}I", api.ljust(api_words * 4, b"\0"))
    pos = 3 + api_words
    words[pos] = len(source_bytes)
    words[pos + 1:pos + 1 + source_words] = struct.unpack(
        f">{source_words}I", source_bytes.ljust(source_words * 4, b"\0"))
    return struct.pack(">64I", *words)


def test_approval_intent_concurrent_replay_has_exactly_one_winner():
    digest = hashlib.sha256(_lump()).hexdigest()
    client = app_module.app.test_client()
    response = client.post("/api/lumps/approval-intent", json={
        "digest": digest, "action": "deploy", "confirmation": True,
        "approval": {"author": "reviewer"},
    })
    assert response.status_code == 201
    intent = response.get_json()["intent"]
    with client.session_transaction() as saved_session:
        session_id = saved_session["_lump_approval_session"]

    barrier = threading.Barrier(2)
    results = []
    results_lock = threading.Lock()

    def consume():
        with app_module.app.test_request_context("/"):
            app_module.session["_lump_approval_session"] = session_id
            barrier.wait()
            try:
                value = app_module._consume_lump_approval_intent(
                    intent, digest, "deploy")
                outcome = ("ok", value)
            except ValueError as exc:
                outcome = ("error", str(exc))
            with results_lock:
                results.append(outcome)

    threads = [threading.Thread(target=consume) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=5)
        assert not thread.is_alive()

    assert [kind for kind, _ in results].count("ok") == 1
    assert [kind for kind, _ in results].count("error") == 1
    assert next(value for kind, value in results if kind == "ok") == {
        "author": "reviewer"}
    assert intent not in app_module._LUMP_APPROVAL_INTENTS


def test_invalid_first_consumer_burns_approval_intent():
    digest = hashlib.sha256(_lump()).hexdigest()
    client = app_module.app.test_client()
    response = client.post("/api/lumps/approval-intent", json={
        "digest": digest, "action": "deploy", "confirmation": True,
        "approval": {},
    })
    intent = response.get_json()["intent"]
    with client.session_transaction() as saved_session:
        session_id = saved_session["_lump_approval_session"]

    with app_module.app.test_request_context("/"):
        app_module.session["_lump_approval_session"] = session_id
        with pytest.raises(ValueError):
            app_module._consume_lump_approval_intent(intent, "0" * 64, "deploy")
        with pytest.raises(ValueError):
            app_module._consume_lump_approval_intent(intent, digest, "deploy")
    assert intent not in app_module._LUMP_APPROVAL_INTENTS


def _approved_library(root, binary):
    from server.lump_integrity import compute_number
    digest = hashlib.sha256(binary).hexdigest()
    number = compute_number("Intrinsic", binary)
    filename = f"Intrinsic.1.{number}.lump"
    (root / filename).write_bytes(binary)
    (root / "manifest.json").write_text(json.dumps([{
        "token": number, "abstraction": "Intrinsic",
        "filename": filename, "lump_version": 1,
        "cw": 999, "cc": 999, "lump_size": 999,
    }]))
    (root / "approvals.json").write_text(json.dumps({
        "version": 1, "algorithm": "sha256", "approvals": {
            digest: {
                "binary_hash": digest, "filename": filename,
                "dot_name": "Intrinsic", "issue_n": 1,
                "identity_hash": hashlib.sha256(b"Intrinsic#1").hexdigest(),
                "abstraction": "Intrinsic", "author": "reviewer",
            }
        }
    }))
    return digest, number


def test_shared_inspector_rejects_non_exact_allocation():
    binary = _lump()
    facts = app_module._inspect_lump_binary(binary)
    assert (facts["cw"], facts["cc"], facts["lump_size"]) == (2, 1, 64)
    with pytest.raises(ValueError, match="header declares 64 words"):
        app_module._inspect_lump_binary(binary + b"\0\0\0\0")


def test_unapproved_exact_binary_is_available_but_not_authorized(
        tmp_path, monkeypatch):
    token = "1234abcd"
    binary = _self_defining_lump()
    digest = hashlib.sha256(binary).hexdigest()
    filename = "Available.lump"
    (tmp_path / filename).write_bytes(binary)
    (tmp_path / "Available_v1.lump").write_bytes(binary)
    (tmp_path / "manifest.json").write_text(json.dumps([{
        "token": token, "abstraction": "Available",
        "filename": filename, "lump_version": 2,
    }]))
    (tmp_path / "approvals.json").write_text(json.dumps({
        "version": 1, "algorithm": "sha256", "approvals": {},
    }))
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(tmp_path))
    monkeypatch.setattr(
        app_module, "LUMPS_MANIFEST_PATH", str(tmp_path / "manifest.json"))
    client = app_module.app.test_client()

    raw = client.get(f"/api/lump/{token}")
    assert raw.status_code == 200
    assert raw.data[4:] == binary
    assert raw.headers["X-Lump-Hash"] == f"sha256:{digest}"
    assert raw.headers["X-Lump-Trust"] == "untrusted"
    assert "X-Lump-Dot-Name" not in raw.headers
    assert "X-Lump-Identity-Hash" not in raw.headers

    detail = client.get(f"/api/lumps/{token}/detail").get_json()
    assert detail["binary_hash"] == digest
    assert detail["cw"] == 1
    assert detail["approved"] is False
    assert detail["trusted"] is False
    assert "dot_name" not in detail

    words = client.get(f"/api/lump/{token}/words").get_json()
    assert words["binary_hash"] == digest
    assert words["count"] == 64
    assert words["approved"] is False

    source = client.get("/api/lump-source/Available").get_json()
    assert source["source"] == "return exact;"
    assert source["binary_hash"] == digest
    assert source["approved"] is False

    catalog = client.get("/api/lumps/list").get_json()
    row = next(item for item in catalog if item.get("token") == token)
    assert row["binary_hash"] == digest
    assert row["approved"] is False
    assert row["cw"] == 1

    history = client.get(f"/api/lumps/{token}/history").get_json()["history"]
    archived = next(item for item in history if item["version"] == 1)
    assert archived["binary_hash"] == digest
    assert archived["approved"] is False
    assert archived["preview_enabled"] is True
    assert archived["restore_enabled"] is False
    preview = client.get(f"/api/lumps/{token}/words/1").get_json()
    assert preview["binary_hash"] == digest
    assert preview["approved"] is False
    assert preview["source"] == "return exact;"

    deploy = client.post("/api/lumps/deploy-authorize", json={"token": token})
    assert deploy.status_code == 403
    identity = app_module._resolve_canonical_lump(
        str(tmp_path), token, binary)
    assert identity["ok"] is False
    assert identity["reason"] == "approval-missing"


@pytest.mark.parametrize("field", [
    "methods", "capabilities", "content_type", "profile", "language",
    "cw", "cc", "lump_size", "source", "api_definition",
])
def test_strict_approval_rejects_intrinsic_or_embedded_fields(tmp_path, field):
    digest = "a" * 64
    value = [] if field in {"methods", "capabilities"} else "forbidden"
    (tmp_path / "approvals.json").write_text(json.dumps({
        "version": 1, "algorithm": "sha256",
        "approvals": {digest: {"binary_hash": digest, field: value}},
    }))
    with pytest.raises(ValueError, match="unsupported"):
        app_module._read_lump_approvals(str(tmp_path))


def test_detail_uses_binary_and_hash_approval_not_sidecar(tmp_path, monkeypatch):
    digest, token = _approved_library(tmp_path, _lump(cw=2, cc=1))
    (tmp_path / "deadbeef.json").write_text(json.dumps({
        "binary_hash": "0" * 64, "cw": 777, "author": "attacker"
    }))
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(tmp_path))

    response = app_module.app.test_client().get(f"/api/lumps/{token}/detail")

    assert response.status_code == 200
    body = response.get_json()
    assert body["binary_hash"] == digest
    assert body["cw"] == 2
    assert body["author"] == "reviewer"


def test_detail_inspects_exact_bytes_without_matching_approval(tmp_path, monkeypatch):
    digest, token = _approved_library(tmp_path, _lump())
    (tmp_path / "approvals.json").write_text(json.dumps({
        "version": 1, "algorithm": "sha256", "approvals": {}
    }))
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(tmp_path))

    response = app_module.app.test_client().get(f"/api/lumps/{token}/detail")

    assert response.status_code == 200
    body = response.get_json()
    assert body["binary_hash"] == digest
    assert body["approved"] is False
    assert body["trusted"] is False
    assert "dot_name" not in body


def test_sidecar_patch_endpoints_are_retired():
    client = app_module.app.test_client()
    assert client.patch("/api/lump/deadbeef/meta", json={"author": "x"}).status_code == 410
    assert client.patch("/api/lump/deadbeef/clist/0", json={"gt_word": 1}).status_code == 410


def test_approval_intent_is_issued_only_after_confirmation():
    digest = "a" * 64
    client = app_module.app.test_client()
    response = client.post("/api/lumps/approval-intent", json={
        "digest": digest, "action": "deploy", "confirmation": True,
        "approval": {"author": "reviewer", "grants": ["E"]},
    })
    assert response.status_code == 201
    assert response.get_json()["intent"]


def test_approval_intent_rejects_unconfirmed_or_unallowlisted_fields():
    client = app_module.app.test_client()
    digest = "b" * 64
    assert client.post("/api/lumps/approval-intent", json={
        "digest": digest, "action": "deploy", "confirmation": False, "approval": {},
    }).status_code == 400
    assert client.post("/api/lumps/approval-intent", json={
        "digest": digest, "action": "deploy", "confirmation": True,
        "approval": {"authorized": True},
    }).status_code == 400
    assert client.post("/api/lumps/approval-intent", json={
        "digest": digest, "action": "deploy", "confirmation": True,
        "approval": {"filename": "client-controlled.lump"},
    }).status_code == 400


def test_startup_binary_inspection_does_not_depend_on_late_legacy_helper(monkeypatch):
    api = json.dumps({"profile": "IoT"}, separators=(",", ":")).encode()
    api_words = (len(api) + 3) // 4
    padded = api + b"\0" * (api_words * 4 - len(api))
    words = [(0x1F << 27) | (1 << 10), 0,
             (0xAB << 24) | len(api)]
    words.extend(struct.unpack(f">{api_words}I", padded))
    words.extend([0] * (64 - len(words)))
    raw = struct.pack(">64I", *words)
    monkeypatch.delattr(app_module, "_lump_freespace_content", raising=False)

    facts = app_module._inspect_lump_binary(raw)

    assert facts["api_definition"] == {"profile": "IoT"}
    assert facts["source"] is None
    assert facts["content_profile"] == "api"


def test_transition_stages_hash_approval_with_binary_and_manifest(tmp_path):
    binary = _lump()
    digest = hashlib.sha256(binary).hexdigest()
    app_module._commit_lump_history_transition(
        lumps_dir=str(tmp_path),
        manifest_path=str(tmp_path / "manifest.json"),
        token8="deadbeef",
        manifest_entry={
            "token": "deadbeef", "abstraction": "Intrinsic",
            "filename": "Intrinsic.1.deadbeef.lump", "lump_version": 1,
        },
        binary_filename="Intrinsic.1.deadbeef.lump",
        binary_bytes=binary,
        approval_hash=digest,
        approval={"binary_hash": digest, "abstraction": "Intrinsic"},
    )
    assert (tmp_path / "Intrinsic.1.deadbeef.lump").read_bytes() == binary
    stored = app_module._matching_lump_approval(str(tmp_path), digest)
    assert stored["abstraction"] == "Intrinsic"
    assert stored["filename"] == "Intrinsic.1.deadbeef.lump"
    assert {p.name for p in tmp_path.glob("*.json")} == {
        "manifest.json", "approvals.json"
    }


def test_fork_requires_new_issue_and_never_creates_token_alias(
        tmp_path, monkeypatch):
    from server.lump_integrity import compute_number
    raw = _lump()
    digest = hashlib.sha256(raw).hexdigest()
    dot_name = "Forkable"
    token = compute_number(dot_name, raw)
    old_filename = f"{dot_name}.1.{token}.lump"
    new_filename = f"{dot_name}.2.{token}.lump"
    (tmp_path / old_filename).write_bytes(raw)
    (tmp_path / "manifest.json").write_text(json.dumps([{
        "token": token, "abstraction": dot_name,
        "filename": old_filename, "lump_version": 1,
    }]))
    (tmp_path / "approvals.json").write_text(json.dumps({
        "version": 1, "algorithm": "sha256", "approvals": {
            digest: {
                "binary_hash": digest, "filename": old_filename,
                "dot_name": dot_name, "issue_n": 1,
                "identity_hash": hashlib.sha256(b"Forkable#1").hexdigest(),
            },
        },
    }))
    monkeypatch.setattr(app_module, "LUMPS_DIR", str(tmp_path))
    client = app_module.app.test_client()
    intent_response = client.post("/api/lumps/approval-intent", json={
        "digest": digest, "action": "fork", "confirmation": True,
        "approval": {},
    })
    intent = intent_response.get_json()["intent"]

    response = client.post(f"/api/lump/{token}/fork-version", json={
        "approval_intent": intent, "issue_n": 2,
    })

    assert response.status_code == 200, response.get_json()
    assert not (tmp_path / f"{token}.lump").exists()
    assert not (tmp_path / old_filename).exists()
    assert (tmp_path / new_filename).read_bytes() == raw
    manifest = json.loads((tmp_path / "manifest.json").read_text())
    assert manifest[0]["filename"] == new_filename
    approval = app_module._matching_lump_approval(str(tmp_path), digest)
    assert approval["filename"] == new_filename
    assert approval["issue_n"] == 2
    assert approval["identity_hash"] == hashlib.sha256(b"Forkable#2").hexdigest()
    assert list(tmp_path.glob(f"{old_filename[:-5]}_v*.lump"))