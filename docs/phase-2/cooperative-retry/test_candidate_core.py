"""Real core + banked RAM + retained Boot continuation, disposable inputs only."""
import hashlib
import struct

import pytest
from amaranth import Elaboratable, Module
from amaranth.sim import Simulator
from hardware.fault_entry import FaultBootBinding
from hardware.integrity32 import integrity32
from hardware.test_fault_entry_integration import fault_fixture, GUARD
from hardware.boot_rom import encode_church, encode_turing
from hardware.hw_types import ChurchOpcode, TuringOpcode
from hardware.test_wukong_upload_fsm import _install_amaranth_elaboration_caches
from candidate_test_support import module

CandidateMemory = module("candidate_memory").CandidateMemory
CandidateCoreBridge = module("candidate_core").CandidateCoreBridge


def prepared(*, access=None, boot_bad=False):
    mem, _, _ = fault_fixture()
    # New disposable image declares the 128 KiB physical capacity. Do not
    # reinterpret the historical 64 KiB header as a larger image.
    mem[0] = (mem[0] & ~(15 << 23)) | (2 << 23)
    # Relocate the complete trusted Boot root/Thread/code/healthy-work region,
    # not instruction words or GTs. Stored resident descriptor locations
    # are word addresses; seals are recomputed for those explicit fixtures.
    old = {a: v for a, v in mem.items() if a >= 0x8000}
    for a in old:
        del mem[a]
    for a, v in old.items():
        mem[a + 0x10000] = v
    for slot in range(1, 6):
        a = 0x18000 + slot * 16
        mem[a] += 0x4000
        mem[a + 8] = integrity32(mem[a], mem[a + 4])
    if access is not None:
        a, raw, auth = 7 * 16, access // 4, 63
        mem.update({a: raw, a+4: auth, a+8: integrity32(raw, auth), a+12: 0})
        mem[8] = 6  # occupied slots beyond self
        mem[0x4000] = (mem[0x4000] & ~255) | 3
        mem[0x4000 + 61 * 4] = 0x4a000005
        mem[0x4000 + 63 * 4] = 0x32000007
        mem.update({
            0x4008: encode_church(ChurchOpcode.LOAD, cr_dst=3, cr_src=6, imm=2 << 4),
            0x400c: encode_turing(TuringOpcode.IADD, dr_dst=1, dr_src=0, imm=17),
            0x4010: encode_church(ChurchOpcode.DWRITE, cr_dst=1, cr_src=3),
            0x4014: encode_church(ChurchOpcode.DREAD, cr_dst=2, cr_src=3),
            0x4018: 0xf7000000,
        })
    words = tuple(mem.get(i * 4, 0) for i in range(32768))
    digest = hashlib.sha256(struct.pack("<32768I", *words)).hexdigest()
    binding = FaultBootBinding.from_image(
        words, namespace=0x02030001 | 0x18000 << 32 | (255 | 3 << 21) << 64,
        thread_gt=0x02050002, image_sha256=digest, resident_words=True,
        boot_guard=GUARD, memory_bytes=131072)
    if boot_bad:
        # A post-binding memory mutation must be rejected, not re-certified.
        altered = list(words)
        altered[0x18028 // 4] ^= 1
        words = tuple(altered)
    return words, binding


class Fixture(Elaboratable):
    def __init__(self, words, binding):
        self.memory = CandidateMemory(init=words)
        self.bridge = CandidateCoreBridge(self.memory, binding)
        self.core = self.bridge.core

    def elaborate(self, platform):
        m = Module()
        m.submodules.memory = self.memory
        m.submodules.bridge = self.bridge
        m.d.comb += [self.memory.cpu_enabled.eq(~self.bridge.held),
                     self.memory.maintenance.eq(self.bridge.held)]
        return m


@pytest.mark.parametrize("access,bad", [(None, False), (0x12000, False),
                                       (0x40000, False), (None, True)])
def test_real_core_high_ram_and_cross_root_boot(access, bad):
    words, binding = prepared(access=access, boot_bad=bad)
    d = Fixture(words, binding)
    _install_amaranth_elaboration_caches()
    sim = Simulator(d)
    sim.add_clock(1e-6)
    async def bench(ctx):
        core, mem = d.core, d.memory
        await ctx.tick().repeat(3)
        assert not ctx.get(core.retire_valid)
        ctx.set(d.bridge.held, 0)
        writes, faults, reads, retired = [], [], [], []
        readback = False
        for cycle in range(12000):
            if ctx.get(core.fault_entry_active):
                reads.append((cycle, ctx.get(core.dmem_addr), ctx.get(core.dmem_rd_en),
                              ctx.get(core.dmem_rd_valid), ctx.get(core.dmem_rd_data),
                              ctx.get(core.fault_memory_safe)))
            if ctx.get(mem.commit):
                writes.append((ctx.get(mem.commit_address), ctx.get(mem.commit_data)))
            if ctx.get(core.retire_valid):
                record = (ctx.get(core.retire_nia), ctx.get(core.retire_instr),
                          ctx.get(core.retire_fault_valid))
                retired.append(record)
                if record[0] == 0x4014 and not record[2]:
                    assert ctx.get(core.debug_dr_words[2]) == 17
                    readback = True
            if ctx.get(core.retire_fault_valid) and not ctx.get(core.fault_entry_active):
                faults.append((ctx.get(core.retire_nia), ctx.get(core.fault),
                               ctx.get(core.retire_instr)))
            if ctx.get(core.fault_catastrophic):
                assert bad, (cycle, faults, writes[-8:], retired[-8:], reads[-24:])
                for _ in range(4):
                    await ctx.tick()
                    assert not ctx.get(mem.commit)
                return
            if ctx.get(core.fault_entry_done):
                assert not bad
                assert ctx.get(core.imem_addr) == 0x1a008
                assert ctx.get(core.debug_cr_words[15][1]) == 0x18000
                assert ctx.get(core.debug_cr_words[2][1]) == 0
                assert ctx.get(core.debug_cr_words[1][1]) == 0x3000
                assert ctx.get(core.debug_dr_words[6]) == 0x12345678
                assert ctx.get(core.flags.as_value()) == 5
                if access == 0x40000:
                    assert faults[0][0:2] == (0x4010, 8), faults
                    assert not any(a == 0 or a == 0x40000 for a, _ in writes)
                    assert not any(n == 0x4010 and not f for n, _, f in retired)
                elif access == 0x12000:
                    assert readback
                    assert (access, 17) in writes
                assert faults
                assert ctx.get(core.debug_dr_words[2]) == faults[0][0]
                assert ctx.get(core.debug_dr_words[4]) == faults[0][2]
                return
            await ctx.tick()
        pytest.fail(f"No terminal result: faults={faults}, pc={ctx.get(core.imem_addr):x}, "
                    f"writes={writes[-10:]}, retired={retired[-10:]}")
    sim.add_testbench(bench)
    sim.run()
