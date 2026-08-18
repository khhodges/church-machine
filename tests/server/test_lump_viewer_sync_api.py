"""
test_lump_viewer_sync_api.py — verify that /api/lumps/list returns group and doc_refs
for lumps whose sidecars have been updated by sync_lump_viewer_to_sidecars.py.

This test specifically covers the SelfTest/Boot.Abstr entry (token 00000600), which is
served via the in-memory _BOOT_ABSTR_META override path rather than the normal sidecar
path, and would silently omit group/doc_refs if the override loader did not copy them.
"""

import json
import os
import sys

import pytest

# Allow running from the repo root or from tests/server/
_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

LUMPS_DIR = os.path.join(_ROOT, "server", "lumps")
MANIFEST_PATH = os.path.join(LUMPS_DIR, "manifest.json")

# Lumps that are expected to have group/doc_refs after sync has been run.
# These are entries whose .lump file is on disk AND that appear in the Lump Viewer.
_SAMPLED_TOKENS_WITH_GROUP = {
    "00000600": "Boot ROM",   # SelfTest — served via _BOOT_ABSTR_META override
    "e186c4ec": "Boot ROM",   # WukongCallHome — served via normal sidecar path
    "00001f00": "Networking", # Tunnel
    "00001000": "Math / Science",  # SlideRule
}


# ── App fixture ───────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def client():
    """Return a Flask test client for the server app."""
    sys.path.insert(0, os.path.join(_ROOT, "server"))
    from app import app
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


# ── Tests ─────────────────────────────────────────────────────────────────────

class TestLumpListCatalogueFields:
    """Verify /api/lumps/list returns group and doc_refs for synced entries."""

    def test_list_returns_200(self, client):
        r = client.get("/api/lumps/list")
        assert r.status_code == 200, f"Expected 200, got {r.status_code}"

    def test_selftest_has_group_and_doc_refs(self, client):
        """SelfTest (00000600) is served via _BOOT_ABSTR_META — must include group/doc_refs."""
        r = client.get("/api/lumps/list")
        assert r.status_code == 200
        entries = r.get_json()
        selftest = next((e for e in entries if e.get("token") == "00000600"), None)
        assert selftest is not None, "SelfTest (token=00000600) not found in /api/lumps/list"
        assert selftest.get("group") == "Boot ROM", (
            f"SelfTest group={selftest.get('group')!r}, expected 'Boot ROM'.\n"
            "  The _BOOT_ABSTR_META loader must copy 'group' from the sidecar."
        )
        doc_refs = selftest.get("doc_refs")
        assert isinstance(doc_refs, list) and len(doc_refs) > 0, (
            f"SelfTest doc_refs={doc_refs!r}, expected a non-empty list.\n"
            "  The _BOOT_ABSTR_META loader must copy 'doc_refs' from the sidecar."
        )

    @pytest.mark.parametrize("token,expected_group", list(_SAMPLED_TOKENS_WITH_GROUP.items()))
    def test_sampled_entries_have_group(self, client, token, expected_group):
        """Sampled entries from different paths must all return group."""
        r = client.get("/api/lumps/list")
        assert r.status_code == 200
        entries = r.get_json()
        entry = next((e for e in entries if e.get("token") == token), None)
        assert entry is not None, (
            f"Entry with token={token!r} not found in /api/lumps/list"
        )
        assert entry.get("group") == expected_group, (
            f"token={token!r}: group={entry.get('group')!r}, "
            f"expected {expected_group!r}.\n"
            "  Run: python scripts/sync_lump_viewer_to_sidecars.py"
        )

    def test_all_on_disk_lumps_have_group(self, client):
        """Every manifest entry whose .lump is on disk should have a non-null group
        (after sync_lump_viewer_to_sidecars.py write mode has been run).
        Entries with no sidecar or no Viewer match are reported but not failed."""
        r = client.get("/api/lumps/list")
        assert r.status_code == 200
        entries = r.get_json()

        with open(MANIFEST_PATH) as fh:
            manifest = json.load(fh)
        on_disk_tokens = set()
        for me in manifest:
            fn = me.get("filename") or f"{me.get('token','')}.lump"
            if os.path.isfile(os.path.join(LUMPS_DIR, fn)):
                on_disk_tokens.add(me.get("token", "").lower())

        missing_group = []
        for e in entries:
            tok = (e.get("token") or "").lower()
            if tok not in on_disk_tokens:
                continue
            if not e.get("group"):
                missing_group.append(tok)

        assert not missing_group, (
            f"{len(missing_group)} on-disk lump(s) missing 'group' in /api/lumps/list:\n"
            + "\n".join(f"  - {t}" for t in sorted(missing_group))
            + "\n  Run: python scripts/sync_lump_viewer_to_sidecars.py"
        )
