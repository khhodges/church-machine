"""Numeric hardware ABI checks; these do not prove fault trigger wiring."""
from hardware.hw_types import FaultType


def test_phase1_fault_assignments():
    assert int(FaultType.INVALID_OP) == 0x0B
    assert int(FaultType.THREAD_CONTEXT) == 0x1D
    assert int(FaultType.THREAD_PERMISSIONS) == 0x1E
    assert int(FaultType.WATCHDOG) == 0x1F


def test_fault_codes_are_unique_and_fit_hardware_field():
    codes = [int(code) for code in FaultType.__members__.values()]
    assert len(codes) == len(set(codes))
    assert all(0 <= code < 32 for code in codes)
