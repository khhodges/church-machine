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

    def test_link_urls_are_absolute_https(self, client):
        """Production URLs must be full https:// URLs, not bare relative paths."""
        data = _call_docs_list(client)
        for entry in _link_entries(data):
            url = entry.get("url", "")
            assert url.startswith("https://"), (
                f"Link '{entry.get('label')}' URL '{url}' is not an absolute "
                "https:// URL in production mode.  The production branch must "
                "prepend the domain, not return a bare relative path."
            )

    def test_link_urls_contain_production_domain(self, client):
        """Production URLs must embed the REPLIT_DOMAINS primary domain."""
        data = _call_docs_list(client)
        for entry in _link_entries(data):
            assert "mychurch.replit.app" in entry["url"], (
                f"Link '{entry.get('label')}' URL '{entry['url']}' does not "
                "contain the expected production domain 'mychurch.replit.app'."
            )

    def test_link_urls_end_with_production_path(self, client):
        """Production URLs must end with the item's declared production_path."""
        prod_paths = {
            item["label"]: item.get("production_path", "")
            for _title, items in BOOK_CHAPTERS
            for item in items
            if isinstance(item, dict) and item.get("type") == "link"
        }
        data = _call_docs_list(client)
        for entry in _link_entries(data):
            label = entry.get("label", "")
            expected_path = prod_paths.get(label, "")
            assert entry["url"].endswith(expected_path), (
                f"Link '{label}' URL '{entry['url']}' does not end with the "
                f"declared production_path '{expected_path}'."
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


# ---------------------------------------------------------------------------
# Case 4 — REPLIT_DOMAINS holds multiple space-separated values
# ---------------------------------------------------------------------------

class TestMultiValueReplitDomains:
    """REPLIT_DOMAINS contains several space-separated tokens; REPLIT_DEV_DOMAIN absent.

    Replit can inject multiple domains as a single space-separated string
    (e.g. "foo.replit.app bar.replit.app baz.replit.app").  docs_list() must
    extract only the first token and build the absolute URL from that token
    alone.  Using the raw multi-value string as the hostname would produce a
    malformed URL that every browser would reject.
    """

    FIRST_DOMAIN = "foo.replit.app"
    SECOND_DOMAIN = "bar.replit.app"
    MULTI_DOMAINS = f"{FIRST_DOMAIN} {SECOND_DOMAIN} baz.replit.app"

    @pytest.fixture(autouse=True)
    def _env(self, monkeypatch):
        monkeypatch.setenv("REPLIT_DOMAINS", self.MULTI_DOMAINS)
        monkeypatch.delenv("REPLIT_DEV_DOMAIN", raising=False)

    @pytest.fixture()
    def client(self):
        app.config["TESTING"] = True
        with app.test_client() as c:
            yield c

    def test_link_urls_are_absolute_https(self, client):
        """A multi-value REPLIT_DOMAINS must still produce absolute https:// URLs.

        This test fails against an implementation that returns a bare relative
        path or an empty string when REPLIT_DOMAINS contains spaces.
        """
        data = _call_docs_list(client)
        links = _link_entries(data)
        assert links, "No link entries returned — cannot verify URL resolution."
        for entry in links:
            url = entry.get("url", "")
            assert url.startswith("https://"), (
                f"Link '{entry.get('label')}' URL '{url}' is not an absolute "
                "https:// URL when REPLIT_DOMAINS holds multiple space-separated "
                "values.  docs_list() must extract the first token and build a "
                "full URL from it."
            )

    def test_link_urls_contain_only_first_domain_token(self, client):
        """The URL hostname must be the first token of REPLIT_DOMAINS, not all of them.

        This test is the core regression guard: it would fail if the raw
        multi-value string were used as the hostname (producing
        'https://foo.replit.app bar.replit.app baz.replit.app/...' which is
        malformed), and also fail if none of the tokens appeared in the URL.
        """
        data = _call_docs_list(client)
        links = _link_entries(data)
        assert links, "No link entries returned — cannot verify URL resolution."
        for entry in links:
            url = entry.get("url", "")
            assert self.FIRST_DOMAIN in url, (
                f"Link '{entry.get('label')}' URL '{url}' does not contain the "
                f"first REPLIT_DOMAINS token '{self.FIRST_DOMAIN}'.  The URL "
                "must be anchored to the primary production domain."
            )
            assert self.SECOND_DOMAIN not in url, (
                f"Link '{entry.get('label')}' URL '{url}' contains the second "
                f"REPLIT_DOMAINS token '{self.SECOND_DOMAIN}'.  Only the first "
                "token may appear in the URL; extra tokens make the hostname "
                "malformed."
            )

    def test_link_urls_do_not_contain_raw_multi_value_string(self, client):
        """The verbatim space-containing REPLIT_DOMAINS value must never appear in a URL.

        A URL containing a space is unconditionally malformed; this test would
        catch any path that directly interpolates the raw env-var value.
        """
        data = _call_docs_list(client)
        for entry in _link_entries(data):
            url = entry.get("url", "")
            assert self.MULTI_DOMAINS not in url, (
                f"Link '{entry.get('label')}' URL '{url}' contains the raw "
                "multi-value REPLIT_DOMAINS string (which includes spaces), "
                "producing a malformed URL."
            )
            assert " " not in url, (
                f"Link '{entry.get('label')}' URL '{url}' contains a space, "
                "which unconditionally makes it malformed."
            )

    def test_link_urls_end_with_production_path(self, client):
        """The URL must end with the item's declared production_path after the domain."""
        prod_paths = {
            item["label"]: item.get("production_path", "")
            for _title, items in BOOK_CHAPTERS
            for item in items
            if isinstance(item, dict) and item.get("type") == "link"
        }
        data = _call_docs_list(client)
        for entry in _link_entries(data):
            label = entry.get("label", "")
            expected_path = prod_paths.get(label, "")
            assert entry["url"].endswith(expected_path), (
                f"Link '{label}' URL '{entry['url']}' does not end with the "
                f"declared production_path '{expected_path}'."
            )

    def test_endpoint_still_returns_200(self, client):
        """The endpoint must succeed when REPLIT_DOMAINS holds multiple values."""
        resp = client.get("/api/docs/list")
        assert resp.status_code == 200, (
            f"Unexpected status {resp.status_code} from /api/docs/list when "
            "REPLIT_DOMAINS holds multiple space-separated values."
        )
