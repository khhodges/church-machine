import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
AUDIT = ROOT / "scripts" / "audit_legacy_lump_sidecars.py"
GUARD = ROOT / "scripts" / "check_no_operational_lump_sidecars.py"


def _run(script, *args):
    return subprocess.run(
        [sys.executable, str(script), *map(str, args)],
        text=True, capture_output=True, check=False,
    )


def test_audit_is_read_only_and_import_requires_explicit_acceptance(tmp_path):
    binary = bytearray(64 * 4)
    binary[:4] = (0xF8000400).to_bytes(4, "big")  # valid 64-word LUMP, cw=1
    binary = bytes(binary)
    import hashlib
    number = hashlib.sha256(b"Thing" + binary).hexdigest()[:8]
    filename = f"Thing.1.{number}.lump"
    sidecar_name = f"Thing.1.{number}.json"
    manifest = [{"token": number, "filename": filename}]
    (tmp_path / "manifest.json").write_text(json.dumps(manifest))
    (tmp_path / filename).write_bytes(binary)
    (tmp_path / sidecar_name).write_text(json.dumps({
        "token": number,
        "binary_hash": hashlib.sha256(binary).hexdigest(),
        "author": "Reviewed Author",
        "petname": "Reviewed Petname",
        "source": "must not be approved",
        "api_definition": {"methods": ["must not be approved"]},
        "methods": [{"name": "must not be approved"}],
        "grants": ["RWX"],
        "ns_slot": 7,
        "boot_resident": True,
        "cw": 1,
    }))
    before = (tmp_path / "manifest.json").read_bytes()

    audit = _run(AUDIT, "--lumps-dir", tmp_path)
    assert audit.returncode == 0
    assert (tmp_path / "manifest.json").read_bytes() == before
    assert not (tmp_path / "approvals.json").exists()
    assert "READ-ONLY AUDIT" in audit.stdout

    rejected = _run(AUDIT, "--lumps-dir", tmp_path, "--write")
    assert rejected.returncode != 0
    assert (tmp_path / "manifest.json").read_bytes() == before
    assert not (tmp_path / "approvals.json").exists()

    inert = _run(
        AUDIT, "--lumps-dir", tmp_path, "--accept", sidecar_name,
    )
    assert inert.returncode != 0
    assert not (tmp_path / "approvals.json").exists()

    wrong_name = _run(
        AUDIT, "--lumps-dir", tmp_path, "--write",
        "--accept", sidecar_name.lower(),
    )
    assert wrong_name.returncode != 0
    assert not (tmp_path / "approvals.json").exists()

    sidecar_path = tmp_path / sidecar_name
    tampered = json.loads(sidecar_path.read_text())
    tampered["filename"] = "Other.1.deadbeef.lump"
    sidecar_path.write_text(json.dumps(tampered))
    wrong_locator = _run(
        AUDIT, "--lumps-dir", tmp_path, "--write",
        "--accept", sidecar_name,
    )
    assert wrong_locator.returncode != 0
    assert not (tmp_path / "approvals.json").exists()
    tampered.pop("filename")
    sidecar_path.write_text(json.dumps(tampered))

    accepted = _run(
        AUDIT, "--lumps-dir", tmp_path, "--write",
        "--accept", sidecar_name,
    )
    assert accepted.returncode == 0, accepted.stderr
    assert (tmp_path / "manifest.json").read_bytes() == before
    store = json.loads((tmp_path / "approvals.json").read_text())
    digest = hashlib.sha256(binary).hexdigest()
    assert store == {
        "version": 1,
        "algorithm": "sha256",
        "approvals": {
            digest: {
                "author": "Reviewed Author",
                "pet_name": "Reviewed Petname",
                "binary_hash": digest,
                "filename": filename,
                "dot_name": "Thing",
                "issue_n": 1,
                "identity_hash": hashlib.sha256(b"Thing#1").hexdigest(),
            },
        },
    }
    from server.lump_integrity import (
        check_lump_canonical_integrity, resolve_canonical_lump,
    )
    assert check_lump_canonical_integrity(
        str(tmp_path), number, binary) is True
    resolution = resolve_canonical_lump(str(tmp_path), number, binary)
    assert resolution["ok"] and resolution["trusted"]
    assert (tmp_path / sidecar_name).exists()


def test_audit_repeatable_accepts_merge_atomically_into_canonical_store(tmp_path):
    import hashlib

    def add(name, author):
        binary = bytearray(64 * 4)
        binary[:4] = (0xF8000400).to_bytes(4, "big")
        binary[-1] = len(author)
        binary = bytes(binary)
        digest = hashlib.sha256(binary).hexdigest()
        number = hashlib.sha256(name.encode() + binary).hexdigest()[:8]
        stem = f"{name}.1.{number}"
        (tmp_path / f"{stem}.lump").write_bytes(binary)
        (tmp_path / f"{stem}.json").write_text(json.dumps({
            "binary_hash": digest,
            "author": author,
        }))
        return digest, f"{stem}.json"

    first_hash, first_sidecar = add("First", "First")
    second_hash, second_sidecar = add("Second", "Second")
    existing_hash = "0" * 64
    (tmp_path / "approvals.json").write_text(json.dumps({
        "version": 1,
        "algorithm": "sha256",
        "approvals": {
            existing_hash: {
                "binary_hash": existing_hash,
                "author": "Existing",
            },
        },
    }))
    result = _run(
        AUDIT, "--lumps-dir", tmp_path, "--write",
        "--accept", first_sidecar,
        "--accept", second_sidecar,
    )
    assert result.returncode == 0, result.stderr
    store = json.loads((tmp_path / "approvals.json").read_text())
    assert set(store["approvals"]) == {existing_hash, first_hash, second_hash}
    assert not list(tmp_path.glob(".approvals.json.*"))


def test_guard_rejects_manifest_pointer_and_new_runtime_dependency(tmp_path):
    (tmp_path / "server" / "lumps").mkdir(parents=True)
    (tmp_path / "simulator").mkdir()
    manifest_path = tmp_path / "server" / "lumps" / "manifest.json"
    manifest_path.write_text('[{"token":"1","sidecar_file":"1.json"}]')
    result = _run(GUARD, "--root", tmp_path)
    assert result.returncode != 0
    assert "forbidden non-locator/history fields" in result.stderr

    manifest_path.write_text("[]")
    (tmp_path / "server" / "new_runtime.py").write_text(
        "def load_sidecar(path):\n    return path\n"
    )
    result = _run(GUARD, "--root", tmp_path)
    assert result.returncode != 0
    assert "new_runtime.py" in result.stderr


def test_guard_allows_only_demonstrable_bitstream_metadata(tmp_path):
    (tmp_path / "server" / "lumps").mkdir(parents=True)
    (tmp_path / "simulator").mkdir()
    (tmp_path / "server" / "lumps" / "manifest.json").write_text("[]")
    (tmp_path / "server" / "app.py").write_text(
        "def write_bitstream(bit_path):\n"
        "    bit_meta_path = bit_path + '.meta.json'\n"
        "    return open(bit_meta_path, 'w')\n"
        "\ndef runtime(record):\n    return record.sidecar_file\n"
    )
    result = _run(GUARD, "--root", tmp_path)
    assert result.returncode != 0
    assert "server/app.py:6" in result.stderr
    assert "server/app.py:2" not in result.stderr


def test_guard_ignores_comments_labels_and_negative_assertions(tmp_path):
    (tmp_path / "server" / "lumps").mkdir(parents=True)
    (tmp_path / "server" / "lumps" / "manifest.json").write_text("{}")
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "negative.py").write_text(
        "# historical sidecar_file mention\n"
        "assert 'sidecar_file' not in record\n"
        "message = 'sidecar metadata is retired'\n"
    )
    result = _run(GUARD, "--root", tmp_path)
    assert result.returncode == 0, result.stderr


def test_guard_allows_only_immediate_unconditional_retired_routes(tmp_path):
    (tmp_path / "server" / "lumps").mkdir(parents=True)
    (tmp_path / "server" / "lumps" / "manifest.json").write_text("[]")
    app = tmp_path / "server" / "app.py"
    app.write_text(
        "@app.route('/api/lump/<token>/meta', methods=['PATCH'])\n"
        "def retired_meta(token):\n"
        "    \"\"\"Retired endpoint.\"\"\"\n"
        "    return jsonify({'error': 'retired'}), 410\n"
        "\n"
        "@app.route('/api/lump/<token>/wip-source', methods=['PATCH'])\n"
        "def unsafe_retired_source(token):\n"
        "    audit(token)\n"
        "    return jsonify({'error': 'retired'}), 410\n"
    )
    result = _run(GUARD, "--root", tmp_path)
    assert result.returncode != 0
    assert "server/app.py:6" in result.stderr
    assert "server/app.py:1" not in result.stderr


def test_guard_allows_negative_endpoint_tests_but_not_positive_calls(tmp_path):
    (tmp_path / "server" / "lumps").mkdir(parents=True)
    (tmp_path / "server" / "lumps" / "manifest.json").write_text("{}")
    (tmp_path / "tests").mkdir()
    test_file = tmp_path / "tests" / "test_retired.py"
    test_file.write_text(
        "def test_retired(client):\n"
        "    response = client.patch('/api/lump/12345678/meta')\n"
        "    assert response.status_code == 410\n"
        "    assert '/api/lump/<token>/wip-source' not in active_routes\n"
        "    message = '/meta endpoint is retired'\n"
        "\n"
        "def test_positive(client):\n"
        "    response = client.patch('/api/lump/12345678/wip-source')\n"
        "    assert response.status_code == 200\n"
    )
    result = _run(GUARD, "--root", tmp_path)
    assert result.returncode != 0
    assert "tests/test_retired.py:8" in result.stderr
    assert "tests/test_retired.py:2" not in result.stderr
    assert "tests/test_retired.py:4" not in result.stderr


def test_guard_never_allows_negative_assertion_to_open_per_lump_json(tmp_path):
    (tmp_path / "server" / "lumps").mkdir(parents=True)
    (tmp_path / "server" / "lumps" / "manifest.json").write_text("[]")
    (tmp_path / "tests").mkdir()
    (tmp_path / "tests" / "test_bad.py").write_text(
        "def test_bad(token):\n"
        "    assert not open(f'{token}.json').read()\n"
    )
    result = _run(GUARD, "--root", tmp_path)
    assert result.returncode != 0
    assert "tests/test_bad.py:2" in result.stderr


def test_guard_does_not_hide_sidecar_file_value_behind_retired_text(tmp_path):
    (tmp_path / "server" / "lumps").mkdir(parents=True)
    (tmp_path / "server" / "lumps" / "manifest.json").write_text("[]")
    (tmp_path / "server" / "bad.py").write_text(
        "record = {'sidecar_file': '12345678.json', 'note': 'retired'}\n"
    )
    result = _run(GUARD, "--root", tmp_path)
    assert result.returncode != 0
    assert "server/bad.py:1" in result.stderr


def test_guard_accepts_locator_and_history_only_manifest(tmp_path):
    (tmp_path / "server" / "lumps").mkdir(parents=True)
    (tmp_path / "server" / "lumps" / "manifest.json").write_text(json.dumps([{
        "token": "1234abcd",
        "filename": "Example.2.1234abcd.lump",
        "abstraction": "Example",
        "version": 2,
        "lump_version": 2,
        "compiled_at": 123.5,
        "archived": False,
        "forked": False,
        "variant_group": "compiled_example",
    }]))
    result = _run(GUARD, "--root", tmp_path)
    assert result.returncode == 0, result.stderr


def test_guard_rejects_manifest_authority_and_unknown_fields(tmp_path):
    (tmp_path / "server" / "lumps").mkdir(parents=True)
    manifest = tmp_path / "server" / "lumps" / "manifest.json"
    forbidden_fields = [
        "ns_slot", "cw", "cc", "lump_size", "binary_hash", "source",
        "api_definition", "methods", "capabilities", "profile", "language",
        "author", "authorized", "grants", "description", "display_name",
        "dot_name", "issue_n", "identity_hash",
    ]
    manifest.write_text(json.dumps([{
        "token": "1234abcd",
        "filename": "Example.1.1234abcd.lump",
        **{field: "not-authoritative" for field in forbidden_fields},
        "future_unreviewed_field": True,
    }]))
    result = _run(GUARD, "--root", tmp_path)
    assert result.returncode != 0
    for field in forbidden_fields:
        assert field in result.stderr
    assert "unknown fields outside locator/history allowlist" in result.stderr
    assert "future_unreviewed_field" in result.stderr


def test_guard_rejects_intrinsic_fields_in_approval_allowlist(tmp_path):
    (tmp_path / "server" / "lumps").mkdir(parents=True)
    (tmp_path / "server" / "lumps" / "manifest.json").write_text("[]")
    (tmp_path / "server" / "lump_approvals.py").write_text(
        "RECORD_FIELDS = frozenset({'binary_hash', 'author', 'methods', "
        "'capabilities', 'profile', 'language', 'source', 'api_definition', "
        "'cw', 'cc', 'allocation'})\n"
    )
    result = _run(GUARD, "--root", tmp_path)
    assert result.returncode != 0
    assert "approval RECORD_FIELDS admits intrinsic fields" in result.stderr
    for field in (
            "methods", "capabilities", "profile", "language", "source",
            "api_definition", "cw", "cc", "allocation"):
        assert field in result.stderr


def test_guard_accepts_extrinsic_hash_bound_approval_allowlist(tmp_path):
    (tmp_path / "server" / "lumps").mkdir(parents=True)
    (tmp_path / "server" / "lumps" / "manifest.json").write_text("[]")
    (tmp_path / "server" / "lump_approvals.py").write_text(
        "RECORD_FIELDS = frozenset({'binary_hash', 'author', 'documentation', "
        "'history_note', 'grants'})\n"
    )
    result = _run(GUARD, "--root", tmp_path)
    assert result.returncode == 0, result.stderr