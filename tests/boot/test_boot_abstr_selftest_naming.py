"""Regression test: the active boot lump must be named "SelfTest"
consistently everywhere it is surfaced to the user.

Background
----------
The server's live-metadata extraction path (_load_boot_abstr_lump() in
server/app.py) used to hardcode "abstraction": "Boot.Abstr" for the lump at
the active Namespace descriptor.  Meanwhile the client-side hardware boot
catalog (simulator.js _getHardwareBootCatalog()) — the source shown in the
CR14/NS6 live-lump popup — already labeled the same slot "SelfTest", as do
all 60+ versioned sidecar files under server/lumps/SelfTest_v*.json.

This mismatch made the Lump Repository / detail view show a different name
("Boot.Abstr") than the CR14/NS6 popup ("SelfTest") for the exact same lump.
"Boot.Abstr" remains valid as an internal/architectural alias (comments,
docstrings, the historical NS slot 3 director), but it must never leak out
as the *display* name of the live SelfTest lump again.

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


def _active_selftest_binding():
    import json
    with open(os.path.join(ROOT, "server", "lumps", "ns-state.json"), encoding="utf-8") as fh:
        rows = json.load(fh)["abstractions"]
    matches = [row for row in rows if row.get("name") == "SelfTest"]
    assert len(matches) == 1
    return matches[0]


def _get_active_selftest_entry(client):
    resp = client.get("/api/lumps/list")
    assert resp.status_code == 200, (
        f"GET /api/lumps/list returned {resp.status_code}; "
        f"body={resp.get_data(as_text=True)}"
    )
    entries = resp.get_json()
    assert isinstance(entries, list) and len(entries) > 0, (
        "Expected a non-empty JSON array from /api/lumps/list"
    )
    binding = _active_selftest_binding()
    for e in entries:
        if e.get("token") == binding["token"] and e.get("ns_slot") == binding["slot"]:
            return e
    tokens = [e.get("token") for e in entries]
    pytest.fail(
        f"Active SelfTest binding {binding!r} not found in /api/lumps/list. "
        f"Tokens present: {tokens}"
    )


def test_server_reports_active_selftest_not_boot_abstr(client):
    """The live /api/lumps/list active SelfTest entry must report 'SelfTest',
    not the legacy internal alias 'Boot.Abstr', as its abstraction name."""
    entry = _get_active_selftest_entry(client)
    assert entry.get("abstraction") == "SelfTest", (
        "The active SelfTest abstraction name drifted from the "
        "established 'SelfTest' convention (see server/lumps/SelfTest_v*.json "
        f"and simulator.js _getHardwareBootCatalog()); got {entry.get('abstraction')!r}"
    )


def test_client_hardware_catalog_labels_active_selftest_slot():
    """Guard the other half of the contract: simulator.js's hardware boot
    catalog — the source of truth for the CR14/NS6 live-lump popup — must
    keep labeling the active SelfTest slot 'SelfTest' so client and server never drift apart
    again."""
    with open(SIMULATOR_JS_PATH, "r", encoding="utf-8") as fh:
        src = fh.read()

    match = re.search(r"_getHardwareBootCatalog\s*\(\)\s*\{.*?\breturn\s*\[(.*?)\];", src, re.S)
    assert match, "Could not locate _getHardwareBootCatalog() array literal in simulator.js"

    catalog_body = match.group(1)
    # Split on top-level entries by newline and inspect the selected live slot.
    entry_lines = [
        line for line in catalog_body.split("\n")
        if ("label:" in line) or re.match(r"\s*null\s*,", line)
    ]
    slot = _active_selftest_binding()["slot"]
    assert len(entry_lines) > slot, (
        f"Expected a boot-catalog entry for active SelfTest slot {slot}; "
        f"found {len(entry_lines)} entries"
    )
    selected_line = entry_lines[slot]
    assert "'SelfTest'" in selected_line or '"SelfTest"' in selected_line, (
        f"simulator.js _getHardwareBootCatalog() selected slot {slot} no longer labeled "
        f"'SelfTest'; got line: {selected_line!r}"
    )
