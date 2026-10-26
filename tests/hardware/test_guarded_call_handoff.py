"""Exact retained image through real core reset, marker and checked CALL."""
from pathlib import Path
import struct
import hashlib
import pytest
from amaranth.sim import Simulator
from hardware.core import ChurchCore
from hardware.boot_rom import BOOT_PROGRAM
from hardware.hw_types import FaultType
from hardware.integrity32 import integrity32


@pytest.mark.parametrize("case,fault", [
    ("exact", None), ("version", FaultType.VERSION),
    ("seal", FaultType.SEAL), ("header", FaultType.BOUNDS),
    ("permission", FaultType.PERM_E),
    ("untrusted_rom", FaultType.INVALID_OP),
    ("rom_after_handoff", FaultType.INVALID_OP),
])
def test_guarded_call_handoff(case, fault):
    path = Path(__file__).resolve().parents[2] / "docs/phase-1/reload-evidence/new-layout-guarded/candidate-le.bin"
    image = path.read_bytes()
    assert hashlib.sha256(image).hexdigest() == "866886bca3670f74e9e5ee3726c26302741d3557b2fef40622ffa9e9ee994879"
    words = list(struct.unpack("<16384I", image))
    original = words[:]
    entry = words[80]
    rom = list(BOOT_PROGRAM)
    rom[1] = 0x27000001
    core = ChurchCore(expected_boot_guard=23971)
    sim = Simulator(core)
    sim.add_clock(1e-6)

    async def bench(ctx):
        retired = []
        changed = False
        first_instruction = False
        fault_seen = 0
        ctx.set(core.defer_fault_reset, 1)
        ctx.set(core.boot_start, 1)
        for cycle in range(1200):
            pc = ctx.get(core.imem_addr)
            ctx.set(core.dbg_cr_wr_en, 0)
            pause = False
            ctx.set(core.imem_fetch_address, pc)
            if ctx.get(core.boot_thread_activated) and not changed:
                changed = True
                # Fault injection after admission: these must be CALL checks,
                # not early Thread-admission rejection.
                if case == "version":
                    words[81] ^= 1 << 17
                    words[82] = integrity32(words[80], words[81])
                elif case == "seal":
                    words[82] ^= 1
                elif case == "header":
                    words[entry] = 0
                elif case == "permission":
                    # Test-only downgrade while the CALL fetch is withheld.
                    value = sum(ctx.get(w) << (32*i)
                                for i, w in enumerate(core.debug_cr_words[0]))
                    ctx.set(core.dbg_cr_wr_en, 1)
                    ctx.set(core.dbg_cr_wr_addr, 0)
                    ctx.set(core.dbg_cr_wr_data.as_value(), value & ~(1 << 30))
                    pause = True
            source_rom = pc < 16
            if case == "untrusted_rom" and pc == 8:
                source_rom = False
            if case == "rom_after_handoff" and first_instruction:
                source_rom = True
            ctx.set(core.imem_from_reset_rom, source_rom)
            ctx.set(core.imem_data, rom[pc//4] if pc < 16 else words[pc//4])
            ctx.set(core.imem_valid, not pause)
            if ctx.get(core.fault_valid):
                assert fault is not None, (cycle, hex(pc), ctx.get(core.fault), retired)
                assert ctx.get(core.fault) == fault
                assert all(ctx.get(w) == 0 for w in core.debug_cr_words[13])
                assert not (ctx.get(core.dbg_m_bit_state) & (1 << 12))
                fault_seen += 1
                if case != "rom_after_handoff":
                    assert not ctx.get(core.boot_complete)
                    assert not ctx.get(core.boot_marker_available)
                    assert pc == 8
                    assert (8, rom[2]) not in retired
                    assert words[498:500] == original[498:500]
                if fault_seen == 4:
                    return
            elif ctx.get(core.retire_valid):
                retired.append((ctx.get(core.retire_nia), ctx.get(core.retire_instr)))
                if pc == (entry + 1)*4:
                    # CALL selector zero is the existing direct-entry form.
                    # Retain its exact first word; do not substitute a body PC.
                    assert retired == [(4, rom[1]), (8, rom[2]),
                                       ((entry + 1)*4, words[entry+1])]
                elif pc >= 16:
                    assert fault is None or case == "rom_after_handoff"
                    assert ctx.get(core.boot_complete)
                    assert retired == [(4, rom[1]), (8, rom[2]),
                                       ((entry + 1)*4, words[entry+1]),
                                       ((entry + 2)*4, words[entry+2])]
                    assert all(ctx.get(w) == 0 for w in core.debug_cr_words[13])
                    assert not (ctx.get(core.dbg_m_bit_state) & (1 << 12))
                    assert ctx.get(core.debug_cr_words[6][0]) == original[500]
                    assert [ctx.get(w) for w in core.debug_cr_words[14]] == [
                        0x42000014, (entry + 1)*4, 6]  # X, not an invented R grant
                    assert ctx.get(core.dbg_m_bit_state) == (1 << 6)
                    size = 1 << (((original[entry] >> 23) & 15) + 6)
                    loaded_gt = original[entry + size - (original[entry] & 255) + 1]
                    loaded_slot = loaded_gt & 65535
                    raw_authority = original[loaded_slot*4+1]
                    # Retirement announces this edge's register write. Observe
                    # committed CR2 after the edge, withholding the next fetch.
                    ctx.set(core.imem_valid, 0)
                    await ctx.tick()
                    assert [ctx.get(w) for w in core.debug_cr_words[2]] == [
                        loaded_gt, original[loaded_slot*4]*4,
                        (raw_authority & 0x1ffff) |
                        (((raw_authority >> 17) & 511) << 21)]
                    assert words[498:500] == original[498:500]
                    for slot in range(64):
                        assert words[slot*4] == original[slot*4]
                        assert words[slot*4+1] & 0x3fffffff == original[slot*4+1] & 0x3fffffff
                    first_instruction = True
                    if case == "exact":
                        return
            en, addr = ctx.get(core.dmem_rd_en), ctx.get(core.dmem_addr)
            data = words[addr//4] if en else 0
            if ctx.get(core.dmem_wr_en):
                words[addr//4] = ctx.get(core.dmem_wr_data)
            assert not ctx.get(core.ns_wr_en)
            assert not ctx.get(core.clist_wr_en)
            await ctx.tick()
            ctx.set(core.boot_start, 0)
            ctx.set(core.dmem_rd_valid, en)
            ctx.set(core.dmem_rd_data, data)
        raise AssertionError(("handoff timeout", retired, hex(ctx.get(core.imem_addr))))

    sim.add_testbench(bench)
    sim.run()
