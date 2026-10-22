"""Complete compiled CREATE, one ascending Namespace and physical-byte RAM.

Synthetic service provisioning is test privilege, not deployment approval.
All post-boot control flow, publication, issuance and caller access is RTL.
No legacy-layout aliases, instruction translation, or host continuation.
"""
import json
from pathlib import Path
import subprocess

import pytest
from amaranth.sim import Simulator

from hardware.boot_rom import BOOT_PROGRAM
from hardware.core import ChurchCore
from hardware.hw_types import GT_TYPE_INFORM, make_gt
from hardware.integrity32 import integrity32
from hardware.sim_boot_helpers import boot_core
from tests.hardware.phase1_support import set_cr

ROOT = Path(__file__).resolve().parents[2]
THREAD, CALLER, MINT, VERIFY = 0x1000, 0x2000, 0x4000, 0x8000
STATE, POOL = 0x9000, 0xA000
SLOT, HISTORY, COUNT = 39, 16, 8
TARGET = POOL + 8 * 4
SENTINEL = 0xA5C39E71


@pytest.fixture(scope="module")
def images():
    return json.loads(subprocess.check_output(
        ["node", str(Path(__file__).with_name("mint_create_image.js"))],
        cwd=ROOT, text=True, timeout=30))


def gt(slot, permissions=0, seq=0, b=0):
    return make_gt(GT_TYPE_INFORM, permissions, slot, seq, b)


def fixture(images, method, seq, fresh, occupied, scratch_view=True):
    mem = {a: SENTINEL for a in range(0, 0xB000, 4)}
    for a in range(64 * 16):
        if a % 4 == 0:
            mem[a] = 0

    def put(base, words):
        for i, value in enumerate(words):
            mem[base + i * 4] = value

    def descriptor(slot, base, limit):
        put(slot * 16, [base, limit, integrity32(base, limit), 0])

    def program(slot, base, words, caps):
        size = 64
        while size < len(words) + len(caps):
            size *= 2
        # Ordinary LUMP header/C-list fixture construction; instruction words
        # (including method table) are copied byte-for-byte from shared output.
        header = (31 << 27) | ((size.bit_length() - 7) << 23)
        header |= (len(words) - 1) << 10 | len(caps)
        put(base, [header] + words[1:] + [0] * (size - len(words)))
        put(base + (size - len(caps)) * 4, caps)
        descriptor(slot, base, size - 1)

    descriptor(0, 0, 63)
    descriptor(1, THREAD, 255)
    program(29, VERIFY, images["verify"], [gt(29, 32)])
    program(30, MINT, images["mint"], [
        gt(30, 32), gt(43, 3), gt(46 if scratch_view else 43, 8), gt(44, 3),
        gt(29, 32), gt(45, 3)])
    program(31, CALLER, images["callers"][method],
            [gt(31, 32), gt(30, 32), gt(43, 1)])
    descriptor(43, STATE, 127)
    descriptor(44, POOL, 63)
    descriptor(45, 0, 64 * 4 - 1)
    if scratch_view:
        descriptor(46, STATE + 127 * 4, 0)
    put(STATE, [0] * 128)
    put(STATE, [(31 << 27) | (1 << 23) | (1 << 8) | 1,
                8, 64, 7, 9, POOL, HISTORY, SLOT, SLOT])
    mem[STATE + (HISTORY + SLOT) * 4] = seq | fresh << 9
    put(THREAD, [0] * 256)
    mem[THREAD] = (31 << 27) | (2 << 23) | (32 << 10) | (2 << 8) | 12
    mem[THREAD + 17 * 4] = 0x10F1
    put(THREAD + 242 * 4, [gt(31, 32), (0x7FFF << 13) | 0x10F3, gt(31, 32)])
    if occupied is not None:
        mem[SLOT * 16 + occupied * 4] = 0x12345678
    return mem


def replay(images, *, method=0, seq=0, fresh=1, occupied=None, corrupt=None,
           scratch_view=True, prepared_memory=None, boot_words=None,
           namespace_limit=63, caller_base=CALLER, bootstrap_thread=None):
    mem = (fixture(images, method, seq, fresh, occupied, scratch_view)
           if prepared_memory is None else prepared_memory.copy())
    boot_words = BOOT_PROGRAM if boot_words is None else boot_words
    before = mem.copy()
    core = ChurchCore(iot_profile=False)
    result = {"writes": [], "reads": [], "retired": [], "returned": False}

    async def bench(ctx):
        await boot_core(ctx, core)
        # Reset bootstrap root is board-specific; set only its synthetic base.
        # Actual ROM LOAD/CHANGE/CALL establishes Thread header and call frames.
        await set_cr(ctx, core, 15, 0, 0, namespace_limit)
        if bootstrap_thread is not None:
            await set_cr(ctx, core, 12, gt(bootstrap_thread), 0, 0)
        ctx.set(core.defer_fault_reset, 1)
        pending = None
        published = set()
        caller_call_seen = False
        for cycle in range(150000):
            address = ctx.get(core.imem_addr)
            instruction = boot_words[address // 4] if address < 12 else mem.get(address, 0)
            ctx.set(core.imem_data, instruction)
            ctx.set(core.imem_valid, 1)
            ctx.set(core.dmem_rd_valid, pending is not None)
            ctx.set(core.dmem_rd_data, mem.get(pending, 0))
            await ctx.delay(1e-9)
            rd = ctx.get(core.dmem_addr) if ctx.get(core.dmem_rd_en) else None
            if rd is not None:
                assert rd in mem and rd % 4 == 0, hex(rd)
                result["reads"].append(rd)
            assert not ctx.get(core.ns_wr_en), "no native mint side channel"
            assert not ctx.get(core.clist_wr_en), "no host issuance side channel"
            if ctx.get(core.dmem_wr_en):
                addr, value = ctx.get(core.dmem_addr), ctx.get(core.dmem_wr_data)
                assert addr in mem and addr % 4 == 0, hex(addr)
                result["writes"].append((addr, value))
                mem[addr] = value
                if SLOT * 16 <= addr < SLOT * 16 + 16:
                    published.add(addr)
                    if corrupt == (addr - SLOT * 16) // 4:
                        mem[addr] ^= 1  # injected physical storage corruption
            if ctx.get(core.fault_valid):
                result["fault"] = (ctx.get(core.fault), address)
                break
            if ctx.get(core.retire_valid):
                pc, word = ctx.get(core.retire_nia), ctx.get(core.retire_instr)
                assert word == (boot_words[pc // 4] if pc < 12 else mem[pc])
                result["retired"].append((pc, word))
                if caller_base <= pc < caller_base + 1024 and word >> 27 == 2:
                    caller_call_seen = True
                elif caller_call_seen and caller_base <= pc < caller_base + 1024:
                    if not result["returned"]:
                        result["returned"] = True
                        result["return_cr1"] = tuple(ctx.get(w) for w in core.debug_cr_words[1])
                        result["return_dr1"] = ctx.get(core.debug_dr_words[1])
                        result["return_dr"] = [ctx.get(w) for w in core.debug_dr_words]
                        result["return_cr"] = [tuple(ctx.get(w) for w in r)
                                               for r in core.debug_cr_words]
                        result["zero_at_return"] = [mem[TARGET + i * 4] for i in range(COUNT)]
                if word == 0 and caller_base <= pc < caller_base + 1024:
                    result["fault"] = None
                    break
            pending = rd
            await ctx.tick()
        else:
            pytest.fail(f"execution timeout at {address:#x}")
        result["dr"] = [ctx.get(w) for w in core.debug_dr_words]
        result["cr1"] = tuple(ctx.get(w) for w in core.debug_cr_words[1])
        result["published"] = published
    sim = Simulator(core)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()
    result.update(mem=mem, before=before)
    return result


@pytest.mark.parametrize("seq,fresh", [(0, 1), (0, 0), (509, 0)])
def test_complete_create_returns_exact_physical_allocation(images, seq, fresh):
    r = replay(images, seq=seq, fresh=fresh)
    assert r["fault"] is None, r["fault"]
    assert r["returned"]
    version = 0 if fresh else seq + 1
    token = gt(SLOT, 3, version, 1)
    w1 = COUNT - 1 | version << 21
    assert r["return_cr1"] == (token, TARGET, w1)
    assert r["return_dr1"] == 1
    assert all(r["return_dr"][i] == 0 for i in (2, 3, *range(6, 16)))
    assert all(r["return_cr"][i] == (0, 0, 0) for i in (0, 2, 3, 4, *range(7, 12)))
    assert r["zero_at_return"] == [0] * COUNT
    assert [r["mem"][SLOT * 16 + i * 4] for i in range(4)] == [
        TARGET, w1, integrity32(TARGET, w1), token]
    assert r["dr"][6:14] == list(range(80, 88))
    assert [r["mem"][TARGET + i * 4] for i in range(COUNT)] == list(range(80, 88))
    assert r["mem"][STATE + 4] == 16
    assert r["mem"][STATE + 12] == 8
    assert r["mem"][STATE + (HISTORY + SLOT) * 4] == version | 1024
    assert r["mem"][STATE + 127 * 4] == 0
    assert any(VERIFY <= pc < VERIFY + 256 for pc, _ in r["retired"])
    assert sum(word >> 27 == 3 for _, word in r["retired"]) == 2
    # Global check, not just adjacent sentinels: nothing outside explicitly
    # mutable Thread storage, private state, slot, allocation may change.
    allowed = set(range(THREAD, THREAD + 1024, 4))
    allowed |= {STATE + i * 4 for i in (1, 3, HISTORY + SLOT, 127)}
    allowed |= set(range(SLOT * 16, SLOT * 16 + 16, 4))
    allowed |= set(range(TARGET, TARGET + COUNT * 4, 4))
    assert all(r["mem"][a] == v for a, v in r["before"].items() if a not in allowed)


@pytest.mark.parametrize("options", [
    *[{"occupied": i} for i in range(4)],
    *[{"corrupt": i} for i in range(4)],
    {"seq": 510, "fresh": 0}, {"seq": 511, "fresh": 0},
    {"seq": 511, "fresh": 1},
    {"method": 1}, {"method": 2}, {"method": 3},
])
def test_failed_create_and_unsupported_methods_never_return(images, options):
    r = replay(images, **options)
    assert r["fault"] is not None
    assert not r["returned"]
    assert not any(TARGET <= a < TARGET + COUNT * 4 and v != 0 for a, v in r["writes"])
    if "corrupt" in options:
        assert len(r["published"]) == 4
        assert r["cr1"][0] == 0
    else:
        assert not r["published"]
    if "seq" in options:
        assert r["mem"][STATE + (HISTORY + SLOT) * 4] == 511
        assert r["mem"][STATE + 4] == 8
        assert r["mem"][STATE + 12] == 7
        assert all(r["mem"][TARGET + i * 4] == SENTINEL for i in range(COUNT))
    if "occupied" in options or "corrupt" in options:
        assert r["mem"][STATE + 4] == 16, "reservation must precede publication failure"
        assert r["mem"][STATE + 12] == 8
        assert r["mem"][STATE + (HISTORY + SLOT) * 4] == 1024
    if "method" in options:
        assert r["fault"][0] == 11
        assert r["mem"][STATE + 127 * 4] == 0
        assert r["mem"][STATE + 4] == 8
        assert r["mem"][STATE + 12] == 7
