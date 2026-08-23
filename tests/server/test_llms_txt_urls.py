"""
Verify that every URL advertised in /llms.txt returns a successful HTTP response.

This prevents the structured AI-crawler index from pointing to broken or missing
documentation pages.
"""
import re
import pytest


@pytest.fixture(scope="module")
def client():
    import sys, os
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
    from server.app import app
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


def test_llms_txt_is_served(client):
    r = client.get("/llms.txt")
    assert r.status_code == 200, "Expected /llms.txt to return 200"
    assert r.content_type.startswith("text/plain"), (
        f"Expected text/plain, got {r.content_type}"
    )


def _parse_urls(body: str) -> list[str]:
    """Extract every '- /path' URL from the llms.txt body."""
    urls = []
    for line in body.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"-\s+(/[^:]*)", line)
        if m:
            urls.append(m.group(1).strip())
    return urls


def test_llms_txt_urls_all_resolve(client):
    r = client.get("/llms.txt")
    assert r.status_code == 200
    body = r.data.decode("utf-8")
    urls = _parse_urls(body)
    assert urls, "No URLs found in /llms.txt — check the parser"

    broken = []
    for url in urls:
        resp = client.get(url)
        if resp.status_code >= 400:
            broken.append((url, resp.status_code))

    assert not broken, (
        "The following URLs advertised in /llms.txt returned error responses:\n"
        + "\n".join(f"  {u} → {code}" for u, code in broken)
    )


def test_robots_txt_references_llms(client):
    r = client.get("/robots.txt")
    assert r.status_code == 200
    body = r.data.decode("utf-8")
    assert "llms.txt" in body, (
        "robots.txt should reference /llms.txt to guide AI crawlers"
    )
