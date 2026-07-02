"""
tests/test_dl_ti60_hex.py

Unit tests for the /dl/ti60-hex download route in server/app.py.

Four scenarios:
  1. Local file present   → 200, Content-Disposition: attachment
  2. Local absent + GitHub mock returns bytes → 200, Content-Disposition: attachment
  3. Local absent + GitHub mock raises        → 404, plain-text error body
  4. Integration: upstream server hangs → route terminates within read_timeout + margin
"""

import os
import sys
import io
import pathlib
import socket
import threading
import time
from unittest.mock import MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Ensure server/ is importable as a package when run from the repo root
# ---------------------------------------------------------------------------
REPO_ROOT = pathlib.Path(__file__).parent.parent
sys.path.insert(0, str(REPO_ROOT))
sys.path.insert(0, str(REPO_ROOT / "server"))

os.environ.setdefault("TESTING", "1")

# ---------------------------------------------------------------------------
# Import the Flask app.  Guard against optional heavy deps that may not be
# present in the test environment (APScheduler, resend, etc.).
# ---------------------------------------------------------------------------
import importlib
import types

# Stub out server-side scheduler so importing app.py doesn't start background jobs
_apscheduler_stub = types.ModuleType("apscheduler")
for _sub in [
    "apscheduler.schedulers",
    "apscheduler.schedulers.background",
    "apscheduler.jobstores",
    "apscheduler.jobstores.sqlalchemy",
]:
    sys.modules.setdefault(_sub, types.ModuleType(_sub))

_bg_mod = sys.modules["apscheduler.schedulers.background"]
if not hasattr(_bg_mod, "BackgroundScheduler"):
    class _FakeSched:
        def __init__(self, *a, **kw): pass
        def add_jobstore(self, *a, **kw): pass
        def add_job(self, *a, **kw): pass
        def start(self, *a, **kw): pass
        def shutdown(self, *a, **kw): pass
    _bg_mod.BackgroundScheduler = _FakeSched

_sq_mod = sys.modules["apscheduler.jobstores.sqlalchemy"]
if not hasattr(_sq_mod, "SQLAlchemyJobStore"):
    class _FakeStore:
        def __init__(self, *a, **kw): pass
    _sq_mod.SQLAlchemyJobStore = _FakeStore

from server.app import app  # noqa: E402

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture()
def client():
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


# ---------------------------------------------------------------------------
# Helper: path the route uses for the local hex file
# ---------------------------------------------------------------------------
_HEX_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "bitstreams", "church_ti60_f225.hex")
)


# ---------------------------------------------------------------------------
# Test 1 — local file present
# ---------------------------------------------------------------------------

class TestLocalFilePresent:
    def test_returns_200(self, client, tmp_path, monkeypatch):
        hex_file = tmp_path / "church_ti60_f225.hex"
        hex_file.write_bytes(b":00000001FF\n")
        monkeypatch.setattr("os.path.isfile", lambda p: p == _HEX_PATH or os.path.isfile.__wrapped__(p)
                            if hasattr(os.path.isfile, "__wrapped__") else True)
        # Patch os.path.isfile only for this specific path
        original_isfile = os.path.isfile

        def _patched_isfile(p):
            if os.path.abspath(p) == _HEX_PATH:
                return True
            return original_isfile(p)

        with patch("os.path.isfile", side_effect=_patched_isfile), \
             patch("flask.send_file") as mock_sf:
            from flask import Response
            mock_sf.return_value = Response(b":00000001FF\n", status=200, headers={
                "Content-Disposition": 'attachment; filename="church_soc_cm.hex"',
                "Content-Type": "application/octet-stream",
            })
            resp = client.get("/dl/ti60-hex")

        assert resp.status_code == 200
        assert "attachment" in resp.headers.get("Content-Disposition", "")

    def test_attachment_filename(self, client, tmp_path, monkeypatch):
        original_isfile = os.path.isfile

        def _patched_isfile(p):
            if os.path.abspath(p) == _HEX_PATH:
                return True
            return original_isfile(p)

        with patch("os.path.isfile", side_effect=_patched_isfile), \
             patch("flask.send_file") as mock_sf:
            from flask import Response
            mock_sf.return_value = Response(b":00000001FF\n", status=200, headers={
                "Content-Disposition": 'attachment; filename="church_soc_cm.hex"',
                "Content-Type": "application/octet-stream",
            })
            resp = client.get("/dl/ti60-hex")

        cd = resp.headers.get("Content-Disposition", "")
        assert "church_soc_cm.hex" in cd


# ---------------------------------------------------------------------------
# Test 2 — local file absent, GitHub returns bytes
# ---------------------------------------------------------------------------

class TestGitHubFallbackSuccess:
    HEX_BYTES = b":020000040000FA\n:00000001FF\n"

    def _make_mock_response(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.raise_for_status.return_value = None
        mock_resp.iter_content.return_value = iter([self.HEX_BYTES])
        return mock_resp

    def test_returns_200(self, client):
        with patch("os.path.isfile", return_value=False), \
             patch("requests.get", return_value=self._make_mock_response()):
            resp = client.get("/dl/ti60-hex")
        assert resp.status_code == 200

    def test_attachment_header_present(self, client):
        with patch("os.path.isfile", return_value=False), \
             patch("requests.get", return_value=self._make_mock_response()):
            resp = client.get("/dl/ti60-hex")
        cd = resp.headers.get("Content-Disposition", "")
        assert "attachment" in cd
        assert "church_soc_cm.hex" in cd

    def test_content_type_octet_stream(self, client):
        with patch("os.path.isfile", return_value=False), \
             patch("requests.get", return_value=self._make_mock_response()):
            resp = client.get("/dl/ti60-hex")
        assert "octet-stream" in resp.headers.get("Content-Type", "")

    def test_requests_get_called_with_read_timeout(self, client):
        """requests.get must use a (connect, read) tuple timeout, not a single int."""
        with patch("os.path.isfile", return_value=False), \
             patch("requests.get", return_value=self._make_mock_response()) as mock_get:
            client.get("/dl/ti60-hex")
        _args, kwargs = mock_get.call_args
        timeout = kwargs.get("timeout")
        assert isinstance(timeout, tuple), (
            f"timeout should be a (connect, read) tuple, got {timeout!r}"
        )
        assert len(timeout) == 2, f"timeout tuple should have 2 elements, got {timeout!r}"
        connect_t, read_t = timeout
        assert connect_t > 0, "connect timeout must be positive"
        assert read_t > 0, "read timeout must be positive"


# ---------------------------------------------------------------------------
# Test 3 — local file absent, GitHub raises an exception
# ---------------------------------------------------------------------------

class TestGitHubFallbackFailure:
    def test_returns_404(self, client):
        with patch("os.path.isfile", return_value=False), \
             patch("requests.get", side_effect=Exception("connection timeout")):
            resp = client.get("/dl/ti60-hex")
        assert resp.status_code == 404

    def test_content_type_plain_text(self, client):
        with patch("os.path.isfile", return_value=False), \
             patch("requests.get", side_effect=Exception("connection timeout")):
            resp = client.get("/dl/ti60-hex")
        assert "text/plain" in resp.headers.get("Content-Type", "")

    def test_body_mentions_bitstream(self, client):
        with patch("os.path.isfile", return_value=False), \
             patch("requests.get", side_effect=Exception("connection timeout")):
            resp = client.get("/dl/ti60-hex")
        body = resp.data.decode()
        assert "bitstream" in body.lower() or "not available" in body.lower()

    def test_http_error_also_returns_404(self, client):
        """raise_for_status() raising HTTPError should also yield 404."""
        import requests as _rq
        mock_resp = MagicMock()
        mock_resp.raise_for_status.side_effect = _rq.exceptions.HTTPError("403 Forbidden")
        with patch("os.path.isfile", return_value=False), \
             patch("requests.get", return_value=mock_resp):
            resp = client.get("/dl/ti60-hex")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Test 4 — Integration: upstream server hangs, route must still terminate
# ---------------------------------------------------------------------------

class TestTimeoutEndsDownload:
    """Prove the route does not hang the worker when the upstream never replies.

    A real TCP server accepts the connection but never sends any bytes.
    The real ``requests`` library is used (no mock) so the socket-level read
    timeout is exercised end-to-end.  ``_DL_TIMEOUT`` is patched to (1, 2) so
    the test completes in ~3 s rather than ~35 s.
    """

    PATCHED_READ_TIMEOUT = 2   # seconds — replaces the production 30 s read timeout
    MARGIN = 3                 # extra seconds of headroom before the assertion fails

    @staticmethod
    def _start_hanging_server():
        """Bind an OS-assigned port, accept one connection, never send a byte."""
        srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        srv.bind(("127.0.0.1", 0))
        srv.listen(1)
        port = srv.getsockname()[1]

        def _hold():
            try:
                conn, _ = srv.accept()
                # Drain the incoming HTTP request so the client doesn't get a
                # broken-pipe before the read timeout fires.
                try:
                    conn.recv(4096)
                except OSError:
                    pass
                # Sit silently until the daemon thread is killed at process exit.
                time.sleep(60)
                conn.close()
            except OSError:
                pass
            finally:
                try:
                    srv.close()
                except OSError:
                    pass

        t = threading.Thread(target=_hold, daemon=True)
        t.start()
        return srv, port

    def test_route_terminates_within_timeout(self, client):
        import server.app as _app_mod

        srv, port = self._start_hanging_server()
        hanging_url = f"http://127.0.0.1:{port}/fake.hex"

        original_url = _app_mod._GITHUB_RAW_HEX_URL
        original_timeout = _app_mod._DL_TIMEOUT
        _app_mod._GITHUB_RAW_HEX_URL = hanging_url
        _app_mod._DL_TIMEOUT = (1, self.PATCHED_READ_TIMEOUT)

        try:
            with patch("os.path.isfile", return_value=False):
                start = time.monotonic()
                resp = client.get("/dl/ti60-hex")
                elapsed = time.monotonic() - start
        finally:
            _app_mod._GITHUB_RAW_HEX_URL = original_url
            _app_mod._DL_TIMEOUT = original_timeout
            try:
                srv.close()
            except OSError:
                pass

        deadline = self.PATCHED_READ_TIMEOUT + self.MARGIN
        assert elapsed < deadline, (
            f"Route took {elapsed:.1f}s — hung past the read timeout "
            f"({self.PATCHED_READ_TIMEOUT}s) + margin ({self.MARGIN}s)"
        )
        assert resp.status_code == 404, (
            f"Expected 404 after timeout, got {resp.status_code}"
        )
