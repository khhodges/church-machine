"""Full-core blocker characterization; passing here is NOT handoff acceptance.

CM_REQUIRE_NAMESPACE_HANDOFF=1 enables the deliberately fail-closed acceptance
check. Never replace the ordinary CHANGE operand with a scheduler request.
"""
import os

import pytest

from .namespace_handoff_core_fixture import (
    BOOT, SYSTEM, BRIDGE, TARGET, TARGET_CODE, THREAD_GT, ENTRY_GT,
    image, instruction, run_probe,
)


def before(operand=1, m=True):
    return dict(cr=image(operand)[1], dr=[0] * 16, flags=2, nia=0,
                m=0x8000 if m else 0, owned=0, active_base=0)


def switched(operand=1):
    expected = before(operand)
    expected["cr"][15] = [0x1A000003, SYSTEM, 63]
    expected.update(nia=4, m=0)
    return expected


def golden_active():
    """Independent candidate checkpoint, NOT derived from observed CHANGE."""
    expected = switched()
    expected["cr"][:12] = [[0, 0, 0] for _ in range(12)]
    expected["cr"][0] = [ENTRY_GT, TARGET_CODE, 63]
    expected["cr"][5] = [0x32000000, TARGET + 72, 193]
    expected["cr"][6] = [0x1A00000C, TARGET_CODE + 252, 0]
    expected["cr"][12] = [THREAD_GT, TARGET, 255]
    expected["cr"][14] = [0x5200000C, TARGET_CODE + 4, 3]
    expected.update(nia=0, flags=0, owned=1, active_base=TARGET)
    return expected


def golden_owned_writes():
    """Candidate 32-write suspension/pop order for an OWNED bridge.

    Not usable as evidence for the seed-only probe, whose ownership is false.
    Context-write interruption requires ordinary activation of that bridge first.
    """
    cr = switched()["cr"]
    return ([(BRIDGE + (244 + i) * 4, cr[i][0]) for i in range(12)] +
            [(BRIDGE + 240 * 4, 0x4A000002),
             (BRIDGE + 241 * 4, (2 << 28) | (2 << 13) | 0x10F1),
             (BRIDGE + 17 * 4, (2 << 28) | 0x10EF)] +
            [(BRIDGE + (i + 1) * 4, 0) for i in range(16)] +
            [(TARGET + 17 * 4, 0x10F1)])


def test_fixture_is_discriminating_and_regions_do_not_overlap():
    memory, _ = image()
    assert memory.get(BOOT + 11 * 16, 0) == 0
    assert memory[SYSTEM + 11 * 16] == TARGET
    assert memory[BOOT + 12 * 16] != memory[SYSTEM + 12 * 16]
    for slot in (1, 2, 3, 4):
        assert [memory[BOOT + slot * 16 + i * 4] for i in range(4)] == [
            memory[SYSTEM + slot * 16 + i * 4] for i in range(4)]
    regions = [(BOOT, 1024), (SYSTEM, 1024), (BRIDGE, 1024),
               (TARGET, 1024), (0x6000, 256), (0x7000, 256),
               (0x8000, 1024), (0x9000, 256)]
    assert all(a + size <= b for (a, size), (b, _) in zip(regions, regions[1:]))
    assert len(golden_owned_writes()) == 32
    assert len(set(a for a, _ in golden_owned_writes())) == 32


@pytest.mark.parametrize("operand,fault", [(1, 4), (12, 5), (13, 5)])
def test_ordinary_change_exposes_permission_blocker_after_switch(operand, fault):
    result = run_probe(operand=operand)
    checkpoints = result["checkpoints"]
    assert checkpoints["before_switch"] == before(operand)
    assert result["switch_fault"] == 0
    assert checkpoints["after_switch"] == switched(operand)
    assert result["change_fault"] == fault  # observed PERM_L / PERM_S, not ISA policy
    expected = switched(operand)
    # The full core publishes the operand GT to CR8 before reporting the fault.
    # Freeze this non-atomic observation rather than claiming no register writes.
    expected["cr"][8] = [THREAD_GT, 0, 0]
    assert checkpoints["after_change"] == expected
    assert checkpoints["held_fault"] == expected
    assert result["retirements"] == [
        (0, instruction(5, 15, 6), False),
        (4, instruction(4, operand, operand), True)]
    assert not result["writes"] and result["memory_unchanged"]
    # Failure occurs before destination Thread validation: lookup success from
    # the earlier unit test cannot fill this evidence gap.
    assert SYSTEM + 11 * 16 not in result["reads"]


def test_denied_m_leaves_every_register_and_memory_unchanged():
    result = run_probe(m_authorized=False)
    assert result["switch_fault"] == 4
    assert result["checkpoints"]["before_switch"] == before(m=False)
    assert result["checkpoints"]["after_switch"] == before(m=False)
    assert result["writes"] == [] and result["memory_unchanged"]


@pytest.mark.parametrize("action", ["reset_before", "reset_after"])
def test_reboot_at_instruction_boundaries_discards_seeded_authority(action):
    result = run_probe(action=action)
    expected_cr = [[0, 0, 0] for _ in range(16)]
    expected_cr[6] = [0x1A000002, 0x400, 63]
    expected_cr[12] = [0x02000001, 0, 0]
    expected_cr[14] = [0x42000001, 0, 0]
    expected_cr[15] = [0x1A000000, 0, 18]
    assert result["checkpoints"]["after_reset"] == dict(
        cr=expected_cr, dr=[0] * 16, flags=0, nia=0, m=0x1000,
        owned=0, active_base=0)
    assert not result["writes"] and result["memory_unchanged"]


@pytest.mark.skipif(os.environ.get("CM_REQUIRE_NAMESPACE_HANDOFF") != "1",
                    reason="explicit release gate; characterization is not acceptance")
def test_require_full_handoff():
    result = run_probe()
    assert not result.get("change_fault"), (
        "HANDOFF BLOCKED: ordinary permissionless CHANGE faults before Thread "
        "validation; owned-context writes, recovery and containment are unproved")
    assert result["checkpoints"]["after_change"] == golden_active()
    pytest.fail("HANDOFF BLOCKED: owned bridge suspension, all write-boundary "
                "interruptions, recovery execution and first target retirement "
                "must be implemented before removing this fail-closed gate")
