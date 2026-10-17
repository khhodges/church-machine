"""Bounded negative JS evidence, not an operational Mint acceptance gate."""
import json
from pathlib import Path
import subprocess


def test_admission_marker_does_not_establish_g4():
    root = Path(__file__).resolve().parents[2]
    run = subprocess.run(
        ["node", "tests/mint_phase1/exclusion_probe.js"],
        cwd=root, capture_output=True, text=True, timeout=30, check=True,
    )
    evidence = json.loads(run.stdout)
    assert evidence["status"] == "EXPECTED GAPS REPRODUCED; G4 OPEN; NOT OPERATIONAL MINT"
    rows = {row["name"]: row for row in evidence["cases"]}
    assert len(rows) == len(evidence["cases"]) == 18
    for index in range(4):
        row = rows[f"changed-W{index}"]
        assert not row["oldWordsEqual"]
        assert len(row["old"]) == len(row["actual"]) == 4
        assert [i for i in range(4) if row["old"][i] != row["actual"][i]] == [index]
    for latch in ("false", "true"):
        row = rows[f"ABA-lambda-{latch}"]
        assert row["old"] == row["actual"]
        assert all(a != b for a, b in zip(row["old"], row["intervening"]))
        assert len(row["observations"]) == 4
        assert row["targetWrites"] == 8
        assert not row["exclusionEstablished"]
    assert rows["distinct-CHANGE"]["before"] != rows["distinct-CHANGE"]["after"]
    other = rows["other-Thread-ABA-and-return"]
    assert other["before"] == other["after"] != other["writer"]
    assert other["old"] == other["actual"] != other["intervening"]
    assert rows["cross-Namespace-SWITCH"]["afterRoot"] == 8192
    for name in ("permission-control", "bounds-control"):
        assert rows[name]["rejected"] and rows[name]["oldWordsEqual"]
    assert "Amobea checkpoint service" in evidence["notExercised"]
