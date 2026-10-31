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
    # Observation-only stop after the final native no-op retires. The software
    # HALT pseudo-word is not a terminating instruction on this hardware model.
    caller_words = images["callers"][scenario]
    marker = 0xAF004000  # IADD DR0, DR0, #0, before the compiler's implicit RETURN
    assert caller_words.count(marker) == 1
    stop_pc = harness.CALLER + caller_words.index(marker) * 4
    return harness.replay(images, scenario, stop_pc=stop_pc)


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
    assert any(harness.MINT <= pc < harness.CLEANER for pc, _ in result["retired"]), \
        "a bootstrap failure is not evidence of Mint rejecting a call"
    assert len(result["returns"]) == (2 if scenario == "stale" else 0)
    if scenario != "stale":
        assert not result["returns"]
        assert all(result["mem"][harness.SLOT * 16 + i * 4] == 0 for i in range(4))


@pytest.mark.parametrize("scenario", ["stubOutform", "stubInform"])
def test_stub(images, monkeypatch, scenario):
    result = run(images, scenario, monkeypatch)
    assert result["fault"] is None
    assert result["returns"][0]["dr1"] == 5
    assert result["returns"][0]["cr1"] == (0, 0, 0)


def test_current_abstract_clist_load_boundary(images, monkeypatch):
    """Boundary evidence only: this must not count as lifecycle acceptance."""
    from hardware.hw_types import FaultType
    result = run(images, "reuse", monkeypatch)
    assert result["fault"] == (FaultType.INVALID_OP, harness.CALLER + 12)
    assert not any(harness.MINT <= pc < harness.CLEANER for pc, _ in result["retired"])
