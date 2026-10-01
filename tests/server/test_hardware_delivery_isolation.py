"""Delivery admission tests. All application storage must be isolated."""
import hashlib
import os
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest

assert os.environ.get("CHURCH_TEST_ISOLATED_MODE") == "1"
assert all(os.environ.get(name) for name in (
    "CHURCH_TEST_LUMPS_DIR", "CHURCH_TEST_BOOT_CONFIG_PATH",
    "CHURCH_TEST_BUILD_SNAPSHOTS_DIR", "CHURCH_TEST_DB_PATH"))
import server.app as api


@pytest.mark.parametrize("url", [
    "/dl/wukong-bit", "/dl/wukong-mcs", "/dl/wukong-bscan",
    "/dl/wukong-v17-bit", "/dl/wukong-v17-mcs", "/dl/wukong-verilog",
    "/dl/wukong-zip", "/api/download/fpga-zip",
    "/api/download/fpga-verilog", "/api/download/fpga-sdc",
    "/api/download/fpga-peri", "/api/download/fpga-package",
    "/api/bitstream/download/wukong-xc7a100t",
    "/download/church_wukong_xc7a100t.v", "/download/church_wukong_xc7a100t.il",
])
def test_mutable_aliases_never_build_read_or_deliver(monkeypatch, url):
    def forbidden(*args, **kwargs):
        pytest.fail("Retired route invoked a file/build/hardware side effect")
    monkeypatch.setattr(api, "send_file", forbidden)
    monkeypatch.setattr(api, "build_fpga", forbidden)
    monkeypatch.setattr(api, "_wukong_build_dir", forbidden)
    response = api.app.test_client().get(url)
    assert response.status_code == 410
    assert response.json["decision"] == "approved_revision_required"
    assert response.json["dataChanged"] is False
    assert response.headers["Cache-Control"] == "no-store"


def test_hardware_handbook_advertises_only_approved_history():
    response = api.app.test_client().get("/release/r12")
    assert response.status_code == 200
    html = response.get_data(as_text=True)
    assert "/simulator/index.html?view=builder&amp;hardware-history=1" in html
    assert "Approved .bit delivery is supported" in html
    assert "project-package exports are unavailable" in html
    for retired in ("/dl/wukong-bit", "/dl/wukong-mcs", "/dl/wukong-zip",
                    "/dl/wukong-v17", "/dl/wukong-bscan", "/api/bitstream-status"):
        assert retired not in html


@pytest.fixture
def retained_delivery(tmp_path, monkeypatch):
    monkeypatch.setenv("REPORT_TOKEN", "isolated-delivery-test-token")
    monkeypatch.setattr(api, "_BUILD_SNAPSHOTS_DIR", str(tmp_path / "snapshots"))
    store = api._artifact_revision_store()
    source = "a" * 40
    ns = store.publish("namespace", {
        "approval_state": "approved", "source_commit": source, "hardware_version": 17,
    }, {"boot-image.bin": b"approved namespace"})
    data = b"approved historical bitstream"
    metadata = {
        "approval_state": "approved", "source_commit": source, "hardware_version": 17,
        "namespace_revision_id": ns, "build_record_id": 301,
    }
    revision = store.publish("bitstream", metadata, {"bitstream.bit": data})
    build = SimpleNamespace(status="succeeded", git_commit=source, hardware_version=17,
                            bit_hash=hashlib.md5(data).hexdigest(), upload_completed_at=None)
    monkeypatch.setattr(api.db.session, "get", lambda model, key: build if key == 301 else None)
    return store, revision, ns, data, metadata, build


def test_historical_delivery_survives_new_publication_without_activation(retained_delivery, monkeypatch):
    store, revision, namespace, data, metadata, build = retained_delivery
    # Another role publishes both a new configuration and new output.
    newer_ns = store.publish("namespace", dict(metadata, source_commit="b" * 40),
                             {"boot-image.bin": b"new configuration"})
    store.publish("bitstream", dict(metadata, namespace_revision_id=newer_ns),
                  {"bitstream.bit": b"new mutable selection"})
    before = vars(build).copy()
    monkeypatch.setattr(api, "_artifact_revision_store", lambda: store)
    original_file_path = store.file_path
    def file_path_during_publication(kind, selected, filename):
        # Simulate another role publishing while this request has already
        # admitted its chosen record but has not yet read the retained bytes.
        with ThreadPoolExecutor(max_workers=1) as pool:
            pool.submit(store.publish, "bitstream", dict(metadata, hardware_version=18),
                        {"bitstream.bit": b"parallel output"}).result()
        return original_file_path(kind, selected, filename)
    monkeypatch.setattr(store, "file_path", file_path_during_publication)
    client = api.app.test_client()
    url = f"/api/artifact-revisions/bitstream/{revision}/download"
    assert client.get(url).status_code == 401
    response = client.get(url, headers={"Authorization": "Bearer isolated-delivery-test-token"})
    assert response.status_code == 200
    assert response.data == data
    assert response.headers["X-Artifact-Revision"] == revision
    assert response.headers["X-Namespace-Revision"] == namespace
    assert response.headers["X-Artifact-SHA256"] == hashlib.sha256(data).hexdigest()
    assert response.headers["X-Wukong-Lifecycle-State"] == "downloaded"
    assert vars(build) == before  # neither upload nor flashing is implied


@pytest.mark.parametrize("failure", ["unapproved", "failed-build", "wrong-commit",
                                    "wrong-digest", "tampered", "missing", "simulation-upstream"])
def test_exact_delivery_fails_closed_without_latest_fallback(retained_delivery, failure):
    store, revision, _, data, metadata, build = retained_delivery
    if failure == "unapproved":
        revision = store.publish("bitstream", dict(metadata, approval_state="unverified"),
                                 {"bitstream.bit": data})
    elif failure == "failed-build":
        build.status = "failed"
    elif failure == "wrong-commit":
        build.git_commit = "f" * 40
    elif failure == "wrong-digest":
        build.bit_hash = "0" * 32
    elif failure == "tampered":
        with open(store.file_path("bitstream", revision, "bitstream.bit"), "wb") as stream:
            stream.write(b"different")
    elif failure == "simulation-upstream":
        upstream = store.publish("namespace", dict(metadata, purpose="approved-simulation"),
                                 {"boot-image.bin": b"simulation-only"})
        revision = store.publish("bitstream", dict(metadata, namespace_revision_id=upstream),
                                 {"bitstream.bit": data})
    else:
        revision = "0" * 64
    response = api.app.test_client().get(
        f"/api/artifact-revisions/bitstream/{revision}/download",
        headers={"Authorization": "Bearer isolated-delivery-test-token"})
    assert response.status_code == 409