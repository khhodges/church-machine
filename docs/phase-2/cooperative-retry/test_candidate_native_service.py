"""Exact compiler instructions through the maintained core's device bus."""
from amaranth import Elaboratable, Module
from amaranth.sim import Simulator
import pytest
from hardware.integrity32 import integrity32
from candidate_test_support import module
from test_candidate_core import prepared, _install_amaranth_elaboration_caches
from test_candidate_qualified_delivery import records


@pytest.mark.parametrize("bad", [False, True])
def test_native_mmio_write_read_and_rejection_preserve_boot_recovery(bad):
    compile_source = module("amoeba_fixture").run_compile
    offset = 12 if bad else 7
    result = compile_source(dict(source=f"""abstraction trial.NativeService {{
        capabilities {{ SELF E, trial.Other, trial.Device RW }}
        main method Run() {{
            LOAD CR3, CR6, #2
            IADD DR1, DR0, #17
            DWRITE DR1, CR3, #{offset}
            DREAD DR2, CR3, #1
            HARDFAULT "native service test completed"
        }}
    }}""", language="assembly", tier=0))
    assert result.get("ok"), result
    words, binding = prepared(access=0x12000)
    words = list(words)
    code = list(result["words"])
    assert len(code) <= 1024
    code[-3:] = [0x4a000005, 0, 0x32000007]
    words[0x4000//4:0x4000//4 + len(code)] = code
    words[21] = (words[21] & ~0x1fffff) | (len(code) - 1)
    words[22] = integrity32(words[20], words[21])
    # Device NS locations are byte addresses, not ordinary word locations.
    base, auth = module("candidate_service").BASE, 63
    words[28:32] = [base, auth, integrity32(base, auth), 0]

    class Fixture(Elaboratable):
        def __init__(self):
            self.mem = module("candidate_memory").CandidateMemory(init=words)
            self.d = module("candidate_qualified_delivery").QualifiedDelivery(
                self.mem, records(), clock_hz=1000)
            self.svc = module("candidate_service").CandidateService(self.d)
            self.bridge = module("candidate_core").CandidateCoreBridge(
                self.mem, binding, self.svc)

        def elaborate(self, platform):
            m = Module()
            m.submodules.memory = self.mem
            m.submodules.delivery = self.d
            m.submodules.bridge = self.bridge
            m.d.comb += [self.mem.cpu_enabled.eq(~self.bridge.held),
                         self.d.enabled.eq(~self.bridge.held), self.d.epoch.eq(7)]
            return m

    dut = Fixture()
    _install_amaranth_elaboration_caches()
    sim = Simulator(dut)
    sim.add_clock(1e-6)

    async def bench(ctx):
        await ctx.tick().repeat(3)
        ctx.set(dut.bridge.held, 0)
        core = dut.bridge.core
        grants, errors, faults = [], [], []
        for _ in range(14000):
            p = dut.svc.bus
            if ctx.get(p.write) and ctx.get(p.ready):
                (errors if ctx.get(p.error) else grants).append(ctx.get(p.address))
            if ctx.get(core.fault_valid) and not ctx.get(core.fault_entry_active):
                faults.append(ctx.get(core.fault))
            if ctx.get(core.debug_dr_words[10]) == 1:
                assert errors == ([base + offset*4] if bad else [])
                assert grants == ([] if bad else [base + offset*4])
                assert faults, "expected deliberate completion/rejected-MMIO fault"
                return
            await ctx.tick()
        pytest.fail(f"No healthy Boot continuation: grants={grants}, errors={errors}, faults={faults[:5]}")

    sim.add_testbench(bench)
    sim.run()
