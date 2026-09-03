"""Factory catalog custody checks for isolated-register M device capabilities."""

import os
import sys
import hashlib
import json
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from amaranth.sim import Simulator

from hardware.boot_rom import (
    DEMO_CLIST,
    NAMESPACE_PRIVATE_MBIT_CAPABILITIES,
    SCHEDULER_IRQ_CLIST,
    THREAD_MANAGER_CLIST,
    WUKONG_DEMO_CLIST,
    WUKONG_CAPABILITY_TEST_WORDS,
)
from hardware.hw_types import (
    CR_CLOOMC,
    CR_INTERRUPT,
    CR_NAMESPACE,
    CR_THREAD_STACK,
    GT_TYPE_ABSTRACT,
    M_BIT_PORT_CR12,
    M_BIT_PORT_CR13,
    M_BIT_PORT_CR14,
    M_BIT_PORT_CR15,
    PERM_MASK_S,
    make_gt,
)
from hardware.core import ChurchCore


def test_namespace_catalog_issues_all_and_only_exact_mbit_capabilities():
    assert NAMESPACE_PRIVATE_MBIT_CAPABILITIES == (
        (CR_THREAD_STACK, make_gt(GT_TYPE_ABSTRACT, PERM_MASK_S), M_BIT_PORT_CR12, 0),
        (CR_INTERRUPT, make_gt(GT_TYPE_ABSTRACT, PERM_MASK_S), M_BIT_PORT_CR13, 0),
        (CR_CLOOMC, make_gt(GT_TYPE_ABSTRACT, PERM_MASK_S), M_BIT_PORT_CR14, 0),
        (CR_NAMESPACE, make_gt(GT_TYPE_ABSTRACT, PERM_MASK_S), M_BIT_PORT_CR15, 0),
    )


def test_ordinary_boot_abstractions_do_not_receive_or_discover_mbit_caps():
    # Full device capabilities include a target location. No ordinary c-list
    # contains them; an S-only word alone is insufficient device authority.
    full_words = {tuple(cap[1:]) for cap in NAMESPACE_PRIVATE_MBIT_CAPABILITIES}
    for clist in (DEMO_CLIST, WUKONG_DEMO_CLIST,
                  SCHEDULER_IRQ_CLIST, THREAD_MANAGER_CLIST):
        assert all(not isinstance(word, tuple) for word in clist)
        assert all((word,) not in full_words for word in clist)


def test_factory_capability_test_import_is_bound_to_canonical_artifact():
    root = Path(__file__).resolve().parents[2]
    lumps = root / "server" / "lumps"
    filename = "CapabilityTest.2.a537aadf.lump"
    raw = (lumps / filename).read_bytes()
    sidecar = json.loads(
        (lumps / "CapabilityTest.2.a537aadf.json").read_text(encoding="utf-8"))
    manifest = json.loads(
        (lumps / "manifest.json").read_text(encoding="utf-8"))
    digest = hashlib.sha256(raw).hexdigest()
    entry = next(item for item in manifest if item.get("filename") == filename)
    assert sidecar["token"] == entry["token"] == "00000a00"
    assert sidecar["ns_slot"] == entry["ns_slot"] == 10
    assert sidecar["binary_hash"] == entry["binary_hash"] == digest
    assert len(WUKONG_CAPABILITY_TEST_WORDS) == 64


def test_trusted_boot_invokes_namespace_init_and_sets_only_cr12_m():
    dut = ChurchCore()
    observed = {"complete": False, "m_flags": 0}

    async def bench(ctx):
        ctx.set(dut.boot_start, 1)
        await ctx.tick()
        ctx.set(dut.boot_start, 0)
        for _ in range(32):
            await ctx.tick()
            if ctx.get(dut.boot_complete):
                observed["complete"] = True
                observed["m_flags"] = ctx.get(dut.debug_isolated_m_flags)
                break

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()
    assert observed["complete"]
    assert observed["m_flags"] == 0b0001


