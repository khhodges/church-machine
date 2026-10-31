"""Private software core simulation only; no saved LUMPs or physical device."""
import json
import subprocess
from pathlib import Path
import pytest
from hardware.hw_types import make_gt, GT_TYPE_ABSTRACT
from tests.hardware import test_mint_destroy_core as harness


@pytest.fixture(scope="module")
def images():
    return json.loads(subprocess.check_output(
        ["node", "tests/hardware/mint_v4_image.js"], text=True,
        cwd=Path(__file__).resolve().parents[2]))


def run(images, scenario, monkeypatch):
    original = harness.provision

    def provision(images, scenario):
        mem, code = original(images, scenario)
        proof = make_gt(GT_TYPE_ABSTRACT, 24, 51, 0, 0)
        # Add the trusted reference at the existing declared Mint C-list row 7.
        header = mem[harness.MINT]
        size = 1 << (((header >> 23) & 15) + 6)
        old_base = harness.MINT + (size - 7) * 4
        caps = [mem[old_base + i * 4] for i in range(7)]
        mem[harness.MINT] = (header & ~255) | 8
        for i, value in enumerate(caps + [proof]):
            mem[harness.MINT + (size - 8 + i) * 4] = value
        caller_size = 1 << (((mem[harness.CALLER] >> 23) & 15) + 6)
        mem[harness.CALLER + (caller_size - 6 + 2) * 4] = (
            make_gt(GT_TYPE_ABSTRACT, 24, 52, 0, 0) if scenario == "wrongProof" else proof)
        if scenario == "exhaust":
            mem[harness.CLEANSTATE + 8] = 0
        return mem, code

    monkeypatch.setattr(harness, "provision", provision)
    return harness.replay(images, scenario)


def test_create_destroy_reuse(images, monkeypatch):
    result = run(images, "reuse", monkeypatch)
    assert result["fault"] is None, result["fault"]
    assert len(result["returns"]) == 3
    first, destroyed, reused = result["returns"]
    assert [r["dr1"] for r in result["returns"]] == [0, 0, 0]
    assert first["cr1"][0] != 0 and reused["cr1"][0] != first["cr1"][0]
    assert destroyed["cr1"] == (0, 0, 0)
    for record in [first, reused]:
        assert [record["mem"][harness.POOL + i * 4] for i in range(8)] == [0] * 8


@pytest.mark.parametrize("scenario", ["wrongProof", "exhaust", "stale"])
def test_rejected_calls(images, monkeypatch, scenario):
    result = run(images, scenario, monkeypatch)
    assert result["fault"] is not None
    if scenario != "stale":
        assert not result["returns"]
        assert all(result["mem"][harness.SLOT * 16 + i * 4] == 0 for i in range(4))


def test_stub(images, monkeypatch):
    result = run(images, "stub", monkeypatch)
    assert result["fault"] is None
    assert result["returns"][0]["dr1"] == 5
    assert result["returns"][0]["cr1"] == (0, 0, 0)
