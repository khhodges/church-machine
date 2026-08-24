"""Regression coverage for public page, document, and source-code search."""

import os
import sys

import pytest

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import server.app as _app_module


@pytest.fixture()
def client():
    _app_module.app.config["TESTING"] = True
    with _app_module.app.test_client() as test_client:
        yield test_client


def test_site_search_includes_bank_source(client):
    response = client.get("/api/site-search?q=Bank")

    assert response.status_code == 200
    results = response.get_json()["results"]
    bank = next(
        result for result in results
        if result["path"] == "/simulator/cloomc/bank.cloomc"
    )
    assert bank["kind"] == "code"
    assert bank["title"] == "Bank source"
    assert bank["url"] == "/code/simulator/cloomc/bank.cloomc"


def test_code_viewer_escapes_source_as_html(client):
    response = client.get("/code/simulator/cloomc/bank.cloomc")

    assert response.status_code == 200
    assert response.content_type.startswith("text/html")
    assert b"Bank source" in response.data
    assert b"abstraction Bank" in response.data
    assert b"&lt;=" in response.data


def test_code_viewer_rejects_paths_outside_allowlist(client):
    response = client.get("/code/../server/app.py")

    assert response.status_code in {404, 400}