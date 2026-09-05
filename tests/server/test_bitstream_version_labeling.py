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
import subprocess
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


def _select_ui_firmware_display(cases):
    """Run the browser-independent Versions-card selector in Node."""
    run_path = os.path.join(ROOT, "simulator", "app-run.js")
    with open(run_path, encoding="utf-8") as handle:
        source = handle.read()
    start = source.index("function _selectBitstreamFirmwareDisplay")
    end = source.index("\n\n// ── Versions view", start)
    selector = source[start:end]
    script = (
        selector + "\n"
        f"const cases = {json.dumps(cases)};\n"
        "console.log(JSON.stringify(cases.map(c => "
        "_selectBitstreamFirmwareDisplay(c.bs, c.status))));\n"
    )
    result = subprocess.run(
        ["node", "-e", script],
        cwd=ROOT,
        check=True,
        text=True,
        capture_output=True,
    )
    return json.loads(result.stdout)


def _render_ui_bitstream(bs, status):
    """Run the actual Bitstream-card renderer with a minimal DOM in Node."""
    run_path = os.path.join(ROOT, "simulator", "app-run.js")
    with open(run_path, encoding="utf-8") as handle:
        source = handle.read()
    selector_start = source.index("function _selectBitstreamFirmwareDisplay")
    selector_end = source.index("\n\n// ── Versions view", selector_start)
    method_start = source.index("    _renderBitstream(bs, status) {")
    method_end = source.index("\n    },\n\n    _renderBitstreamRelease", method_start) + 6
    selector = source[selector_start:selector_end]
    method = source[method_start:method_end]
    method = method.replace(
        "    _renderBitstream(bs, status) {",
        "function _renderBitstream(bs, status) {",
        1,
    )
    script = (
        selector + "\n" + method + "\n"
        "const element = {innerHTML: ''};\n"
        "global.document = {getElementById: () => element};\n"
        "const context = {\n"
        "  _badge: (kind, label) => `<span data-kind=\"${kind}\">${label}</span>`,\n"
        "  _esc: value => String(value == null ? '' : value),\n"
        "  _age: () => '',\n"
        "};\n"
        f"_renderBitstream.call(context, {json.dumps(bs)}, {json.dumps(status)});\n"
        "console.log(JSON.stringify(element.innerHTML));\n"
    )
    result = subprocess.run(
        ["node", "-e", script],
        cwd=ROOT,
        check=True,
        text=True,
        capture_output=True,
    )
    return json.loads(result.stdout)


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


def test_tampered_bit_ignores_modern_sha256_sidecar(client, tmp_path):
    """A modern sidecar must verify both its legacy and release digests."""
    _upload(client, version=7, content=b"ORIGINAL CONTENT")
    sidecar_path = tmp_path / (BIT_NAME + ".meta.json")
    sidecar = json.loads(sidecar_path.read_text())
    sidecar["md5"] = __import__("hashlib").md5(b"REPLACED CONTENT").hexdigest()
    sidecar_path.write_text(json.dumps(sidecar))
    _write_bit(tmp_path, content=b"REPLACED CONTENT")

    with patch.object(app_module, "_wukong_build_version", return_value=7):
        status = client.get("/api/bitstream-status").get_json()
    assert status["firmware_version"] is None
    assert status["version_known"] is False


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
    assert 'href="/dl/wukong-bit"' in page
    assert "/dl/wukong-v17-" not in page
    assert "versionSuffix = d.version_known" in page
    assert 'id="ti60DlBridgeBtn"' in page
    assert 'href="/dl/wukong-bridge"' in page


def test_wukong_download_page_exposes_current_bridge(client):
    """The public Wukong page must offer the canonical native bridge."""
    response = client.get("/release/r12")
    assert response.status_code == 200
    page = response.get_data(as_text=True)
    assert 'href="/dl/wukong-bridge"' in page
    assert "wukong_bridge.py" in page


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

    assert "_selectBitstreamFirmwareDisplay(bs, status)" in run
    assert "Running board matches v" in run
    assert "running board" in run
    assert "Local bitstream metadata is unverified" in run


def test_versions_view_firmware_precedence_and_qualifiers():
    """Artifact, board, source, then unknown are selected without collapsing identities."""
    displays = _select_ui_firmware_display([
        {
            "bs": {
                "firmware_version": 17,
                "version_known": True,
                "source_version": 20,
            },
            "status": {"boot_info": {"build_version": 19}},
        },
        {
            "bs": {
                "firmware_version": None,
                "version_known": False,
                "source_version": 20,
            },
            "status": {"boot_info": {"build_version": 19}},
        },
        {
            "bs": {
                "firmware_version": None,
                "version_known": False,
                "source_version": 20,
            },
            "status": {"boot_info": None},
        },
        {
            "bs": {
                "firmware_version": None,
                "version_known": False,
                "source_version": None,
            },
            "status": {"boot_info": None},
        },
    ])

    assert displays[0]["fw"] == "17"
    assert displays[0]["qualifier"] == ""
    assert displays[0]["boardFw"] == "19"
    assert displays[1]["fw"] == "19"
    assert displays[1]["qualifier"] == "running board"
    assert displays[2]["fw"] == "20"
    assert displays[2]["qualifier"] == "source expectation"
    assert displays[3]["fw"] == "?"
    assert displays[3]["qualifier"] == ""


def test_versions_view_renders_source_expectation_when_no_bitstream_exists():
    """A missing physical artifact must not hide the independent source version."""
    html = _render_ui_bitstream(
        {
            "ok": True,
            "present": False,
            "firmware_version": None,
            "version_known": False,
            "source_version": 20,
        },
        {"boot_info": None, "expected_build_version": 20},
    )

    assert "firmware v20" in html
    assert "(source expectation)" in html
    assert "No bitstream built" in html
    assert "no downloadable bitstream or running-board version is available" in html


def test_versions_view_renders_unknown_when_no_bitstream_or_source_exists():
    """The no-artifact state remains unknown when every version source is absent."""
    html = _render_ui_bitstream(
        {
            "ok": True,
            "present": False,
            "firmware_version": None,
            "version_known": False,
            "source_version": None,
        },
        {"boot_info": None, "expected_build_version": None},
    )

    assert "firmware v?" in html
    assert "No bitstream built" in html
    assert "source expectation" not in html


def test_versions_view_qualifies_source_fallback_and_keeps_it_on_one_line():
    """Source identifies the expected build, never the unverified physical artifact."""
    run_path = os.path.join(ROOT, "simulator", "app-run.js")
    styles_path = os.path.join(ROOT, "simulator", "styles-base.css")
    with open(run_path, encoding="utf-8") as handle:
        run = handle.read()
    with open(styles_path, encoding="utf-8") as handle:
        styles = handle.read()

    assert "source expectation" in run
    assert "Source expectation only; the downloadable bitstream metadata is unverified" in run
    assert ".versions-value-qualifier" in styles
    assert "white-space: nowrap" in styles


def test_bitstream_status_exposes_source_version_even_without_trusted_artifact(
        client, tmp_path):
    """An unverified artifact still carries the independent source expectation."""
    _write_bit(tmp_path)
    with patch.object(app_module, "_wukong_build_version", return_value=20):
        status = client.get("/api/bitstream-status").get_json()

    assert status["firmware_version"] is None
    assert status["version_known"] is False
    assert status["source_version"] == 20


def test_bitstream_status_keeps_unknown_source_version_unknown(client, tmp_path):
    """The UI can retain firmware v? when artifact, board, and source are unknown."""
    _write_bit(tmp_path)
    with patch.object(app_module, "_wukong_build_version", return_value=None):
        status = client.get("/api/bitstream-status").get_json()

    assert status["firmware_version"] is None
    assert status["version_known"] is False
    assert status["source_version"] is None
    assert status["version_mismatch"] is False


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


def test_versions_api_accepts_matching_verified_provenance(client, tmp_path):
    """The release check must use the provenance key for the actual .bit file."""
    import hashlib

    commit = "a" * 40
    bit_path = _write_bit(tmp_path, content=b"VERIFIED WUKONG BUILD")
    meta = app_module._write_bitstream_sidecar(
        bit_path, version=17, source_commit=commit
    )
    mcs = b":020000040000FA\n:00000001FF\n"
    (tmp_path / MCS_NAME).write_bytes(mcs)
    provenance = {
        "schema_version": 1,
        "source_commit": commit,
        "source_tree_clean": True,
        "release_status": "verified",
        "sentinel": {"build_version": 17},
        "artifacts": {
            BIT_NAME: {
                "sha256": meta["sha256"],
                "size_bytes": len(b"VERIFIED WUKONG BUILD"),
            },
            MCS_NAME: {
                "sha256": hashlib.sha256(mcs).hexdigest(),
                "size_bytes": len(mcs),
            },
        },
    }
    (tmp_path / "church_wukong_xc7a100t.provenance.json").write_text(
        json.dumps(provenance)
    )
    with patch.object(app_module, "_wukong_build_version", return_value=17), \
            patch.object(app_module, "_git_full_head", return_value=commit):
        release = client.get("/api/bitstream-versions").get_json()["release"]

    assert release["pending"] is False
    assert release["artifact"]["provenance_verified"] is True

def test_bitstream_status_requires_complete_verified_release_bundle(client, tmp_path):
    """Download status is verified only when bit, sidecar, provenance, and MCS agree."""
    import hashlib

    commit = "a" * 40
    bit_path = _write_bit(tmp_path, content=b"VERIFIED WUKONG BUILD")
    meta = app_module._write_bitstream_sidecar(
        bit_path, version=17, source_commit=commit
    )
    mcs = b":020000040000FA\n:00000001FF\n"
    (tmp_path / MCS_NAME).write_bytes(mcs)
    provenance = {
        "schema_version": 1,
        "source_commit": commit,
        "source_tree_clean": True,
        "release_status": "verified",
        "sentinel": {"build_version": 17},
        "artifacts": {
            BIT_NAME: {
                "sha256": meta["sha256"],
                "size_bytes": len(b"VERIFIED WUKONG BUILD"),
            },
            MCS_NAME: {
                "sha256": hashlib.sha256(mcs).hexdigest(),
                "size_bytes": len(mcs),
            },
        },
    }
    (tmp_path / "church_wukong_xc7a100t.provenance.json").write_text(
        json.dumps(provenance)
    )

    status = client.get("/api/bitstream-status").get_json()
    assert status["release_verified"] is True
    assert status["artifact_sha256"] == meta["sha256"]
    assert status["mcs_sha256"] == hashlib.sha256(mcs).hexdigest()

    (tmp_path / MCS_NAME).write_bytes(mcs + b"tampered")
    tampered = client.get("/api/bitstream-status").get_json()
    assert tampered["release_verified"] is False
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
    assert "Open Build Approval &amp; review comments" in run


def test_versions_view_renders_build_status_guidance_and_state_mapping():
    """Versions exposes protected remote-build state without inventing a run."""
    index_path = os.path.join(ROOT, "simulator", "index.html")
    run_path = os.path.join(ROOT, "simulator", "app-run.js")
    styles_path = os.path.join(ROOT, "simulator", "styles-base.css")
    with open(index_path, encoding="utf-8") as handle:
        index = handle.read()
    with open(run_path, encoding="utf-8") as handle:
        run = handle.read()
    with open(styles_path, encoding="utf-8") as handle:
        styles = handle.read()

    assert 'id="versionsCardBuildStatus"' in index
    assert 'id="versionsBuildStatusBody"' in index
    assert "fetch('/api/wukong-build/status'" in run
    for label in ("Idle", "Queued", "Connecting", "Running", "Completed", "Failed"):
        assert f"'{label}'" in run or f'"{label}"' in run
    assert "No remote build has been started." in run
    assert "Next action:" in run
    assert "versions-build-status-meta" in styles


def test_versions_guidance_has_numbered_recovery_stop_conditions():
    """Mismatch advice tells users how to align source, hardware, and releases."""
    run_path = os.path.join(ROOT, "simulator", "app-run.js")
    with open(run_path, encoding="utf-8") as handle:
        run = handle.read()

    assert "Push the current IDE changes to GitHub." in run
    assert "Pull the latest GitHub commit into the IDE." in run
    assert "Start the Wukong bridge" in run
    assert "Press Refresh" in run
    assert "Freeze approval" in run
    assert "upload the resulting .bit" in run
    assert "Stop condition:" in run


def test_versions_view_includes_github_push_action():
    """GitHub differences expose the explicit push action and server route."""
    index_path = os.path.join(ROOT, "simulator", "index.html")
    run_path = os.path.join(ROOT, "simulator", "app-run.js")
    app_path = os.path.join(ROOT, "server", "app.py")
    with open(index_path, encoding="utf-8") as handle:
        index = handle.read()
    with open(run_path, encoding="utf-8") as handle:
        run = handle.read()
    with open(app_path, encoding="utf-8") as handle:
        app = handle.read()

    assert 'id="versionsGithubBody"' in index
    assert "versions-github-push-btn" in run
    assert "fetch('/api/github/push'" in run
    assert '@app.route("/api/github/push", methods=["POST"])' in app


def test_github_push_route_fails_closed_without_server_pat(client, monkeypatch):
    """The UI route must not attempt a push when its server credential is absent."""
    monkeypatch.setenv("GITHUB_PAT", "")
    response = client.post("/api/github/push")
    assert response.status_code == 503
    assert response.get_json()["success"] is False


def test_successful_push_invalidates_github_diff_cache():
    """A completed push must not leave the old file comparison cached."""
    app_module._versions_diff_cache.update(
        key=("old-local", "old-github", "repo"),
        ts=9999999999.0,
        payload={"in_sync": False, "counts": {"changed": 108}},
    )
    app_module._invalidate_versions_diff_cache()
    assert app_module._versions_diff_cache["payload"] is None
    assert app_module._versions_diff_cache["key"] is None

def test_bitstream_status_rejects_missing_identity_and_malformed_artifacts(client, tmp_path):
    """Invalid provenance shapes fail closed without turning status into a 500."""
    bit_path = _write_bit(tmp_path, content=b"VERIFIED WUKONG BUILD")
    meta = app_module._write_bitstream_sidecar(bit_path, version=None, source_commit=None)
    (tmp_path / MCS_NAME).write_bytes(b"MCS")
    provenance_path = tmp_path / "church_wukong_xc7a100t.provenance.json"
    provenance_path.write_text(json.dumps({
        "schema_version": 1,
        "source_tree_clean": True,
        "release_status": "verified",
        "sentinel": {},
        "artifacts": [],
    }))

    status = client.get("/api/bitstream-status")
    assert status.status_code == 200
    assert status.get_json()["release_verified"] is False
    assert meta["source_commit"] is None
