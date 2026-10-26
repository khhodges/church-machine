"""Real-core incoming-only activation, using exact retained bytes by default."""
import json
from pathlib import Path
import struct
import pytest
from amaranth.sim import Simulator
from hardware.core import ChurchCore
from hardware.hw_types import FaultType


@pytest.mark.parametrize("case,fault", [
    ("exact", None), ("restore_values", None),
    ("home_version", FaultType.VERSION), ("entry_seal", FaultType.SEAL),
    ("outform", FaultType.OUTFORM_UNAUTH), ("slot_zero", FaultType.BOUNDS),
])
def test_marker_activation_buffers_state_and_consumes_admission(case, fault):
    folder = Path(__file__).resolve().parents[2] / "docs/phase-1/reload-evidence/new-layout-guarded"
    config = json.loads((folder / "guard.json").read_text())
    words = list(struct.unpack("<16384I", (folder / "candidate-le.bin").read_bytes()))
    base, cap_start = words[8], 244
    if case == "restore_values":
        # Synthetic state exercise; never written to the retained image.
        words[base + 2] = 0x12345678  # saved DR1
        words[base + 17] |= 0xa << 28
        words[base + cap_start + 1] = 0x12000003  # MMIO
        words[base + cap_start + 2] = 0x06000001  # opaque Abstract
        words[base + cap_start + 3] = 0x10000001  # NULL-type payload
    elif case == "home_version":
        words[base + cap_start + 1] = 0x02000002  # stale Thread version 0
    elif case == "entry_seal":
        words[20 * 4 + 2] ^= 1
    elif case == "outform":
        words[base + cap_start + 1] = 0x14000001
    elif case == "slot_zero":
        words[base + cap_start + 1] = 0x02000000
    core = ChurchCore(expected_boot_guard=config["guard18"])
    sim = Simulator(core)
    sim.add_clock(1e-6)

    async def bench(ctx):
        async def tick():
            enabled, addr = ctx.get(core.dmem_rd_en), ctx.get(core.dmem_addr)
            assert not ctx.get(core.dmem_wr_en), "activation must not save outgoing state"
            assert not ctx.get(core.ns_wr_en)
            assert not ctx.get(core.clist_wr_en)
            assert not enabled or (addr % 4 == 0 and addr < 65536)
            await ctx.tick()
            ctx.set(core.dmem_rd_valid, enabled)
            ctx.set(core.dmem_rd_data, words[addr // 4] if enabled else 0)

        ctx.set(core.defer_fault_reset, 1)
        ctx.set(core.boot_start, 1)
        await tick()
        ctx.set(core.boot_start, 0)
        for _ in range(160):
            assert not ctx.get(core.fault_valid)
            if ctx.get(core.boot_thread_validated):
                break
            await tick()
        else:
            pytest.fail("structural validation timed out")
        assert ctx.get(core.imem_addr) == 4
        # Deliberate test-only sentinels: detect partial restore and CR13 clears.
        for register, data in [(0, 0xdeadbeef), (13, 0xcafebabe)]:
            ctx.set(core.dbg_cr_wr_en, 1)
            ctx.set(core.dbg_cr_wr_addr, register)
            ctx.set(core.dbg_cr_wr_data.as_value(), data)
            await tick()
        ctx.set(core.dbg_cr_wr_en, 0)
        before = [[ctx.get(w) for w in cr] for cr in core.debug_cr_words]
        m_before = ctx.get(core.dbg_m_bit_state)
        assert before[13][0] == 0xcafebabe
        assert ctx.get(core.boot_marker_available)
        ctx.set(core.imem_data, 0x27000001)
        ctx.set(core.imem_valid, 1)
        ctx.set(core.imem_from_reset_rom, 1)
        ctx.set(core.imem_fetch_address, 4)
        for _ in range(400):
            if ctx.get(core.fault_valid) or ctx.get(core.boot_thread_activated):
                break
            await tick()
        else:
            pytest.fail("activation timed out")
        assert not ctx.get(core.boot_marker_available)
        assert not ctx.get(core.boot_complete), "final CALL remains disabled"
        assert ctx.get(core.dbg_m_bit_state) == m_before, "no additional M grant"
        assert [ctx.get(w) for w in core.debug_cr_words[13]] == before[13]
        assert [ctx.get(w) for w in core.debug_cr_words[15]] == before[15]
        if fault is not None:
            assert ctx.get(core.fault_valid)
            assert ctx.get(core.fault) == fault
            assert not ctx.get(core.boot_thread_activated)
            assert [[ctx.get(w) for w in cr] for cr in core.debug_cr_words] == before
            # Software-controlled M state is not a way to re-arm the accepted
            # marker after a later capability-validation failure.
            ctx.set(core.dbg_m_bit_wr_en, 1)
            ctx.set(core.dbg_m_bit_word, 0xffff)
            await tick()
            ctx.set(core.dbg_m_bit_wr_en, 0)
            assert not ctx.get(core.boot_marker_available)
            assert not ctx.get(core.boot_thread_activated)
            assert ctx.get(core.fault) == fault
            return
        assert not ctx.get(core.fault_valid)
        assert ctx.get(core.active_thread_owned)
        assert ctx.get(core.active_thread_slot) == 2
        assert ctx.get(core.imem_addr) == 8
        assert [ctx.get(w) for w in core.debug_cr_words[0]] == [
            words[base + cap_start], words[80] * 4, words[81]]
        assert [ctx.get(w) for w in core.debug_cr_words[12]] == [
            0x02000002 | (config["threadVersion"] << 16), base * 4,
            255 | (config["threadVersion"] << 21)]
        assert [ctx.get(w) for w in core.debug_cr_words[5]] == [
            0x32000002 | (config["threadVersion"] << 16), (base + 18) * 4,
            193 | (config["threadVersion"] << 21)]
        assert ctx.get(core.debug_dr_words[0]) == 0
        assert [ctx.get(w) for w in core.debug_dr_words[1:]] == words[base + 2:base + 17]
        if case == "restore_values":
            assert [ctx.get(w) for w in core.debug_cr_words[1]] == [
                0x12000003, words[12], words[13]]
            assert [ctx.get(w) for w in core.debug_cr_words[2]] == [0x06000001, 0, 0]
            assert [ctx.get(w) for w in core.debug_cr_words[3]] == [0, 0, 0]
            assert ctx.get(core.flags.as_value()) == 0xa
        # Copying the marker to the next ROM address cannot activate again.
        ctx.set(core.imem_fetch_address, 8)
        assert ctx.get(core.fault_valid)
        assert ctx.get(core.fault) == FaultType.INVALID_OP
        assert not ctx.get(core.boot_marker_available)

    sim.add_testbench(bench)
    sim.run()
