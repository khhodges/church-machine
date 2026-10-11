"""Full-core ordinary activation evidence; NOT complete handoff acceptance.

CM_REQUIRE_NAMESPACE_HANDOFF=1 enables the deliberately fail-closed acceptance
check. Never replace the ordinary CHANGE operand with a scheduler request.
"""
import os

import pytest
from hardware.integrity32 import integrity32

from .namespace_handoff_core_fixture import (
    BOOT, SYSTEM, BRIDGE, BRIDGE_CODE, TARGET, TARGET_CODE, THREAD_GT, ENTRY_GT,
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
    expected["cr"][5] = [0x3200000B, TARGET + 72, 193]
    expected["cr"][6] = [0x1A00000C, TARGET_CODE + 252, 0]
    expected["cr"][12] = [THREAD_GT, TARGET, 255]
    expected["cr"][14] = [0x5200000C, TARGET_CODE + 4, 3]
    expected.update(nia=TARGET_CODE + 4, flags=0, owned=1, active_base=TARGET)
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


@pytest.mark.parametrize("operand", [1, 12, 13])
def test_ordinary_change_activates_destination_only_thread(operand):
    result = run_probe(operand=operand)
    checkpoints = result["checkpoints"]
    assert checkpoints["before_switch"] == before(operand)
    assert result["switch_fault"] == 0
    assert checkpoints["after_switch"] == switched(operand)
    assert result["change_fault"] == 0
    expected = golden_active()
    if operand == 13:
        expected["cr"][13] = [THREAD_GT, TARGET, 255]
    assert checkpoints["after_change"] == expected
    assert checkpoints["held_fault"] == expected
    assert result["retirements"] == [
        (0, instruction(5, 15, 6), False),
        (4, instruction(4, operand, operand), False),
        (TARGET_CODE + 4, result["memory"][TARGET_CODE + 4], False)]
    assert result["writes"] == [(TARGET + 68, 0x10F1)]
    assert SYSTEM + 11 * 16 in result["reads"]
    assert BOOT + 11 * 16 not in result["reads"]
    assert result["target_fault"] == 0
    expected["dr"][1] = 37
    expected["nia"] += 4
    assert result["checkpoints"]["after_target"] == expected


def test_ordinary_activation_owns_bridge_then_suspends_it():
    result = run_probe(owned_bridge=True)
    assert result["activation_fault"] == result["switch_fault"] == result["change_fault"] == 0
    owned = result["checkpoints"]["owned_bridge"]
    assert owned["owned"] == 1 and owned["active_base"] == BRIDGE
    assert owned["nia"] == BRIDGE_CODE + 4
    assert result["activation_writes"] == [(BRIDGE + 68, (2 << 28) | 0x10F1)]
    saved = result["checkpoints"]["after_switch"]
    expected_writes = (
        [(BRIDGE + (244 + i) * 4, saved["cr"][i][0]) for i in range(12)] +
        [(BRIDGE + 240 * 4, 0x4A000002),
         (BRIDGE + 241 * 4, (2 << 28) | (((BRIDGE_CODE + 12) // 4) << 13) | 0x10F1),
         (BRIDGE + 68, (2 << 28) | 0x10EF)] +
        [(BRIDGE + (i + 1) * 4, 0) for i in range(16)] +
        [(TARGET + 68, 0x10F1)])
    assert result["writes"] == result["activation_writes"] + expected_writes
    expected = golden_active()
    expected["cr"][13] = [THREAD_GT, 0, 0]
    assert result["checkpoints"]["after_change"] == expected
    assert result["target_fault"] == 0
    assert result["checkpoints"]["after_target"]["dr"][1] == 37
    for base in (BRIDGE, TARGET):
        assert result["memory"][base + 243 * 4] == (0x7FFF << 13) | 0x10F3


def test_self_change_resumes_new_continuation_without_consuming_root():
    result = run_probe(owned_bridge=True, action="self")
    assert result["activation_fault"] == result["switch_fault"] == result["target_fault"] == 0
    assert result["checkpoints"]["after_switch"]["nia"] == BRIDGE_CODE + 8
    assert result["checkpoints"]["after_target"]["dr"][1] == 37
    assert result["memory"][BRIDGE + 68] == (2 << 28) | 0x10F1
    assert result["memory"][BRIDGE + 243 * 4] == (0x7FFF << 13) | 0x10F3


@pytest.mark.parametrize("perm", range(1, 8))
@pytest.mark.parametrize("domain", [0, 1])
def test_permission_bearing_operand_fails_without_publication(perm, domain):
    def corrupt(memory, cr):
        cr[1][0] |= (perm << 28) | (domain << 27)
    result = run_probe(mutate=corrupt)
    assert result["change_fault"] == 5
    assert result["checkpoints"]["after_change"] == result["checkpoints"]["after_switch"]
    assert result["writes"] == []


@pytest.mark.parametrize("kind,fault", [
    ("poison", 19), ("frame", 18), ("self", 18), ("entry_perm", 6),
    ("seal", 10), ("generation", 9), ("header", 8), ("clist", 8),
    ("legacy", 11),
])
def test_rejected_context_is_read_only(kind, fault):
    def corrupt(memory, cr):
        if kind == "poison":
            memory[TARGET + 68] = 0x10F1
        elif kind == "frame":
            memory[TARGET + 241 * 4] ^= 1
        elif kind == "self":
            memory[TARGET_CODE + 252] = 0x4A000002
        elif kind == "entry_perm":
            memory[TARGET + 240 * 4] = 0x1A00000C
        elif kind == "seal":
            memory[SYSTEM + 11 * 16 + 8] ^= 1
        elif kind == "generation":
            cr[1][0] |= 1 << 16
        elif kind == "header":
            memory[TARGET] ^= 1
        elif kind == "clist":
            memory[TARGET_CODE] &= ~255
        elif kind == "legacy":
            memory[4] |= 1
    result = run_probe(mutate=corrupt)
    assert result["change_fault"] == fault
    assert result["checkpoints"]["after_change"] == result["checkpoints"]["after_switch"]
    assert result["checkpoints"]["held_fault"] == result["checkpoints"]["after_change"]
    assert result["writes"] == []


def test_owned_bridge_is_not_saved_when_destination_admission_fails():
    def corrupt(memory, cr):
        memory[TARGET + 241 * 4] ^= 1
    result = run_probe(owned_bridge=True, mutate=corrupt)
    assert result["activation_fault"] == result["switch_fault"] == 0
    assert result["change_fault"] == 18
    assert result["writes"] == result["activation_writes"]
    assert result["checkpoints"]["after_change"] == result["checkpoints"]["after_switch"]


def test_activation_preserves_nonzero_generation_in_derived_views():
    def reissue(memory, cr):
        cr[1][0] |= 3 << 16
        for slot in (11, 12):
            address = SYSTEM + slot * 16
            memory[address + 4] |= 3 << 21
            memory[address + 8] = integrity32(memory[address], memory[address + 4])
        for address in (TARGET + 240 * 4, TARGET + 242 * 4,
                        TARGET + 244 * 4, TARGET_CODE + 252):
            memory[address] |= 3 << 16
    result = run_probe(mutate=reissue)
    assert result["change_fault"] == result["target_fault"] == 0
    expected = golden_active()
    for i in (0, 5, 6, 12, 14):
        expected["cr"][i][0] |= 3 << 16
        expected["cr"][i][2] |= 3 << 21
    assert result["checkpoints"]["after_change"] == expected


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
    assert not result.get("change_fault"), "Ordinary activation regressed"
    assert result["checkpoints"]["after_change"] == golden_active()
    pytest.fail("HANDOFF BLOCKED: all write-boundary "
                "interruptions, recovery execution and authority containment "
                "must be implemented before removing this fail-closed gate")
