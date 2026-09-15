"""Focused contract coverage for Namespace-owned boot planning (Task 3472)."""
import pytest

from server import namespace_plan


def _row(slot=17, **extra):
    row = {
        "name": "Example",
        "slot": slot,
        "seq": 4,
        "token": "0123abcd",
        "filename": "Example.1.0123abcd.lump",
        "resident": True,
        "boot_resident": True,
        "load_policy": "Resident",
    }
    row.update(extra)
    return row


def test_missing_marker_is_actionable_and_never_defaults_to_legacy_slot():
    with pytest.raises(namespace_plan.NamespacePlanError) as raised:
        namespace_plan.presentation({"revision": 0, "abstractions": [_row()]})
    assert raised.value.code == "namespace_boot_marker_missing"
    assert "Explicitly select" in str(raised.value)


def test_marker_cas_preserves_exact_identity_and_increments_revision():
    state = {"revision": 7, "abstractions": [_row(17), _row(18, name="Other",
                                                token="deadbeef",
                                                filename="Other.1.deadbeef.lump")]}
    updated = namespace_plan.update_marker(
        state, 7, {"slot": 18, "seq": 4, "token": "deadbeef",
                   "filename": "Other.1.deadbeef.lump"})
    assert updated["revision"] == 8
    assert updated["abstractions"][1]["boot"] is True
    assert "boot" not in updated["abstractions"][0]


def test_marker_cas_rejects_stale_identity_without_mutating_input():
    state = {"revision": 7, "abstractions": [_row()]}
    with pytest.raises(namespace_plan.NamespacePlanError) as raised:
        namespace_plan.update_marker(
            state, 7, {"slot": 17, "seq": 3, "token": "0123abcd",
                       "filename": "Example.1.0123abcd.lump"})
    assert raised.value.code == "namespace_boot_identity_stale"
    assert "boot" not in state["abstractions"][0]


def test_duplicate_markers_fail_closed():
    with pytest.raises(namespace_plan.NamespacePlanError) as raised:
        namespace_plan.presentation({
            "revision": 1,
            "abstractions": [_row(17, boot=True), _row(
                18, name="Other", token="deadbeef",
                filename="Other.1.deadbeef.lump", boot=True)],
        })
    assert raised.value.code == "namespace_boot_marker_duplicate"


def test_capabilitytest_is_fixed_at_ns10_and_uart_is_fixed_at_ns2():
    state = {"revision": 0, "abstractions": [_row(
        10, name="CapabilityTest", token="4a00000a",
        filename="CapabilityTest.2.e794a764.lump"), {
            "name": "UART_DEV", "slot": 2, "seq": 0,
            "location": "0x40000014", "limit": "0x00002",
        }]}
    migration = namespace_plan.device_migration(state)
    assert migration == {
        "required": False, "capability_test_slot": 10, "uart_slot": 2}


def test_wrong_capabilitytest_slot_is_rejected_without_device_migration():
    state = {"revision": 0, "abstractions": [
        _row(2, name="CapabilityTest", token="4a000002",
             filename="CapabilityTest.2.6fd9df21.lump"),
        {"name": "UART_DEV", "slot": 10, "seq": 0,
         "location": "0x40000014", "limit": "0x00002"},
    ]}
    with pytest.raises(namespace_plan.NamespacePlanError,
                       match="CapabilityTest is immutable at NS\\[10\\]"):
        namespace_plan.validate_rows(state)