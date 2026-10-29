import hashlib

import pytest
from flask import Flask
from server import experimental_downloads as module


@pytest.fixture
def client(monkeypatch):
    module.verified_bytes.cache_clear()
    monkeypatch.setattr(module, "FILES", {
        "candidate-EXPERIMENTAL.bit": (hashlib.sha256(b"fixture").hexdigest(), 7)})
    app = Flask(__name__)
    app.register_blueprint(module.downloads)
    yield app.test_client()
    module.verified_bytes.cache_clear()


def test_exact_public_download_without_board_or_approval(client, monkeypatch):
    monkeypatch.setattr(module, "_read_object", lambda key: b"fixture")
    response = client.get("/dl/wukong-experimental/candidate-EXPERIMENTAL.bit")
    assert response.status_code == 200
    assert response.data == b"fixture"
    assert response.headers["Content-Disposition"] == (
        "attachment; filename=candidate-EXPERIMENTAL.bit")
    assert response.headers["X-Artifact-Status"] == "experimental-not-release-approved"


def test_corrupt_object_fails_closed(client, monkeypatch):
    monkeypatch.setattr(module, "_read_object", lambda key: b"corrupt")
    response = client.get("/dl/wukong-experimental/candidate-EXPERIMENTAL.bit")
    assert response.status_code == 503
    assert b"corrupt" not in response.data


def test_unavailable_storage_is_explicit(client, monkeypatch):
    def fail(key):
        raise OSError("unavailable")
    monkeypatch.setattr(module, "_read_object", fail)
    assert client.get("/dl/wukong-experimental/candidate-EXPERIMENTAL.bit").status_code == 503


def test_unlisted_file_never_queries_storage(client, monkeypatch):
    def unexpected(key):
        pytest.fail("Storage must not be queried for unlisted files")
    monkeypatch.setattr(module, "_read_object", unexpected)
    assert client.get("/dl/wukong-experimental/private.bit").status_code == 404
