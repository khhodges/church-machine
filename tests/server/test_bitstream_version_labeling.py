"""
tests/server/test_bitstream_version_labeling.py

Regression coverage for truthful bitstream version labeling (Task #2522).

The /dl/wukong-bit download name and /api/bitstream-status firmware_version
must come from verified sidecar metadata about the actual .bit file on disk,
never from the current source WUKONG_BUILD_VERSION alone.

Covers:
  - Fresh upload with declared version → sidecar written, versioned download
    name, status reports the declared version with no mismatch.
  - Stale bit + newer source → mismatch warning, unversioned download name.
  - Missing sidecar → unversioned name, version unknown, mismatch flagged.
  - Tampered .bit (sidecar md5 no longer matches) → unversioned name.
  - Upload with non-integer version → 400.
"""

import json
import os
import sys
from unittest.mock import patch

import pytest

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import server.app as app_module

BIT_NAME = "church_wukong_xc7a100t.bit"
MCS_NAME = "church_wukong_xc7a100t.mcs"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(app_module, "_wukong_build_dir", lambda: str(tmp_path))
    # Keep uploads exercised without depending on a workspace secret.
    monkeypatch.setenv("REPORT_TOKEN", "bitstream-version-test-token")
    app_module.app.config["TESTING"] = True
    with app_module.app.test_client() as c:
        yield c


def _write_bit(tmp_path, content=b"\xff\x00BITSTREAM"):
    p = tmp_path / BIT_NAME
    p.write_bytes(content)
    return str(p)


def _upload(client, version=None, content=b"\xff\x00BITSTREAM"):
    import io
    data = {"file": (io.BytesIO(content), BIT_NAME)}
    if version is not None:
        data["version"] = str(version)
    return client.post("/upload/wukong-bit?token=bitstream-version-test-token", data=data,
                       content_type="multipart/form-data")


# ---------------------------------------------------------------------------
# Fresh upload → self-describing sidecar, versioned name
# ---------------------------------------------------------------------------

def test_upload_writes_sidecar_and_versioned_download(client, tmp_path):
    r = _upload(client, version=7)
    assert r.status_code == 200
    body = r.get_json()
    assert body["ok"] is True and body["version"] == 7

    sidecar = tmp_path / (BIT_NAME + ".meta.json")
    assert sidecar.is_file()
    meta = json.loads(sidecar.read_text())
    assert meta["version"] == 7
    assert meta["md5"] == body["md5"]
    assert meta["built_at"]

    dl = client.get("/dl/wukong-bit")
    assert dl.status_code == 200
    assert "church_wukong_xc7a100t_v7.bit" in dl.headers["Content-Disposition"]

    with patch.object(app_module, "_wukong_build_version", return_value=7):
        st = client.get("/api/bitstream-status").get_json()
    assert st["firmware_version"] == 7
    assert st["version_known"] is True
    assert st["version_mismatch"] is False
    assert st["mismatch_message"] is None


# ---------------------------------------------------------------------------
# Stale bit + newer source → mismatch warning, unversioned name
# ---------------------------------------------------------------------------

def test_stale_bit_newer_source_mismatch_and_unversioned_name(client, tmp_path):
    _upload(client, version=7)
    with patch.object(app_module, "_wukong_build_version", return_value=8):
        st = client.get("/api/bitstream-status").get_json()
        dl = client.get("/dl/wukong-bit")
    assert st["source_version"] == 8
    assert st["firmware_version"] == 7
    assert st["version_mismatch"] is True
    assert "v8" in st["mismatch_message"] and "v7" in st["mismatch_message"]
    # Download name must carry the bitstream's own version, never source's v8
    cd = dl.headers["Content-Disposition"]
    assert "v8" not in cd
    assert "church_wukong_xc7a100t_v7.bit" in cd


# ---------------------------------------------------------------------------
# Missing sidecar → unversioned name, version unknown, mismatch flagged
# ---------------------------------------------------------------------------

def test_missing_sidecar_unversioned_name(client, tmp_path):
    _write_bit(tmp_path)  # .bit exists with no sidecar
    with patch.object(app_module, "_wukong_build_version", return_value=8):
        st = client.get("/api/bitstream-status").get_json()
        dl = client.get("/dl/wukong-bit")
    assert st["present"] is True
    assert st["firmware_version"] is None
    assert st["version_known"] is False
    assert st["version_mismatch"] is True
    assert "unknown" in st["mismatch_message"]
    cd = dl.headers["Content-Disposition"]
    assert "church_wukong_xc7a100t.bit" in cd
    assert "_v" not in cd


# ---------------------------------------------------------------------------
# Tampered bit (md5 mismatch) → sidecar untrusted, unversioned name
# ---------------------------------------------------------------------------

def test_tampered_bit_ignores_sidecar(client, tmp_path):
    _upload(client, version=7)
    # Replace the .bit without updating the sidecar
    _write_bit(tmp_path, content=b"DIFFERENT CONTENT")
    with patch.object(app_module, "_wukong_build_version", return_value=7):
        st = client.get("/api/bitstream-status").get_json()
        dl = client.get("/dl/wukong-bit")
    assert st["firmware_version"] is None
    assert st["version_known"] is False
    assert st["version_mismatch"] is True
    cd = dl.headers["Content-Disposition"]
    assert "_v" not in cd


# ---------------------------------------------------------------------------
# Upload without version → sidecar records null version; upload with a bad
# version string → 400
# ---------------------------------------------------------------------------

def test_upload_without_version_is_unversioned_but_trusted(client, tmp_path):
    r = _upload(client)
    assert r.status_code == 200 and r.get_json()["version"] is None
    dl = client.get("/dl/wukong-bit")
    assert "_v" not in dl.headers["Content-Disposition"]
    st = client.get("/api/bitstream-status").get_json()
    assert st["version_known"] is False


def test_upload_rejects_non_integer_version(client):
    r = _upload(client, version="banana")
    assert r.status_code == 400


def test_rejected_upload_preserves_previous_bitstream(client, tmp_path):
    """A rejected upload must not replace or corrupt the served artifact."""
    good = b"GOOD CONTENT v7"
    _upload(client, version=7, content=good)
    r = _upload(client, version="banana", content=b"BAD NEW CONTENT")
    assert r.status_code == 400
    # Previous .bit untouched and sidecar still trusted
    assert (tmp_path / BIT_NAME).read_bytes() == good
    st = client.get("/api/bitstream-status").get_json()
    assert st["firmware_version"] == 7 and st["version_known"] is True
    dl = client.get("/dl/wukong-bit")
    assert "church_wukong_xc7a100t_v7.bit" in dl.headers["Content-Disposition"]
    # No temp leftovers
    assert not list(tmp_path.glob("*.uploading*"))


def test_newer_bitstream_than_source_also_warns(client, tmp_path):
    """Any version disagreement is a mismatch, not just stale-bit."""
    _upload(client, version=9)
    with patch.object(app_module, "_wukong_build_version", return_value=8):
        st = client.get("/api/bitstream-status").get_json()
    assert st["version_mismatch"] is True
    assert "v8" in st["mismatch_message"] and "v9" in st["mismatch_message"]


def test_persistent_mcs_download_and_status(client, tmp_path):
    """The release page can advertise the SPI-flash image independently of .bit."""
    payload = b":020000040000FA\n:00000001FF\n"
    (tmp_path / MCS_NAME).write_bytes(payload)

    response = client.get("/dl/wukong-mcs")
    assert response.status_code == 200
    assert response.data == payload
    assert MCS_NAME in response.headers["Content-Disposition"]

    status = client.get("/api/bitstream-status").get_json()
    assert status["mcs_present"] is True
    assert status["mcs_size_bytes"] == len(payload)


def test_release_page_explains_temporary_bit_and_persistent_mcs(client):
    """The release page must steer reset-proof installs to the SPI-flash image."""
    response = client.get("/release/r12")
    assert response.status_code == 200
    page = response.get_data(as_text=True)
    assert "Download .mcs (persistent)" in page
    assert "volatile configuration" in page
    assert "n25q64-3.3v-spi-x1_x2_x4" in page


def test_connect_card_exposes_persistent_mcs_download():
    """The in-IDE Connect card must not hide the reset-proof download path."""
    index_path = os.path.join(ROOT, "simulator", "index.html")
    with open(index_path, encoding="utf-8") as handle:
        page = handle.read()

    assert 'id="ti60DlMcsBtn"' in page
    assert 'href="/dl/wukong-mcs"' in page
    assert "Download .mcs (persistent)" in page
    assert "d.mcs_present" in page
    assert "automatic boot after reset" in page


def test_bitstream_version_log_keeps_remote_build_and_verified_upload_distinct(
        client, tmp_path):
    """A rebuild cannot claim an artifact hash until a matching upload verifies it."""
    remote = app_module._record_bitstream_version_event(
        status="succeeded",
        version=17,
        source="remote-vivado",
        source_commit="abc123456789",
    )
    assert remote["bit_hash"] is None

    response = client.get("/api/bitstream-versions")
    assert response.status_code == 200
    rows = response.get_json()["versions"]
    assert len(rows) == 1
    assert rows[0]["version"] == 17
    assert rows[0]["source"] == "remote-vivado"
    assert rows[0]["bit_hash"] is None

    upload = _upload(client, version=17, content=b"VERIFIED WUKONG BUILD")
    assert upload.status_code == 200
    rows = client.get("/api/bitstream-versions").get_json()["versions"]
    assert len(rows) == 2
    assert rows[0]["source"] == "verified-upload"
    assert rows[0]["version"] == 17
    assert rows[0]["bit_hash"] == upload.get_json()["md5"]
    assert rows[1]["source"] == "remote-vivado"


def test_versions_view_includes_bitstream_log_panel():
    """The Builder Versions tab must offer the persisted rebuild log."""
    index_path = os.path.join(ROOT, "simulator", "index.html")
    run_path = os.path.join(ROOT, "simulator", "app-run.js")
    with open(index_path, encoding="utf-8") as handle:
        index = handle.read()
    with open(run_path, encoding="utf-8") as handle:
        run = handle.read()

    assert 'id="versionsBitstreamLogBody"' in index
    assert "/api/bitstream-versions" in run
    assert "_renderBitstreamLog(bitstreamLog)" in run


def test_versions_view_uses_board_sentinel_when_local_bit_metadata_is_unknown():
    """A live sentinel may identify the running board without relabeling .bit."""
    run_path = os.path.join(ROOT, "simulator", "app-run.js")
    with open(run_path, encoding="utf-8") as handle:
        run = handle.read()

    assert "artifactVersionKnown" in run
    assert "boardVersionKnown" in run
    assert "Running board matches v" in run
    assert "Local bitstream metadata is unverified" in run


def test_versions_api_exposes_pending_main_workstream_release(client, tmp_path):
    """Hardware commits waiting for synthesis are visible before a build runs."""
    bit_path = _write_bit(tmp_path, content=b"OLDER WUKONG BUILD")
    app_module._write_bitstream_sidecar(
        bit_path, version=14, source_commit=None
    )
    with patch.object(app_module, "_wukong_build_version", return_value=16), \
            patch.object(app_module, "_git_short_hash", return_value="ed2acb68"), \
            patch.object(app_module, "_git_full_head", return_value="ed2acb68"):
        response = client.get("/api/bitstream-versions")

    assert response.status_code == 200
    release = response.get_json()["release"]
    assert release["pending"] is True
    assert release["source_version"] == 16
    assert release["artifact"]["version"] == 14
    assert release["baseline_known"] is False
    assert release["reason"]


def test_versions_view_renders_release_candidate_and_build_action():
    """The Versions tab provides a single path into the existing release flow."""
    index_path = os.path.join(ROOT, "simulator", "index.html")
    run_path = os.path.join(ROOT, "simulator", "app-run.js")
    with open(index_path, encoding="utf-8") as handle:
        index = handle.read()
    with open(run_path, encoding="utf-8") as handle:
        run = handle.read()

    assert 'id="versionsReleaseBody"' in index
    assert "_renderBitstreamRelease(bitstreamLog && bitstreamLog.release)" in run
    assert "Review &amp; release in Build Approval" in run
