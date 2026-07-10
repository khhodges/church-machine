"""Regression test: the NS slot 6 boot lump must be named "SelfTest"
consistently everywhere it is surfaced to the user.

Background
----------
The server's live-metadata extraction path (_load_boot_abstr_lump() in
server/app.py) used to hardcode "abstraction": "Boot.Abstr" for the lump at
NS slot 6 / token "00000600".  Meanwhile the client-side hardware boot
catalog (simulator.js _getHardwareBootCatalog()) — the source shown in the
CR14/NS6 live-lump popup — already labeled the same slot "SelfTest", as do
all 60+ versioned sidecar files under server/lumps/SelfTest_v*.json.

This mismatch made the Lump Repository / detail view show a different name
("Boot.Abstr") than the CR14/NS6 popup ("SelfTest") for the exact same lump.
"Boot.Abstr" remains valid as an internal/architectural alias (comments,
docstrings, the historical NS slot 3 director), but it must never leak out
as the *display* name of the live NS slot 6 lump again.

This test is read-only: it does not write, archive, or delete anything
under server/lumps/, so it is safe to run directly and repeatedly (unlike
tests/boot/test_boot_abstr_cw_cc.py, which exercises /api/lumps/save and
mutates real on-disk lump files as a side effect).
"""
import os
import re
import sys

import pytest

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT)

SIMULATOR_JS_PATH = os.path.join(ROOT, "simulator", "simulator.js")


@pytest.fixture(scope="module")
def client():
    from server.app import app  # noqa: E402
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


def _get_ns_slot6_entry(client):
    resp = client.get("/api/lumps/list")
    assert resp.status_code == 200, (
        f"GET /api/lumps/list returned {resp.status_code}; "
        f"body={resp.get_data(as_text=True)}"
    )
    entries = resp.get_json()
    assert isinstance(entries, list) and len(entries) > 0, (
        "Expected a non-empty JSON array from /api/lumps/list"
    )
    for e in entries:
        if e.get("token") == "00000600" or e.get("ns_slot") == 6:
            return e
    tokens = [e.get("token") for e in entries]
    pytest.fail(
        f"NS slot 6 lump (token='00000600') not found in /api/lumps/list. "
        f"Tokens present: {tokens}"
    )


def test_server_reports_selftest_not_boot_abstr(client):
    """The live /api/lumps/list entry for NS slot 6 must report 'SelfTest',
    not the legacy internal alias 'Boot.Abstr', as its abstraction name."""
    entry = _get_ns_slot6_entry(client)
    assert entry.get("abstraction") == "SelfTest", (
        "NS slot 6 (token=00000600) abstraction name drifted from the "
        "established 'SelfTest' convention (see server/lumps/SelfTest_v*.json "
        f"and simulator.js _getHardwareBootCatalog()); got {entry.get('abstraction')!r}"
    )


def test_client_hardware_catalog_still_labels_slot6_selftest():
    """Guard the other half of the contract: simulator.js's hardware boot
    catalog — the source of truth for the CR14/NS6 live-lump popup — must
    keep labeling slot 6 'SelfTest' so client and server never drift apart
    again."""
    with open(SIMULATOR_JS_PATH, "r", encoding="utf-8") as fh:
        src = fh.read()

    match = re.search(r"_getHardwareBootCatalog\s*\(\)\s*\{.*?\breturn\s*\[(.*?)\];", src, re.S)
    assert match, "Could not locate _getHardwareBootCatalog() array literal in simulator.js"

    catalog_body = match.group(1)
    # Split on top-level entries by newline; slot 6 is the 7th entry (index 6).
    entry_lines = [
        line for line in catalog_body.split("\n")
        if ("label:" in line) or re.match(r"\s*null\s*,", line)
    ]
    assert len(entry_lines) >= 7, (
        f"Expected at least 8 boot-catalog slots (0-7); found {len(entry_lines)} entries"
    )
    slot6_line = entry_lines[6]
    assert "'SelfTest'" in slot6_line or '"SelfTest"' in slot6_line, (
        f"simulator.js _getHardwareBootCatalog() slot 6 no longer labeled "
        f"'SelfTest'; got line: {slot6_line!r}"
    )
