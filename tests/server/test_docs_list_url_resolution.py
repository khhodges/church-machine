"""
tests/server/test_docs_list_url_resolution.py

Regression tests for the URL-resolution logic in docs_list()
(/api/docs/list).

The Getting Started chapter contains "link" entries whose URL depends on
which Replit environment variables are present at runtime.  Three distinct
scenarios must be covered so that a future refactor cannot silently
reintroduce the production-blank-URL bug:

  Case 1 — REPLIT_DEV_DOMAIN set (dev workspace)
            Link URLs must be non-empty and contain the dev domain together
            with the artifact port prefix.

  Case 2 — only REPLIT_DOMAINS set (production deployment, no dev domain)
            Link URLs must be non-empty and equal the item's production_path.

  Case 3 — neither variable set (CI / standalone install)
            Link URLs must be empty strings — disabled state is expected so
            the UI can hide the entries rather than surface a broken link.
"""

import os
import sys

import pytest

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from server.app import app, BOOK_CHAPTERS


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _link_entries(response_json):
    """Extract every entry whose type=='link' from all chapters."""
    entries = []
    for chapter in response_json.get("chapters", []):
        for doc in chapter.get("docs", []):
            if doc.get("type") == "link":
                entries.append(doc)
    return entries


def _call_docs_list(client):
    resp = client.get("/api/docs/list")
    assert resp.status_code == 200, f"Unexpected status {resp.status_code}"
    return resp.get_json()


# ---------------------------------------------------------------------------
# Fixture — verify that the chapters actually contain at least one link entry
# so the tests are not vacuously true if the chapter list is ever emptied.
# ---------------------------------------------------------------------------

def test_book_chapters_contain_link_entries():
    """Sanity guard: at least one 'Getting Started' link must be present."""
    link_items = [
        item
        for _title, items in BOOK_CHAPTERS
        for item in items
        if isinstance(item, dict) and item.get("type") == "link"
    ]
    assert len(link_items) >= 1, (
        "BOOK_CHAPTERS has no link entries — the URL-resolution tests would "
        "pass vacuously.  Add at least one link entry to BOOK_CHAPTERS."
    )


# ---------------------------------------------------------------------------
# Case 1 — REPLIT_DEV_DOMAIN set (development workspace)
# ---------------------------------------------------------------------------

class TestDevDomainSet:
    """REPLIT_DEV_DOMAIN is present; REPLIT_DOMAINS is absent."""

    @pytest.fixture(autouse=True)
    def _env(self, monkeypatch):
        monkeypatch.setenv("REPLIT_DEV_DOMAIN", "myrepl.replit.dev")
        monkeypatch.delenv("REPLIT_DOMAINS", raising=False)

    @pytest.fixture()
    def client(self):
        app.config["TESTING"] = True
        with app.test_client() as c:
            yield c

    def test_link_urls_are_non_empty(self, client):
        data = _call_docs_list(client)
        links = _link_entries(data)
        assert links, "No link entries returned — cannot verify URL resolution."
        for entry in links:
            assert entry["url"], (
                f"Link '{entry.get('label')}' has an empty URL when "
                "REPLIT_DEV_DOMAIN is set."
            )

    def test_link_urls_contain_dev_domain(self, client):
        data = _call_docs_list(client)
        for entry in _link_entries(data):
            assert "myrepl.replit.dev" in entry["url"], (
                f"Link '{entry.get('label')}' URL '{entry['url']}' does not "
                "contain the expected dev domain."
            )

    def test_link_urls_contain_artifact_port(self, client):
        """Dev URLs must use the port-prefixed proxy format <port>-<domain>."""
        # Collect the ports declared in BOOK_CHAPTERS for cross-reference.
        declared_ports = {
            str(item.get("artifact_port", ""))
            for _title, items in BOOK_CHAPTERS
            for item in items
            if isinstance(item, dict) and item.get("type") == "link"
                and item.get("artifact_port")
        }
        data = _call_docs_list(client)
        for entry in _link_entries(data):
            url = entry["url"]
            matched = any(f"{port}-" in url for port in declared_ports)
            assert matched, (
                f"Link '{entry.get('label')}' URL '{url}' does not embed any "
                f"known artifact port from {declared_ports}."
            )

    def test_link_urls_use_https(self, client):
        data = _call_docs_list(client)
        for entry in _link_entries(data):
            assert entry["url"].startswith("https://"), (
                f"Link '{entry.get('label')}' URL '{entry['url']}' does not "
                "start with https://."
            )


# ---------------------------------------------------------------------------
# Case 2 — only REPLIT_DOMAINS set (production deployment)
# ---------------------------------------------------------------------------

class TestProductionDomainOnly:
    """REPLIT_DOMAINS is present; REPLIT_DEV_DOMAIN is absent."""

    @pytest.fixture(autouse=True)
    def _env(self, monkeypatch):
        monkeypatch.setenv("REPLIT_DOMAINS", "mychurch.replit.app")
        monkeypatch.delenv("REPLIT_DEV_DOMAIN", raising=False)

    @pytest.fixture()
    def client(self):
        app.config["TESTING"] = True
        with app.test_client() as c:
            yield c

    def test_link_urls_are_non_empty(self, client):
        """Production links must resolve to a non-empty URL."""
        data = _call_docs_list(client)
        links = _link_entries(data)
        assert links, "No link entries returned — cannot verify URL resolution."
        for entry in links:
            assert entry["url"], (
                f"Link '{entry.get('label')}' has an empty URL when only "
                "REPLIT_DOMAINS is set.  This is the production-blank-URL bug."
            )

    def test_link_urls_equal_production_path(self, client):
        """Production URLs must be the verbatim production_path from the chapter config."""
        # Build a label→production_path map from BOOK_CHAPTERS for verification.
        prod_paths = {
            item["label"]: item.get("production_path", "")
            for _title, items in BOOK_CHAPTERS
            for item in items
            if isinstance(item, dict) and item.get("type") == "link"
        }
        data = _call_docs_list(client)
        for entry in _link_entries(data):
            label = entry.get("label", "")
            expected = prod_paths.get(label, "")
            assert entry["url"] == expected, (
                f"Link '{label}' URL '{entry['url']}' does not match the "
                f"declared production_path '{expected}'."
            )

    def test_link_urls_do_not_contain_dev_domain(self, client):
        """Production URLs must not contain any replit.dev subdomain."""
        data = _call_docs_list(client)
        for entry in _link_entries(data):
            assert "replit.dev" not in entry["url"], (
                f"Link '{entry.get('label')}' URL '{entry['url']}' contains "
                "a dev-domain fragment in production mode."
            )


# ---------------------------------------------------------------------------
# Case 3 — neither variable set (CI / standalone install)
# ---------------------------------------------------------------------------

class TestNeitherDomainSet:
    """Neither REPLIT_DEV_DOMAIN nor REPLIT_DOMAINS is present."""

    @pytest.fixture(autouse=True)
    def _env(self, monkeypatch):
        monkeypatch.delenv("REPLIT_DEV_DOMAIN", raising=False)
        monkeypatch.delenv("REPLIT_DOMAINS", raising=False)

    @pytest.fixture()
    def client(self):
        app.config["TESTING"] = True
        with app.test_client() as c:
            yield c

    def test_link_urls_are_empty(self, client):
        """When no domain env var is set, links must be disabled (empty URL)."""
        data = _call_docs_list(client)
        links = _link_entries(data)
        assert links, "No link entries returned — cannot verify URL resolution."
        for entry in links:
            assert entry["url"] == "", (
                f"Link '{entry.get('label')}' URL '{entry['url']}' is not "
                "empty when neither REPLIT_DEV_DOMAIN nor REPLIT_DOMAINS is "
                "set.  The disabled-state contract has been broken."
            )

    def test_endpoint_still_returns_200(self, client):
        """The endpoint must succeed even when no domain variables are set."""
        resp = client.get("/api/docs/list")
        assert resp.status_code == 200, (
            f"Unexpected status {resp.status_code} from /api/docs/list when "
            "no domain env vars are present."
        )
