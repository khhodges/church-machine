"""Mandatory numeric dispatch through the real core, private RAM only.

The retained guarded image supplies initial Namespace/Thread state. Synthetic
code is installed only in this test's RAM; no historical file is rewritten.
"""
import json
from pathlib import Path
import re
import struct
import subprocess

import pytest
from amaranth.sim import Simulator
from hardware.boot_rom import BOOT_PROGRAM, encode_church
from hardware.core import ChurchCore
from hardware.hw_types import ChurchOpcode, FaultType
from hardware.integrity32 import integrity32

ROOT = Path(__file__).resolve().parents[2]


def test_selectable_callhome_boot_enters_body_not_table():
    from hardware.test_boot_rom_no_false_halt import (
        BootRomHarness, _build_dmem_init, _wait_boot_complete)
    from hardware.boot_rom import (
        WUKONG_THREAD_CAPS0_WORD, WUKONG_WCH_BASE_WORD,
        WUKONG_NUC_PROGRAM, initialize_factory_thread_root)
    words = _build_dmem_init()
    words[WUKONG_THREAD_CAPS0_WORD] = 0x4a000007
    initialize_factory_thread_root(words, 0x4a000007)
    dut = BootRomHarness(words)
    sim = Simulator(dut)
    sim.add_clock(1e-6)

    async def bench(ctx):
        assert await _wait_boot_complete(ctx, dut)
        retires = []
        for _ in range(1400):
            assert not ctx.get(dut.core.fault_valid), (
                ctx.get(dut.core.fault), ctx.get(dut.core.nia), retires)
            if ctx.get(dut.core.retire_valid):
                retires.append(ctx.get(dut.core.retire_nia))
                assert not ctx.get(dut.core.retire_fault_valid)
                if len(retires) == 4:
                    assert retires == [0, 4, 8, (WUKONG_WCH_BASE_WORD+2)*4]
                    assert ctx.get(dut.core.retire_instr) == WUKONG_NUC_PROGRAM[1]
                    assert ctx.get(dut.core.debug_cr_words[6][0]) == 0x4a000007
                    assert ctx.get(dut.core.dbg_m_bit_state) == 1 << 6
                    return
            await ctx.tick()
        pytest.fail("CallHome startup did not retire its first authored instruction")

    sim.add_testbench(bench)
    sim.run()


def test_boot_words_and_simulator_dispatch_contract():
    browser = (ROOT / "simulator/hw_binary.js").read_text().split("];", 1)[0]
    assert [int(v, 16) for v in re.findall(r"0x[0-9A-Fa-f]+", browser)] == BOOT_PROGRAM[:3]
    assert BOOT_PROGRAM[:3] == [0x077f8000, 0x27678001, 0x17000001]
    subprocess.run(["node", "tests/simulator/sim_call_dispatch_required.js"],
                   cwd=ROOT, check=True, capture_output=True, text=True)


@pytest.mark.parametrize("selector,entry,fault", [
    (0, 2, FaultType.INVALID_OP),
    (1, 0, FaultType.PERM_E),  # RTL's E denial represents PRIVATE_METHOD.
    (1, 1, FaultType.BOUNDS),
    (1, 3, FaultType.BOUNDS),
    (1, 0xbf000001, FaultType.BOUNDS),
    (3, 2, FaultType.INVALID_OP),  # reset ROM guard rejects changed Boot words
    (1, 2, None),
])
def test_core_dispatch_before_any_architectural_commit(selector, entry, fault):
    _run(selector, entry, fault, nested=False)


def test_nested_dispatch_returns_and_root_underflow():
    _run(1, 2, FaultType.STACK_UNDERFLOW, nested=True)


def _run(selector, entry, fault, *, nested):
    folder = ROOT / "docs/phase-1/reload-evidence/new-layout-guarded"
    words = list(struct.unpack("<16384I", (folder / "candidate-le.bin").read_bytes()))
    guard = json.loads((folder / "guard.json").read_text())["guard18"]
    base = words[80]
    gt = words[500]
    # Same exact valid/invalid table and body words as the JS regression.
    words[base] = 0xf9000803  # original 256-word allocation, cw=2, cc=3
    words[base+1:base+3] = [entry, 0x1f000000]
    rom = BOOT_PROGRAM[:]
    rom[1] = 0x27000001  # guarded profile's approved boot-Thread CHANGE
    rom[2] = 0x17000000 | selector
    expected = [4, 8, (base+2)*4]
    domains = [(base, gt, 3, 256)]
    if nested:
        # Two ordinary CALLs after startup, each with a numeric table word.
        for slot, loc in [(30, 8192), (31, 8256)]:
            words[slot*4:slot*4+4] = [loc, 63, integrity32(loc, 63), 0]
        middle_gt, leaf_gt = 0x4a00001e, 0x4a00001f
        load = encode_church(ChurchOpcode.LOAD, cr_dst=1, cr_src=6, imm=16)
        call = encode_church(ChurchOpcode.CALL, cr_dst=1, imm=1)
        ret = encode_church(ChurchOpcode.RETURN)
        words[base] = 0xf9001403  # cw=5
        words[base+1:base+6] = [2, load, call, ret, 0]
        words[base+254] = middle_gt
        words[8192:8197] = [0xf8001002, 2, load, call, ret]
        words[8254:8256] = [middle_gt, leaf_gt]
        words[8256:8260] = [0xf8000801, 2, ret, 0]
        words[8319] = leaf_gt
        domains += [(8192, middle_gt, 2, 64), (8256, leaf_gt, 1, 64)]
        expected = [4, 8, (base+2)*4, (base+3)*4,
                    8194*4, 8195*4, 8258*4, 8196*4, (base+4)*4]
    initial = words[:]
    core = ChurchCore(expected_boot_guard=guard)
    sim = Simulator(core)
    sim.add_clock(1e-6)

    async def bench(ctx):
        ctx.set(core.defer_fault_reset, 1)
        ctx.set(core.boot_start, 1)
        retires = []
        before_call = None
        entries = set()
        writes = []
        for cycle in range(2200):
            pc = ctx.get(core.imem_addr)
            ctx.set(core.imem_fetch_address, pc)
            ctx.set(core.imem_from_reset_rom, pc < 16)
            ctx.set(core.imem_data, rom[pc//4] if pc < 16 else words[pc//4])
            ctx.set(core.imem_valid, 1)
            crs = [[ctx.get(w) for w in cap] for cap in core.debug_cr_words]
            if pc == 8 and before_call is None:
                before_call = (crs, ctx.get(core.dbg_m_bit_state))
            if ctx.get(core.fault_valid):
                assert ctx.get(core.fault) == fault, (cycle, pc, retires)
                if not nested:
                    assert crs == before_call[0]
                    assert ctx.get(core.dbg_m_bit_state) == before_call[1]
                    assert words[273] == initial[273]
                    assert words[498:500] == initial[498:500]
                    assert retires == [4]
                else:
                    # Root poison must fault, never resume ROM or execute a table.
                    assert retires[:8] == expected[:8]
                    assert set(b for b, *_ in domains) == entries
                    assert words[273] & 0xfff == 241
                    assert words[498:500] == initial[498:500]
                    assert crs[6] == [gt, (base+253)*4, 2]
                    assert ctx.get(core.dbg_m_bit_state) == 1 << 6
                    # Continuations are code-base-relative, not table addresses.
                    assert words[496] == gt
                    assert words[497] == (4-1) << 13 | (1 << 12) | 241
                    assert words[494] == middle_gt
                    assert words[495] == (4-1) << 13 | (1 << 12) | 239
                    assert [v & 0xfff for a, v in writes if a == 273*4] == [
                        241, 239, 237, 239, 241]
                return
            for b, token, cc, size in domains:
                if (nested and b != 8256 and pc == (b+4)*4
                        and ctx.get(core.retire_valid)):
                    # Both returned-to callers regain their c-list, E identity
                    # and M boundary before their continuation can execute.
                    assert crs[6] == [token, (b+size-cc)*4, cc-1]
                    assert ctx.get(core.dbg_m_bit_state) == 1 << 6
                if pc == (b+2)*4 and b not in entries:
                    entries.add(b)
                    assert crs[6] == [token, (b+size-cc)*4, cc-1]
                    assert ctx.get(core.dbg_m_bit_state) == 1 << 6
                    assert crs[14][1] == (b+1)*4
                    if not nested and fault is None:
                        assert retires == [4, 8]
                        assert words[498:500] == initial[498:500]
                        return  # body is RETURN; root underflow is tested below
            if ctx.get(core.retire_valid):
                retires.append(ctx.get(core.retire_nia))
                assert retires == expected[:len(retires)], retires
                if not nested and fault is None and len(retires) == 3:
                    assert entries == {base}
                    assert words[498:500] == initial[498:500]
                    return
            en, addr = ctx.get(core.dmem_rd_en), ctx.get(core.dmem_addr)
            data = words[addr//4] if en else 0
            if ctx.get(core.dmem_wr_en):
                words[addr//4] = ctx.get(core.dmem_wr_data)
                writes.append((addr, words[addr//4]))
            await ctx.tick()
            ctx.set(core.boot_start, 0)
            ctx.set(core.dmem_rd_valid, en)
            ctx.set(core.dmem_rd_data, data)
        pytest.fail(f"timeout: retires={retires}")

    sim.add_testbench(bench)
    sim.run()
