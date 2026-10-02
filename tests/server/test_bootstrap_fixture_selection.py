"""Fixture selection must not depend on today's user-owned slot occupants."""
import json
from pathlib import Path

import pytest

from bootstrap_test_support import select_bootstrap_residents


@pytest.mark.parametrize("drafts", [
    [],
    [{"slot": 14, "name": "ide.Alice"}, {"slot": 15, "name": "ide.Mallory"}],
    [{"slot": 29, "name": "ide.Alice"}],
])
def test_optional_drafts_do_not_remove_other_occupants(tmp_path, monkeypatch, drafts):
    for key, name in {
        "CHURCH_TEST_LUMPS_DIR": "lumps",
        "CHURCH_TEST_BOOT_CONFIG_PATH": "config.json",
        "CHURCH_TEST_BUILD_SNAPSHOTS_DIR": "snapshots",
        "CHURCH_TEST_DB_PATH": "test.db",
    }.items():
        monkeypatch.setenv(key, str(tmp_path / name))
    monkeypatch.setenv("CHURCH_TEST_ISOLATED_MODE", "1")
    lumps = tmp_path / "lumps"
    lumps.mkdir()
    retained = {"slot": 14, "name": "DifferentSavedAssignment"}
    rows = drafts if any(row["slot"] == 14 for row in drafts) else [retained, *drafts]
    (lumps / "ns-state.json").write_text(json.dumps({"abstractions": rows}))
    (lumps / "manifest.json").write_text("[]")
    (lumps / "approvals.json").write_text('{"approvals": {}}')
    select_bootstrap_residents(lumps)
    result = json.loads((lumps / "ns-state.json").read_text())["abstractions"]
    assert result == ([retained] if retained in rows else [])


def test_live_library_is_rejected_before_fixture_io():
    live = Path(__file__).resolve().parents[2] / "server/lumps"
    with pytest.raises(AssertionError, match="must never change the live library"):
        select_bootstrap_residents(live)