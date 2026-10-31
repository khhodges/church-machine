"""Isolated V1 lifecycle on ChurchCore's byte-addressed execution model.

Not a live Namespace, saved LUMP, hardware or real verifier acceptance test.
Only initial synthetic provisioning writes from the host; after boot all
allocation, release, issuance, caller accesses and faults are native RTL.
"""
import json
from pathlib import Path
import subprocess

import pytest
from amaranth.sim import Simulator

from hardware.boot_rom import BOOT_PROGRAM
from hardware.core import ChurchCore
from hardware.integrity32 import integrity32
from hardware.hw_types import FaultType
from hardware.sim_boot_helpers import boot_core
from shared.namespace_header import pack_namespace_word0
from tests.hardware.phase1_support import set_cr
from tests.hardware.test_mint_create_core import gt

ROOT = Path(__file__).resolve().parents[2]
THREAD, CALLER, MINT, CLEANER, VERIFY = 0x1000, 0x2000, 0x4000, 0x8000, 0xA000
# Preserve the strict JS reproducer's physical pool and private-state bases.
CLEANSTATE, STATE, POOL = 0x3000 * 4, 0x3300 * 4, 0x3500 * 4
SLOT, HISTORY = 39, 16
SENTINEL = 0xDEADBEEF


@pytest.fixture(scope="module")
def images():
    return json.loads(subprocess.check_output(
        ["node", str(Path(__file__).with_name("mint_destroy_image.js"))],
        cwd=ROOT, text=True, timeout=30))


def provision(images, scenario):
    mem = dict.fromkeys(range(0, 0x10000, 4), 0)
    code = {}

    def put(base, values):
        for i, value in enumerate(values):
            mem[base + i * 4] = value

    def descriptor(slot, base, limit):
        put(slot * 16, [base, limit, integrity32(base, limit), 0])

    def program(slot, base, words, caps):
        size = 64
        while size < len(words) + len(caps):
            size *= 2
        header = (31 << 27) | ((size.bit_length() - 7) << 23)
        header |= (len(words) - 1) << 10 | len(caps)
        put(base, [header] + words[1:])
        put(base + (size - len(caps)) * 4, caps)
        descriptor(slot, base, size - 1)
        code.update({base + i * 4: w for i, w in enumerate(words) if i})
        return size

    # Approved profile geometry; synthetic private services, not all 17 entries.
    put(0, [pack_namespace_word0(16384, 256), 0, 13, 0])
    descriptor(1, 0, 1023)
    descriptor(2, THREAD, 255)
    assert program(9, MINT, images["mint"], [
        gt(9, 32), gt(43, 3), gt(47, 8), gt(44, 3),
        gt(15, 32), gt(45, 3), gt(21, 32)]) * 4 <= CLEANER - MINT
    program(21, CLEANER, images["cleaner"],
            [gt(21, 32), gt(46, 3), gt(44, 3)])
    program(15, VERIFY, images["verify"], [gt(15, 32)])
    program(20, CALLER, images["callers"][scenario], [
        gt(20, 32), gt(9, 32), gt(43, 1),
        gt(49, 8), gt(48, 3), gt(45, 1)])
    descriptor(43, STATE, 127)
    descriptor(44, POOL, 255)
    descriptor(45, 0, 1023)
    descriptor(46, CLEANSTATE, 511)
    descriptor(47, STATE + 127 * 4, 0)  # explicit private one-word L view
    descriptor(48, 0xB000, 0)  # isolated caller-owned token scratch
    descriptor(49, 0xB000, 0)
    put(STATE, [(31 << 27) | (1 << 23) | (1 << 8) | 1,
                0, 0, 7, 9, 0, HISTORY, SLOT, SLOT + 1])
    mem[STATE + (HISTORY + SLOT) * 4] = 512
    mem[STATE + (HISTORY + SLOT + 1) * 4] = 512
    put(CLEANSTATE, [0, 0, 16, POOL, 64])
    put(POOL, [SENTINEL] * 256)
    put(THREAD, [(31 << 27) | (2 << 23) | (32 << 10) | (2 << 8) | 12])
    mem[THREAD + 17 * 4] = 0x10F1
    put(THREAD + 242 * 4,
        [gt(20, 32), (0x7FFF << 13) | 0x10F3, gt(20, 32)])
    return mem, code


def replay(images, scenario, *, stop_pc=None):
    mem, code = provision(images, scenario)
    before = mem.copy()
    core = ChurchCore(iot_profile=False)
    result = {"returns": [], "writes": [], "retired": [], "fault": None}
    # Synthetic bootstrap only: no legacy slot-1 LOAD; CHANGE validates Thread 2.
    boot = [0xAF004000, BOOT_PROGRAM[1], BOOT_PROGRAM[2]]

    async def bench(ctx):
        await boot_core(ctx, core)
        await set_cr(ctx, core, 15, 0, 0, 1023)
        await set_cr(ctx, core, 12, gt(2), 0, 0)
        ctx.set(core.defer_fault_reset, 1)  # retain fault evidence, never skip it
        pending = None
        awaiting_return = False
        for cycle in range(300000):
            address = ctx.get(core.imem_addr)
            ctx.set(core.imem_data, boot[address // 4] if address < 12
                    else mem.get(address, 0))
            ctx.set(core.imem_valid, 1)
            ctx.set(core.dmem_rd_valid, pending is not None)
            ctx.set(core.dmem_rd_data, mem.get(pending, 0))
            await ctx.delay(1e-9)
            rd = ctx.get(core.dmem_addr) if ctx.get(core.dmem_rd_en) else None
            if rd is not None:
                assert rd in mem and rd % 4 == 0
            assert not ctx.get(core.ns_wr_en)
            assert not ctx.get(core.clist_wr_en)
            if ctx.get(core.dmem_wr_en):
                addr, value = ctx.get(core.dmem_addr), ctx.get(core.dmem_wr_data)
                assert addr in mem and addr % 4 == 0
                assert addr not in code, "instruction bytes must remain exact"
                mem[addr] = value
                result["writes"].append((addr, value))
            if ctx.get(core.fault_valid):
                result["fault"] = (ctx.get(core.fault), address)
                result["fault_cr"] = [tuple(ctx.get(w) for w in row)
                                      for row in core.debug_cr_words]
                break
            if ctx.get(core.retire_valid):
                pc, word = ctx.get(core.retire_nia), ctx.get(core.retire_instr)
                assert word == (boot[pc // 4] if pc < 12 else code[pc])
                result["retired"].append((pc, word))
                if CALLER <= pc < CALLER + 4096:
                    if awaiting_return:
                        result["returns"].append({
                            "cr1": tuple(ctx.get(w) for w in core.debug_cr_words[1]),
                            "dr1": ctx.get(core.debug_dr_words[1]), "mem": mem.copy(),
                        })
                        awaiting_return = False
                    if word >> 27 == 2:
                        awaiting_return = True
                    if word == 0 or pc == stop_pc:
                        break
            pending = rd
            await ctx.tick()
        else:
            pytest.fail(f"bounded RTL execution timed out at {address:#x}")
        result["dr6"] = ctx.get(core.debug_dr_words[6])

    sim = Simulator(core)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()
    assert all(mem[a] == w for a, w in code.items())
    allowed = set(range(THREAD, THREAD + 1024, 4))
    allowed |= set(range(STATE, STATE + 512, 4))
    allowed |= set(range(CLEANSTATE, CLEANSTATE + 2048, 4))
    allowed |= set(range(SLOT * 16, SLOT * 16 + 16, 4))
    allowed |= set(range(POOL, POOL + 32, 4))
    allowed.add(0xB000)
    assert all(mem[a] == w for a, w in before.items() if a not in allowed)
    result.update(mem=mem)
    return result


def check_lifecycle(r, reused):
    assert len(r["returns"]) == (3 if reused else 2)
    first, released = r["returns"][:2]
    assert first["dr1"] == released["dr1"] == 1
    assert first["cr1"] == (gt(SLOT, 3, b=1), POOL, 7)
    assert [first["mem"][POOL + i * 4] for i in range(8)] == [0] * 8
    assert released["cr1"] == (0, 0, 0)
    assert released["mem"][STATE + (HISTORY + SLOT) * 4] == 1
    assert [released["mem"][SLOT * 16 + i * 4] for i in range(4)] == [0] * 4
    assert released["mem"][POOL] == 123, "release is not synchronous cleaning"
    records = [CLEANSTATE + (5 + i * 4) * 4 for i in range(64)]
    record = next(a for a in records if released["mem"][a + 8] == SLOT)
    assert released["mem"][record + 12] == 2
    if reused:
        again = r["returns"][2]
        assert again["dr1"] == 1
        assert again["cr1"] == (gt(SLOT, 3, 1, 1), POOL, 7 | 1 << 21)
        assert again["mem"][STATE + (HISTORY + SLOT) * 4] == 1025
        assert again["mem"][record + 12] == 1
        assert [again["mem"][POOL + i * 4] for i in range(8)] == [0] * 8
        assert again["mem"][CLEANSTATE + 4] == 8, "reuse does not bump cursor"
        w1 = 7 | 1 << 21
        assert [again["mem"][SLOT * 16 + i * 4] for i in range(4)] == [
            POOL, w1, integrity32(POOL, w1), gt(SLOT, 3, 1, 1)]
    assert any(VERIFY <= pc < VERIFY + 256 for pc, _ in r["retired"])
    assert any(CLEANER <= pc < VERIFY for pc, _ in r["retired"])


def test_exact_create_destroy_reuse(images):
    r = replay(images, "reuse")
    assert r["fault"] is None, r["fault"]
    check_lifecycle(r, reused=True)
    assert r["dr6"] == r["mem"][POOL] == 123


@pytest.mark.parametrize("scenario,reused", [
    ("staleReleased", False), ("staleReused", True),
])
def test_stale_gt_rejected_by_machine(images, scenario, reused):
    r = replay(images, scenario)
    check_lifecycle(r, reused)
    assert r["fault"] is not None
    assert r["fault"][0] == (FaultType.VERSION if reused else FaultType.SEAL)
    assert CALLER <= r["fault"][1] < CALLER + 4096
    assert r["mem"][POOL] == (0 if reused else 123)


def test_read_only_gt_cannot_write(images):
    r = replay(images, "readOnlyWrite")
    assert len(r["returns"]) == 1
    assert r["fault"] is not None
    assert r["fault"][0] == FaultType.PERM_W
    assert CALLER <= r["fault"][1] < CALLER + 4096
    assert r["mem"][POOL] == 0
