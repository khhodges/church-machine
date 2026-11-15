"""Exact public SR candidate qualification: no instruction translation or live IO."""
import hashlib
import struct
import json
import subprocess
import pytest
from pathlib import Path

from amaranth import Elaboratable, Module
from amaranth.sim import Simulator
from hardware.configured_m_control import MControlRecipient
from hardware.fault_entry import FaultBootBinding
from hardware.integrity32 import integrity32
from candidate_test_support import module
from test_candidate_core import _install_amaranth_elaboration_caches


def prepare(row=3):
    words, _, _, _ = module("candidate_mediated_fixture").prepare()
    compile_source = module("amoeba_fixture").run_compile
    source = (Path(__file__).resolve().parents[3] /
              "simulator/cloomc/security_regulator.cloomc").read_text()
    # Use the candidate's own build path, not the worker's assembly-language
    # auto-detection (leading comments can select its plain assembler).
    sr = json.loads(subprocess.check_output(["node", "-e", """
        const fs = require('fs');
        const Compiler = require('./simulator/cloomc_compiler');
        const builder = require('./simulator/lump_builder');
        const c = new Compiler().compile(fs.readFileSync(0, 'utf8'), []);
        if (c.errors.length) throw Error(JSON.stringify(c.errors));
        console.log(JSON.stringify({words: Array.from(builder.buildLump(c).words)}));
    """], input=source, text=True, cwd=Path(__file__).resolve().parents[3]))
    raw = struct.pack("<%dI" % len(sr["words"]), *sr["words"])
    assert hashlib.sha256(raw).hexdigest() == (
        "f2d72bb5997c970c5d170103f82a21620e289839f920605eb76f9ee6437dffd1")
    caller = compile_source(dict(source="""abstraction trial.SwitchCaller {
        capabilities { SELF E, ide.SecurityRegulator E, trial.Links L }
        main method Run() {
            LOAD CR1, CR6, #2
            IADD DR1, DR0, #3
            LOAD CR11, CR6, #1
            CALL CR11, #2
            IADD DR10, DR0, #37
            HALT
        }
    }""".replace("DR0, #3\n", f"DR0, #{row}\n"), language="assembly", tier=0))
    assert caller["ok"], caller

    def put(base, body):
        words[base//4:base//4+len(body)] = body

    def descriptor(root, slot, base, size, version=0):
        location, authority = base//4, size-1 | version << 21
        put(root+slot*16, [location, authority, integrity32(location, authority), 0])

    # Replicated bodies, disjoint source tables and SYSTEM slot 2 homes.
    # Only the declared binding suffix changes; all instruction words stay exact.
    for root, code, regulator, links, thread, next_gt in (
        (0, 0x8000, 0xa000, 0x5800, 0x1000, 0x022f000a),
        (0x10000, 0x19000, 0x18000, 0x5900, 0x11000, 0x022e000a),
    ):
        body = list(caller["words"])
        body[-3:] = [0x4a490003, 0x4a000017, 0x1a00000b]
        put(code, body)
        descriptor(root, 3, code, len(body), 73)
        body = list(sr["words"])
        body[-6:] = [0x4a000017, 0x2200000d, 0, 0, 0, 0]
        put(regulator, body)
        assert body[:-6] == sr["words"][:-6]
        descriptor(root, 23, regulator, len(body))
        descriptor(root, 11, links, 4)
        entries = [0, 0, 0, 0]
        entries[row] = next_gt
        put(links, entries)  # public DR1, not the old fixed SR row 2
        put(thread + 242*4, [0x4a490003,
            0x0ffff0f3 | ((caller["words"][1]-1) << 13), 0x4a490003])
    digest = hashlib.sha256(struct.pack("<32768I", *words)).hexdigest()
    binding = FaultBootBinding.from_image(
        words, namespace=0x022e0001 | words[5] << 64,
        thread_gt=0x02000002, image_sha256=digest, resident_words=True,
        boot_guard=46 << 9, memory_bytes=131072)
    recipients = tuple(MControlRecipient.from_image(words, namespace_base=root, slot=23)
                       for root in (0, 0x10000))
    return words, binding, recipients, sr


@pytest.mark.parametrize("row", [1, 3])
def test_exact_candidate_round_trip(row):
    words, binding, recipients, sr = prepare(row)

    class Fixture(Elaboratable):
        def __init__(self):
            self.mem = module("candidate_memory").CandidateMemory(init=words)
            self.bridge = module("candidate_core").CandidateCoreBridge(
                self.mem, binding, m_control_recipients=recipients)

        def elaborate(self, platform):
            m = Module()
            m.submodules.memory = self.mem
            m.submodules.bridge = self.bridge
            m.d.comb += self.mem.cpu_enabled.eq(~self.bridge.held)
            return m

    dut = Fixture()
    _install_amaranth_elaboration_caches()
    sim = Simulator(dut)
    sim.add_clock(1e-6)

    async def bench(ctx):
        core = dut.bridge.core
        await ctx.tick().repeat(3)
        ctx.set(dut.bridge.held, 0)
        retired = []
        switch_addr = 0xa000 + (sr["words"][3] + 8)*4
        assert words[switch_addr//4] == 0x2f008001
        reached = False
        after_switch_writes = []
        roots = []
        last_root = 0
        caller_view = None
        resumed_sr = False
        for _ in range(12000):
            if ctx.get(core.retire_valid):
                retired.append((ctx.get(core.retire_nia), ctx.get(core.retire_instr)))
            if not reached and ctx.get(core.nia) == switch_addr:
                reached = True
                assert ctx.get(core.debug_cr_words[1][0]) == 0x1a00000b
                assert ctx.get(core.debug_dr_words[1]) == row
            if not reached and ctx.get(core.debug_cr_words[14][0]) & 0xffff == 3:
                caller_view = tuple(ctx.get(w) for w in core.debug_cr_words[14])
            if reached and ctx.get(dut.mem.commit):
                after_switch_writes.append(ctx.get(dut.mem.commit_address))
            assert not ctx.get(core.fault_valid), (
                hex(ctx.get(core.nia)), ctx.get(core.fault), roots, retired[-12:])
            root = ctx.get(core.debug_cr_words[15][1])
            if root != last_root:
                roots.append(root)
                last_root = root
            if roots == [0x10000, 0] and ctx.get(core.nia) == switch_addr + 4:
                resumed_sr = True
                assert ctx.get(core.debug_cr_words[14][0]) == 0x52000017  # restored RX view
            if ctx.get(core.debug_dr_words[10]) == 37:
                assert reached
                assert resumed_sr, "Did not restore the suspended SR continuation"
                assert roots == [0x10000, 0]
                assert caller_view is not None
                # RETURN rebuilds an RX code view from the protected E identity;
                # reset startup exposed X only. Location/version/extent match.
                assert tuple(ctx.get(w) for w in core.debug_cr_words[14]) == (
                    caller_view[0] | 0x10000000, *caller_view[1:])
                assert ctx.get(core.debug_cr_words[12][0]) == 0x02000002
                assert ctx.get(core.debug_cr_words[15][1]) == 0
                assert ctx.get(core.debug_dr_words[1]) == 0
                assert sum(word >> 27 == 2 for _, word in retired) >= 2
                assert any(word >> 27 == 3 for _, word in retired), "No real RETURN"
                assert any(0x1000 <= addr < 0x1400 for addr in after_switch_writes)
                assert any(0x11000 <= addr < 0x11400 for addr in after_switch_writes)
                return
            await ctx.tick()
        raise AssertionError(("No round trip", roots, hex(ctx.get(core.nia)), retired[-12:]))

    sim.add_testbench(bench)
    sim.run()
