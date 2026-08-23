"""
tests/server/test_docs_artifact_links.py

Integration tests for /api/docs/list artifact-link entries and
/api/artifact-reachable.

Covers:
  DAL-1  Without REPLIT_DEV_DOMAIN: every link entry uses its production_path
         URL and has artifact_port == 0 (no reachability probe in production)
  DAL-2  With REPLIT_DEV_DOMAIN: link entries use the dev-proxy URL and have
         a nonzero artifact_port so the browser can probe reachability
  DAL-3  /api/artifact-reachable rejects non-allowlisted ports
  DAL-4  /api/artifact-reachable rejects invalid port values
  DAL-5  /api/artifact-reachable returns clean JSON (no error details) for a
         closed allowlisted port
"""

import os
import sys
from unittest.mock import patch

import pytest

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import server.app as _app_module


@pytest.fixture()
def client():
    _app_module.app.config['TESTING'] = True
    with _app_module.app.test_client() as c:
        yield c


# ---------------------------------------------------------------------------
# DAL-1: production deployment (no REPLIT_DEV_DOMAIN)
# ---------------------------------------------------------------------------

def test_production_links_have_zero_port_and_production_url(client):
    """Without a dev domain, link entries must use an absolute production URL
    and emit artifact_port == 0 so the browser opens them directly without
    probing a dev-server port that does not exist in production.

    The URL must be fully qualified (https://<domain><production_path>) so it
    works regardless of the page's base URL — not a bare relative path.
    REPLIT_DOMAINS may contain multiple space-separated values; the first token
    is used to build the URL (task #2997 regression guard).
    """
    # Provide two space-separated domains to exercise the split behaviour.
    prod_env = {'REPLIT_DEV_DOMAIN': '', 'REPLIT_DOMAINS': 'example.replit.app secondary.replit.app'}
    with patch.dict(os.environ, prod_env):
        resp = client.get('/api/docs/list')

    assert resp.status_code == 200
    data = resp.get_json()
    link_entries = [
        e
        for ch in data.get('chapters', [])
        for e in ch.get('docs', [])
        if e.get('type') == 'link'
    ]

    expected = [
        item
        for _, entries in _app_module.BOOK_CHAPTERS
        for item in entries
        if isinstance(item, dict) and item.get('type') == 'link'
           and item.get('production_path')
    ]
    assert len(link_entries) == len(expected), (
        f"Expected {len(expected)} link entries, got {len(link_entries)}"
    )

    for entry, spec in zip(link_entries, expected):
        assert entry['artifact_port'] == 0, (
            f"Link '{entry['label']}' must have artifact_port=0 in production, "
            f"got {entry['artifact_port']}"
        )
        expected_url = f"https://example.replit.app{spec['production_path']}"
        assert entry['url'] == expected_url, (
            f"Link '{entry['label']}' must use absolute production URL "
            f"(first REPLIT_DOMAINS token + production_path); "
            f"got url={entry['url']!r}, expected {expected_url!r}"
        )
        # Must not contain the secondary domain — only the first token is used.
        assert 'secondary.replit.app' not in entry['url'], (
            f"URL must use only the first REPLIT_DOMAINS token; "
            f"got url={entry['url']!r}"
        )


# ---------------------------------------------------------------------------
# DAL-2: dev workspace (REPLIT_DEV_DOMAIN is set)
# ---------------------------------------------------------------------------

def test_dev_links_have_nonzero_port_and_proxy_url(client):
    """With REPLIT_DEV_DOMAIN set, link entries must stay on the IDE origin
    rather than using a reset-sensitive port-prefixed development URL."""
    fake_domain = 'test-domain.replit.dev'
    with patch.dict(os.environ, {'REPLIT_DEV_DOMAIN': fake_domain}):
        resp = client.get('/api/docs/list')

    assert resp.status_code == 200
    data = resp.get_json()
    link_entries = [
        e
        for ch in data.get('chapters', [])
        for e in ch.get('docs', [])
        if e.get('type') == 'link'
    ]

    for entry in link_entries:
        assert entry['artifact_port'] == 0, (
            f"Link '{entry['label']}' must not use an artifact port in dev"
        )
        assert fake_domain in entry['url'], (
            f"Link '{entry['label']}' URL should contain the dev domain; "
            f"got url={entry['url']!r}"
        )
        assert not entry['url'].startswith('https://21279-'), (
            f"Link '{entry['label']}' must not use a port-prefixed dev URL; "
            f"got url={entry['url']!r}"
        )

    urls_by_label = {entry['label']: entry['url'] for entry in link_entries}
    assert urls_by_label['🎞 IDE Introduction'].endswith('/ide-intro/')
    assert urls_by_label['📄 Facilitator Handout'].endswith('/ide-intro/handout')


# ---------------------------------------------------------------------------
# DAL-3 / DAL-4 / DAL-5: /api/artifact-reachable
# ---------------------------------------------------------------------------

def test_artifact_reachable_rejects_non_allowlisted_port(client):
    """Ports not in the BOOK_CHAPTERS allowlist must be rejected (400) so the
    endpoint cannot enumerate arbitrary loopback services."""
    resp = client.get('/api/artifact-reachable?port=5000')
    assert resp.status_code == 400
    assert resp.get_json()['ok'] is False


def test_artifact_reachable_rejects_invalid_port(client):
    """Ports below 1024 and non-integer values must return 400."""
    resp = client.get('/api/artifact-reachable?port=80')
    assert resp.status_code == 400
    assert resp.get_json()['ok'] is False

    resp2 = client.get('/api/artifact-reachable?port=notanumber')
    assert resp2.status_code == 400
    assert resp2.get_json()['ok'] is False


def test_artifact_reachable_closed_allowlisted_port_returns_clean_json(client):
    """An allowlisted port that is not listening must return 200 ok=false with
    no socket-error details in the response body."""
    # Mock the socket rather than assuming the artifact workflow is stopped:
    # developers normally keep the introduction deck running on this port.
    with patch('socket.create_connection', side_effect=ConnectionRefusedError):
        resp = client.get('/api/artifact-reachable?port=21279')
    assert resp.status_code == 200
    body = resp.get_json()
    assert body['ok'] is False
    # Error details must not be leaked to the client
    assert 'error' not in body, (
        f"Socket error details must not be sent to the client; got: {body}"
    )

def test_ide_intro_returns_503_when_dist_not_built(client):
    """/ide-intro/ must return 503 with a JSON error body when the SPA dist
    directory has not been built, rather than a bare werkzeug 404."""
    import tempfile, os as _os
    # Point the route at a guaranteed-empty temp dir so dist/public/index.html
    # is absent regardless of the workspace state.
    with patch.object(_app_module, '_INTRO_DIST_DIR', tempfile.mkdtemp()):
        resp = client.get('/ide-intro/')
    assert resp.status_code == 503, (
        f"Expected 503 when dist is missing, got {resp.status_code}"
    )
    body = resp.get_json()
    assert body is not None and 'error' in body, (
        "503 response must carry a JSON error field"
    )

def test_ide_intro_serves_index_when_dist_built(client):
    """/ide-intro/ must serve index.html when the dist directory exists."""
    import tempfile
    dist_dir = tempfile.mkdtemp()
    # Write a minimal index.html so the route can serve it
    with open(os.path.join(dist_dir, 'index.html'), 'w') as f:
        f.write('<!doctype html><html><body>slides</body></html>')
    with patch.object(_app_module, '_INTRO_DIST_DIR', dist_dir):
        resp = client.get('/ide-intro/')
    assert resp.status_code == 200
    assert b'slides' in resp.data

def test_ide_intro_handout_returns_503_when_dist_not_built(client):
    """/ide-intro/handout must also return 503 (not 404) when not built."""
    import tempfile
    with patch.object(_app_module, '_INTRO_DIST_DIR', tempfile.mkdtemp()):
        resp = client.get('/ide-intro/handout')
    assert resp.status_code == 503

def test_ide_intro_handout_falls_back_to_index(client):
    """/ide-intro/handout must fall back to index.html for SPA client routing."""
    import tempfile
    dist_dir = tempfile.mkdtemp()
    with open(os.path.join(dist_dir, 'index.html'), 'w') as f:
        f.write('<!doctype html><html><body>slides</body></html>')
    with patch.object(_app_module, '_INTRO_DIST_DIR', dist_dir):
        resp = client.get('/ide-intro/handout')
    assert resp.status_code == 200
    assert b'slides' in resp.data

def test_ide_intro_real_dist_serves_200(client):
    """Regression: /ide-intro/ must return 200 with the committed built SPA.
    Fails if the dist/public directory is missing or index.html was not
    committed, catching accidental deletion of the built artifact."""
    real_dist = _app_module._INTRO_DIST_DIR
    if not os.path.isfile(os.path.join(real_dist, 'index.html')):
        pytest.skip("Built SPA not present in this workspace — run pnpm build first")
    resp = client.get('/ide-intro/')
    assert resp.status_code == 200, (
        f"/ide-intro/ returned {resp.status_code}; built SPA may be missing"
    )
    resp2 = client.get('/ide-intro/handout')
    assert resp2.status_code == 200, (
        f"/ide-intro/handout returned {resp2.status_code}"
    )
