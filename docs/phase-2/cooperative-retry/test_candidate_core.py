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
            0x4010: encode_turing(TuringOpcode.DWRITE, dr_dst=1, dr_src=3),
            0x4014: encode_turing(TuringOpcode.DREAD, dr_dst=2, dr_src=3),
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
                              ctx.get(core.fault_memory_safe),
                              ctx.get(core.model_change.change_fault),
                              ctx.get(core.model_change.fault_type)))
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
                assert bad, f"cycle={cycle} faults={faults} writes={writes[-8:]} reads={reads[-24:]}"
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


@pytest.mark.parametrize("admitted_top", [False, True])
def test_candidate_handshake_has_no_combinational_cycles(admitted_top):
    # Runs the local graph checker before any vendor processing. In particular,
    # request-derived readiness must never gate its own recovery request.
    from amaranth.back import rtlil
    words, binding = prepared()
    _install_amaranth_elaboration_caches()
    dut = (module("candidate_core").CandidateCoreTop(words, binding)
           if admitted_top else Fixture(words, binding))
    rtlil.convert(dut, ports=[])


def test_recovery_stash_acceptance_and_actual_ram_readback():
    """Qualify stashing only; do not disguise the later activation failure."""
    words, binding = prepared()
    dut = Fixture(words, binding)
    _install_amaranth_elaboration_caches()
    sim = Simulator(dut)
    sim.add_clock(1e-6)

    async def bench(ctx):
        core, mem = dut.core, dut.memory
        await ctx.tick().repeat(3)
        assert not ctx.get(core.fault_memory_safe)
        assert not ctx.get(core.dmem_write_granted)
        ctx.set(dut.bridge.held, 0)
        original = None
        stores = []
        for _ in range(2000):
            if ctx.get(core.retire_fault_valid) and not ctx.get(core.fault_entry_active):
                original = (ctx.get(core.debug_cr_words[12][0]),
                            ctx.get(core.debug_cr_words[15][0]),
                            ctx.get(core.fault), ctx.get(core.retire_nia),
                            ctx.get(core.retire_instr))
            if ctx.get(core.fault_entry_active):
                assert ctx.get(core.fault_memory_safe)
                if ctx.get(mem.commit):
                    assert ctx.get(core.dmem_write_granted)
                    assert ctx.get(mem.commit_source) == 2
                    stores.append((ctx.get(mem.commit_address), ctx.get(mem.commit_data)))
            if ctx.get(core.fault_evidence_ready):
                assert original is not None
                assert original[2:] == (11, 0x4008, 0xf7000000)
                expected = {
                    0x19000 + 245 * 4: original[0],
                    0x19000 + 246 * 4: original[1],
                    0x19008: original[2],
                    0x1900c: original[3],
                    0x19014: original[4],
                    0x19010: 1,  # outgoing context save succeeded
                    0x19018: 0,
                }
                for address, value in expected.items():
                    assert (address, value) in stores
                protected = [0x19000 + n * 4 for n in (238, 239, 244)]
                assert not any(address in protected for address, _ in stores)
                for address in protected:
                    expected[address] = words[address // 4]
                # Independent inspect lane reads the real RAM, not the grant
                # trace or an expected-data shadow.
                for address, value in expected.items():
                    ctx.set(mem.inspect.address, address)
                    ctx.set(mem.inspect.read, 1)
                    await ctx.tick()
                    assert ctx.get(mem.inspect.rvalid)
                    assert not ctx.get(mem.inspect.rerror)
                    assert ctx.get(mem.inspect.rdata) == value
                return
            assert not ctx.get(core.fault_catastrophic)
            await ctx.tick()
        pytest.fail("Direct fault stash did not reach verified evidence")

    sim.add_testbench(bench)
    sim.run()
