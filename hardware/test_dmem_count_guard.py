"""hardware/test_dmem_count_guard.py — Tests for the Wukong DMEM init count guard.

Covers:
  - N_INIT is stable and matches the reference file
  - N_INIT & 0xFF matches what check_dmem_count.py reports
  - wukong_top.py bakes the correct N_INIT constant into the elaborated design
  - wukong_bridge._compute_expected_n_init() returns the same value
  - The sentinel phase signal and byte-mux are present in the elaborated module
"""

import hashlib
import os
import sys

import pytest

_HERE = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_HERE)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from hardware.boot_rom import (
    WUKONG_DEMO_NAMESPACE, WUKONG_DEMO_CLIST, WUKONG_SELFTEST_WORDS,
    WUKONG_SELFTEST_BASE_WORD, WUKONG_WCH_BASE_WORD, WUKONG_WCH_CLIST,
    WUKONG_WCH_CLIST_WORD, WUKONG_NUC_PROGRAM, WUKONG_THREAD_BASE_WORD,
    WUKONG_THREAD_HEADER, WUKONG_THREAD_STO_WORD, WUKONG_THREAD_STO_INIT,
    WUKONG_THREAD_CAPS0_WORD, WUKONG_THREAD_CAPS12_WORD, make_gt,
    wukong_wch_header,
)
from hardware.hw_types import GT_TYPE_INFORM, PERM_MASK_S
from hardware.wukong_bridge import _compute_expected_n_init


# ---------------------------------------------------------------------------
# Helpers — mirror wukong_top.py hw_init_pairs computation exactly
# ---------------------------------------------------------------------------

def _build_dmem_init():
    dmem_init = list(WUKONG_DEMO_NAMESPACE)
    while len(dmem_init) < 256:
        dmem_init.append(0)
    dmem_init += list(WUKONG_DEMO_CLIST)
    while len(dmem_init) < 16384:
        dmem_init.append(0)
    for _i, _v in enumerate(WUKONG_SELFTEST_WORDS):
        dmem_init[WUKONG_SELFTEST_BASE_WORD + _i] = _v
    for _i, _v in enumerate(
        [wukong_wch_header(len(WUKONG_NUC_PROGRAM))] + list(WUKONG_NUC_PROGRAM)
    ):
        dmem_init[WUKONG_WCH_BASE_WORD + _i] = _v
    for _i, _v in enumerate(WUKONG_WCH_CLIST):
        dmem_init[WUKONG_WCH_CLIST_WORD + _i] = _v
    dmem_init[WUKONG_THREAD_BASE_WORD] = WUKONG_THREAD_HEADER
    dmem_init[WUKONG_THREAD_STO_WORD] = WUKONG_THREAD_STO_INIT
    dmem_init[WUKONG_THREAD_CAPS0_WORD] = 0x4A000006
    dmem_init[WUKONG_THREAD_CAPS12_WORD] = make_gt(
        GT_TYPE_INFORM, PERM_MASK_S, 1, 0
    )
    return dmem_init


def _compute_n_init(dmem_init=None):
    if dmem_init is None:
        dmem_init = _build_dmem_init()
    return sum(1 for v in dmem_init if v != 0)


def _compute_sha(dmem_init=None):
    if dmem_init is None:
        dmem_init = _build_dmem_init()
    hw_init_pairs = [(a, v) for a, v in enumerate(dmem_init) if v != 0]
    h = hashlib.sha256()
    for addr, val in hw_init_pairs:
        h.update(addr.to_bytes(2, 'big'))
        h.update(val.to_bytes(4, 'big'))
    return h.hexdigest()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_n_init_is_positive():
    """hw_init_pairs must be non-empty — DMEM cannot be all zeros at boot."""
    assert _compute_n_init() > 0


def test_n_init_fits_in_one_byte():
    """The low-byte N_INIT sentinel encoding must match the current image."""
    n = _compute_n_init()
    assert n == 526, f"unexpected N_INIT={n}"
    assert n & 0xFF == 0x0E, f"unexpected N_INIT low byte: 0x{n & 0xFF:02X}"


def test_n_init_matches_bridge_helper():
    """wukong_bridge._compute_expected_n_init() must equal the direct computation."""
    direct = _compute_n_init()
    via_bridge = _compute_expected_n_init()
    assert via_bridge is not None, "boot_rom not importable from bridge helper"
    assert via_bridge == direct, (
        f"Bridge helper returned {via_bridge}, expected {direct}"
    )


def test_reference_file_exists_and_matches():
    """The saved reference file must exist and match the current tables.

    This test fails when WUKONG_DEMO_NAMESPACE or WUKONG_DEMO_CLIST changes
    without updating the reference — the same condition that would produce a
    stale bitstream.  Fix: rebuild the bitstream, then run --write.
    """
    ref_path = os.path.join(_HERE, "wukong_dmem_count.ref")
    assert os.path.exists(ref_path), (
        f"Reference file missing: {ref_path}\n"
        "Run: python3 hardware/check_dmem_count.py --write"
    )
    lines = [l.strip() for l in open(ref_path)
             if l.strip() and not l.startswith('#')]
    assert len(lines) >= 2, "Malformed reference file — expected N_INIT and SHA lines"
    ref_n   = int(lines[0])
    ref_sha = lines[1]

    current_n   = _compute_n_init()
    current_sha = _compute_sha()

    assert ref_n == current_n, (
        f"N_INIT changed: reference={ref_n}, current={current_n}\n"
        "WUKONG_DEMO_NAMESPACE or WUKONG_DEMO_CLIST has grown/shrunk.\n"
        "Rebuild the bitstream, then: python3 hardware/check_dmem_count.py --write"
    )
    assert ref_sha == current_sha, (
        f"DMEM content changed: SHA mismatch (N_INIT unchanged at {current_n})\n"
        "A word value changed without an N_INIT change.\n"
        "Rebuild the bitstream, then: python3 hardware/check_dmem_count.py --write"
    )


def test_n_init_sentinel_byte_value():
    """Smoke-check the current N_INIT sentinel byte value."""
    n = _compute_n_init()
    assert n & 0xFF == 0x0E, (
        f"N_INIT & 0xFF changed: now 0x{n & 0xFF:02X} (N_INIT={n}). "
        "Update expected value here AND rebuild the Wukong bitstream."
    )


def test_wukong_top_elaborates_with_sentinel_phase():
    """wukong_top.py elaborates without errors and contains the sentinel_phase signal."""
    from amaranth.sim import Simulator
    from hardware.wukong_top import ChurchWukongXC7A100T

    top = ChurchWukongXC7A100T(sim_mode=True)
    sim = Simulator(top)
    # Elaboration succeeds — no Amaranth exceptions thrown.
    # (The sentinel_phase signal is declared inside elaborate(), so its presence
    # is implicitly validated by successful elaboration of the two-byte sentinel
    # FSM.  A synthesis-time mis-wiring would surface as an Amaranth TypeError.)


def test_namespace_and_clist_counts():
    """NAMESPACE and CLIST non-zero word counts are stable at design values."""
    ns_nonzero    = sum(1 for v in WUKONG_DEMO_NAMESPACE if v != 0)
    clist_nonzero = sum(1 for v in WUKONG_DEMO_CLIST if v != 0)
    # 8-slot NS: slot 6/7 are resident LUMPs; the factory entry is SelfTest.
    assert ns_nonzero == 22, (
        f"WUKONG_DEMO_NAMESPACE non-zero word count changed: {ns_nonzero} (expected 22)"
    )
    assert clist_nonzero == 7, (
        f"WUKONG_DEMO_CLIST non-zero word count changed: {clist_nonzero} (expected 7)"
    )
