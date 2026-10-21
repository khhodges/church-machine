"""Exact private Mint package on ChurchCore RTL, not a host implementation.

Synthetic setup is test privilege, not proof of allocator/service provisioning.
No catalog, Namespace, boot artifact, synthesis tool or board is accessed.
"""
import json
from pathlib import Path
import subprocess

import pytest
from amaranth.sim import Simulator

from hardware.boot_rom import NUC_LUMP_BASE
from hardware.core import ChurchCore
from hardware.hw_types import GT_TYPE_INFORM, PERM_MASK_R, PERM_MASK_W, make_gt
from hardware.integrity32 import integrity32
from tests.hardware.phase1_support import execute, ordinary, set_cr, set_dr, snapshot

ROOT = Path(__file__).resolve().parents[2]
START = 16
HEAP = 0x13579BDF


@pytest.fixture(scope="module")
def images():
    return json.loads(subprocess.check_output(
        ["node", str(Path(__file__).with_name("mint_slot_image.js"))],
        cwd=ROOT, text=True, timeout=30))


def replay(image, inputs, *, invalid=False):
    """Only IMEM supplies instructions; RTL owns every branch and calculation."""
    words, labels = image["words"], image["labels"]
    assert START + len(words) * 4 < NUC_LUMP_BASE
    core = ChurchCore(iot_profile=False)
    result = {}

    async def bench(ctx):
        await ordinary(ctx, core)
        # Nonzero heap and enclosing Thread context. Debug ingress is setup only.
        await set_cr(ctx, core, 12, 0x02000001, 0x4000, 255)
        await set_cr(ctx, core, 14, 0x42000002, START, len(words) - 1)
        base, size, slot, seq, fresh = inputs
        for reg, value in {1: 0xBAD, 2: seq, 3: fresh, 5: HEAP,
                           6: size, 7: slot, 8: base, 9: 0xFFFFFFFF,
                           10: 0xFFFFFFFF, 11: 0xFFFFFFFF, 12: 0xFFFFFFFF}.items():
            await set_dr(ctx, core, reg, value)
        before = snapshot(ctx, core)
        m_before = ctx.get(core.dbg_m_bit_state)
        # No memory response is supplied. Every bus request is forbidden below:
        # this proves the package cannot consume a stored enclosing frame or
        # alter its stack pointer, heap storage, or Namespace. It is not an
        # enclosing CALL/RETURN integration test or legal provisioning evidence.
        ctx.set(core.free_run_nia, START)
        ctx.set(core.free_run_start, 1)
        await ctx.tick()
        ctx.set(core.free_run_start, 0)
        ctx.set(core.defer_fault_reset, 1)
        visited = []
        for _ in range(1600):
            address = ctx.get(core.imem_addr)
            assert address == ctx.get(core.nia)
            offset = (address - START) // 4
            assert address % 4 == 0 and 0 <= offset < len(words), hex(address)
            if offset == labels["create_data_descriptor_ready"]:
                assert not invalid, "invalid input reached success continuation"
                result["fault"] = None
                break
            instruction = words[offset]
            visited.append(offset)
            ctx.set(core.imem_data, instruction)
            ctx.set(core.imem_valid, 1)
            for cycle in range(96):
                # Enforce no publication, frame consumption, heap write, or
                # hidden Namespace lookup on every cycle, not only at retirement.
                for port in (core.dmem_rd_en, core.dmem_wr_en, core.ns_rd_en,
                             core.ns_wr_en, core.clist_rd_en, core.clist_wr_en):
                    assert not ctx.get(port), (offset, cycle, port.name)
                assert snapshot(ctx, core)[1] == before[1], "capability mutation"
                assert ctx.get(core.dbg_m_bit_state) == m_before
                if ctx.get(core.fault_valid):
                    assert invalid, (offset, ctx.get(core.fault))
                    assert offset == labels["TODO_CREATE_DESCRIPTOR_INPUT_INVALID"]
                    result["fault"] = ctx.get(core.fault)
                    break
                retired = ctx.get(core.retire_valid)
                if retired:
                    assert ctx.get(core.retire_instr) == instruction
                    assert ctx.get(core.retire_nia) == address
                await ctx.tick()
                ctx.set(core.imem_valid, 0)
                if retired:
                    await ctx.tick()
                    break
            else:
                pytest.fail(f"instruction timeout at {offset}")
            if "fault" in result:
                break
        else:
            pytest.fail("package did not reach its fixed continuation")
        result["dr"] = tuple(ctx.get(r) for r in core.debug_dr_words)
        result["visited"] = visited
        assert snapshot(ctx, core)[1] == before[1]
        for reg in (5, 6, 7, 8):
            assert result["dr"][reg] == before[0][reg]
        assert result["dr"][1] == 0, "preparation must not claim CREATE completion"

    sim = Simulator(core)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()
    return result


CASES = [
    (0, 1, 2, 0, 1),                    # first use, zero byte location
    (0x8000, 64, 15, 0, 0),             # used version zero increments
    (0xFFFFFFFC, 1, 65535, 509, 0),      # last issuable version
    (0x1000, 0x200000, 2, 1, 0),        # maximum inclusive 21-bit limit
    (0x1000, 0x1FFFFF, 2, 1, 0),        # just below maximum
    (0x80000000, 512, 300, 256, 0),      # retain high physical address bit
    (0x2000, 64, 10, 510, 0),
    (0x2000, 64, 10, 511, 0),
    (0x2000, 64, 10, 511, 1),           # fresh indication cannot revive retired
]


@pytest.mark.parametrize("inputs", CASES)
def test_exact_package_full_core(images, inputs):
    r = replay(images["exact"], inputs)
    base, size, slot, seq, fresh = inputs
    dr = r["dr"]
    assert r["fault"] is None
    labels = images["exact"]["labels"]
    assert labels["create_descriptor_next_sequence"] in r["visited"]
    assert labels["create_descriptor_done"] in r["visited"]
    if seq >= 510:
        assert dr[12] == 0 and dr[4] == 511
        assert dr[9:12] == (0, 0, 0)
        assert labels["create_descriptor_integrity"] not in r["visited"]
    else:
        seq = 0 if fresh else seq + 1
        w1 = (size - 1) | seq << 21
        # Reference functions are only expected-output oracles AFTER RTL runs.
        assert dr[8:12] == (base, w1, integrity32(base, w1), make_gt(
            GT_TYPE_INFORM, PERM_MASK_R | PERM_MASK_W, slot_id=slot,
            gt_seq=seq, b_flag=1))
        assert dr[9] >> 30 == 0, "F/G must clear despite dirty output registers"
        assert dr[12] == 1
        assert r["visited"].count(labels["create_descriptor_xor_bits"]) == 32
        assert labels["create_descriptor_after_integrity"] in r["visited"]


@pytest.mark.parametrize("inputs", [
    (0x2000, 0, 10, 0, 0), (0x2000, 0x200001, 10, 0, 0),
    (0x2001, 64, 10, 0, 0), (0x2000, 64, 1, 0, 0),
    (0x2000, 64, 65536, 0, 0), (0x2000, 64, 10, 512, 0),
    (0x2000, 64, 10, 0, 2), (0x2000, 64, 10, 1, 1),
])
def test_invalid_package_inputs_fault_without_publication(images, inputs):
    assert replay(images["exact"], inputs, invalid=True)["fault"] is not None


def test_immediate_mcmp_dr15_clobber_is_detected_in_full_core(images):
    inputs = CASES[1]
    good = replay(images["exact"], inputs)
    broken = replay(images["immediateMutation"], inputs)
    assert good["dr"][10] == integrity32(inputs[0], inputs[1] - 1 | 1 << 21)
    assert broken["dr"][10] != good["dr"][10], "mutation must corrupt XOR constant"
    assert broken["dr"][8:10] == good["dr"][8:10]
    assert broken["dr"][11:13] == good["dr"][11:13]


def test_compare_forms_preserve_or_clobber_live_dr15(images):
    """Independently reachable regression even if package branches regress."""
    core = ChurchCore()

    async def bench(ctx):
        await ordinary(ctx, core)
        for operand, expected in (("DR0", 0xDEADBEEF), ("#0", 31)):
            await set_dr(ctx, core, 4, 31)
            await set_dr(ctx, core, 15, 0xDEADBEEF)
            before = snapshot(ctx, core)
            for word in images["compare"][operand]:
                await execute(ctx, core, word)
            assert ctx.get(core.debug_dr_words[15]) == expected
            assert ctx.get(core.debug_dr_words[4]) == 31
            assert snapshot(ctx, core)[1] == before[1]

    sim = Simulator(core)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()
