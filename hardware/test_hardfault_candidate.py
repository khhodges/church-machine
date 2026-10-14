"""Isolated elaborated-RTL evidence, not approval or physical-board acceptance."""
import pytest
import json
from pathlib import Path
import subprocess
from amaranth.sim import Simulator
from hardware.core import ChurchCore
from hardware.decoder import ChurchDecoder
from hardware.hw_types import FaultType
from hardware.sim_boot_helpers import boot_core

CANDIDATE = 0xF7000000


@pytest.mark.parametrize("iot", [False, True])
def test_candidate_decoder(iot):
    dut = ChurchDecoder(iot_profile=iot)

    async def bench(ctx):
        ctx.set(dut.instr_valid, 1)
        # WORD is data in RTL regardless of its payload/condition-shaped bits.
        for condition in range(16):
            ctx.set(dut.instruction, 0xF0000000 | (condition << 23))
            assert ctx.get(dut.fault_valid)
            assert ctx.get(dut.fault) == FaultType.INVALID_OP
        ctx.set(dut.instruction, CANDIDATE)
        assert ctx.get(dut.fault_valid)

    sim = Simulator(dut)
    sim.add_testbench(bench)
    sim.run()


@pytest.mark.parametrize("negative", [False, True])
def test_candidate_full_wukong_snapshot_path(monkeypatch, negative):
    """Real boot/fetch/recovery/serializer/UART, then real bridge and IDE readers.

    Only the installed test LUMP is substituted. No injected fault, forced
    fetch gate, reset, or replacement recovery/serializer logic is used.
    """
    from hardware import wukong_top as w
    from hardware import wukong_bridge as bridge
    from hardware.test_wukong_upload_fsm import _install_amaranth_elaboration_caches

    _install_amaranth_elaboration_caches()
    # Ordinary boot CALL method 0 enters +2 via the real method-table prefix.
    image = list(w.WUKONG_CAPABILITY_TEST_IMAGE_WORDS)
    assert image and image[1] == 2
    program = [0xAF004000 | (i << 19) | i for i in range(1, 16)]
    program += [0xB7084000 | int(negative), CANDIDATE, 0xAF10402A]
    image[2:2 + len(program)] = program
    monkeypatch.setattr(w, "WUKONG_CAPABILITY_TEST_IMAGE_WORDS", tuple(image))
    base = w.WUKONG_CAPABILITY_TEST_BASE_WORD * 4
    origin = base + (2 + len(program) - 2) * 4
    observed = {}

    # Retain references to production submodules; their RTL is unmodified.
    def capture(name, constructor):
        def make(*args, **kwargs):
            obj = constructor(*args, **kwargs)
            observed[name] = obj
            return obj
        return make

    monkeypatch.setattr(w, "ChurchCore", capture("core", w.ChurchCore))
    top = w.ChurchWukongXC7A100T(clk_freq=4, baud=1, sim_mode=True)
    sim = Simulator(top)
    sim.add_clock(1e-6)
    core = observed["core"]
    wire = bytearray()
    result = {}
    done = False

    async def uart_reader(ctx):
        # Decode physical TX 8N1 bits, not serializer data/ack shortcuts.
        while not done:
            if ctx.get(top.uart_tx_pin):
                await ctx.tick()
                continue
            for _ in range(6):  # centre of data bit zero, divisor=4
                await ctx.tick()
            value = 0
            for bit in range(8):
                value |= ctx.get(top.uart_tx_pin) << bit
                for _ in range(4):
                    await ctx.tick()
            assert ctx.get(top.uart_tx_pin) == 1, "UART stop bit"
            wire.append(value)
            for _ in range(2):
                await ctx.tick()

    def state(ctx):
        return {
            "cr": [[ctx.get(word) for word in row] for row in core.debug_cr_words],
            "dr": [ctx.get(word) for word in core.debug_dr_words],
            "flags": ctx.get(core.flags.as_value()),
            "m": ctx.get(core.dbg_m_bit_state),
            "isolated": ctx.get(core.debug_isolated_m_flags),
            "nia": ctx.get(core.nia),
        }

    async def bench(ctx):
        nonlocal done
        retired = []
        before = None
        fault_cycle = None
        for cycle in range(100000):
            if ctx.get(core.retire_valid):
                retired.append(ctx.get(core.retire_nia))
            if ctx.get(core.retire_fault_valid):
                assert before is None, "only one fault retirement"
                assert ctx.get(core.retire_nia) == origin
                assert ctx.get(core.retire_instr) == CANDIDATE
                assert ctx.get(core.retire_fault_code) == FaultType.INVALID_OP
                before = state(ctx)
                fault_cycle = cycle
                assert before["cr"][14][1] == base + 4
                assert before["cr"][14][0] != 0
                assert ctx.get(core.fault_cr14) == 0, "placeholder is NOT CR14"
                assert before["dr"][2:16] == list(range(2, 16))
                assert before["dr"][1] == (0xFFFFFFFF if negative else 0)
                assert ctx.get(core.flags.N) == int(negative)
                assert ctx.get(core.flags.Z) == int(not negative)
                assert all(nia in retired for nia in (0, 4, 8))
                assert all(base + i * 4 in retired for i in range(2, 18))
            elif before is not None:
                assert not ctx.get(core.imem_valid), "top must suppress fetch itself"
                assert not ctx.get(core.retire_valid)
                assert state(ctx) == before
                assert ctx.get(core.fault_instr) == CANDIDATE
                assert ctx.get(core.fault_stage) == 1
                assert not ctx.get(core.dmem_wr_en)
                assert not ctx.get(core.ns_wr_en)
                assert not ctx.get(core.clist_wr_en)
                # Parse only a complete, CRC-valid reason-2 wire frame.
                for start, value in enumerate(wire):
                    if value != bridge.SNAPSHOT_MAGIC:
                        continue
                    parsed = bridge.try_parse_snapshot_frame(wire, start)
                    if isinstance(parsed, dict) and parsed["reason"] == 2:
                        result.update(snapshot=parsed, before=before,
                                      retired=retired, held=cycle - fault_cycle)
                        done = True
                        return
            await ctx.tick()
        done = True
        pytest.fail(f"no complete fault snapshot; nia={ctx.get(core.nia):#x}, "
                    f"fault={ctx.get(core.fault)}, wire={wire.hex()}")

    sim.add_testbench(bench)
    sim.add_testbench(uart_reader)
    sim.run()
    snapshot, before = result["snapshot"], result["before"]
    assert result["held"] > 1000, "retain state throughout serialized delivery"
    assert origin + 4 not in result["retired"], "following DR2 write never executes"
    assert snapshot["nia"] == origin
    assert snapshot["cr"] == before["cr"]
    assert snapshot["dr"] == before["dr"]
    # Core Flags layout is N,Z,C,V at bits 0..3; wire is NZCV bits 3..0.
    assert snapshot["flags"] == sum(
        ((before["flags"] >> i) & 1) << (3 - i) for i in range(4))
    assert snapshot["crc_valid"]
    traces = []
    for i in range(len(wire) - bridge.TRACE_LEN + 1):
        if wire[i] == bridge.TRACE_MAGIC:
            trace = bridge.decode_trace_packet(wire[i:i + bridge.TRACE_LEN])
            if trace["fault_valid"] and trace["nia"] == origin:
                traces.append(trace)
    assert len(traces) == 1
    trace = traces[0]
    assert trace["fault_code"] == FaultType.INVALID_OP
    assert trace["flags"] & 15 == snapshot["flags"]
    # No transport field supplies an exact installed-artifact identity or code
    # bytes. Do not promote the test fixture/current catalog to historical proof.
    assert "executionArtifact" not in snapshot
    recovery = bridge.FaultRecovery()
    recovery.prepare_trace(trace, "simulation-only")
    recovery.note_trace(trace, 1, "simulation-server")
    payload = recovery.snapshot_payload(snapshot)
    assert payload["fault_trace_seq"] == 1
    subprocess.run(
        ["node", "simulator/test_hardfault_wukong_snapshot.js"],
        input=json.dumps({"snapshot": payload, "trace": trace,
                          "base": base, "origin": origin}),
        text=True, check=True, cwd=Path(__file__).resolve().parents[1])


@pytest.mark.parametrize("iot", [False, True])
@pytest.mark.parametrize("deferred", [False, True])
@pytest.mark.parametrize("negative", [False, True])
def test_candidate_core_capture_and_stop(iot, deferred, negative):
    dut = ChurchCore(iot_profile=iot)

    async def bench(ctx):
        ctx.set(dut.defer_fault_reset, int(deferred))
        await boot_core(ctx, dut)
        # Execute real arithmetic to seed DRs/flags and leave the 3-retirement
        # boot window. No debug writes overlap the candidate instruction.
        for index in range(1, 16):
            ctx.set(dut.imem_data, 0xAF004000 | (index << 19) | index)
            ctx.set(dut.imem_valid, 1)
            assert not ctx.get(dut.fault_valid)
            await ctx.tick()
            ctx.set(dut.imem_valid, 0)
            await ctx.tick()  # arithmetic unit's one-cycle busy/writeback stall
        for index in range(1, 16):
            assert ctx.get(dut.debug_dr_words[index]) == index
        # ISUB DR1, DR0, #0/#1: establish nonzero Z or N flags.
        ctx.set(dut.imem_data, 0xB7084000 | int(negative))
        ctx.set(dut.imem_valid, 1)
        assert ctx.get(dut.retire_valid)
        await ctx.tick()
        ctx.set(dut.imem_valid, 0)
        await ctx.tick()
        assert ctx.get(dut.flags.N) == int(negative)
        assert ctx.get(dut.flags.Z) == int(not negative)
        for index in range(12):
            ctx.set(dut.dbg_cr_wr_addr, index)
            ctx.set(dut.dbg_cr_wr_data.as_value(),
                    (0x08000000 | index) |
                    ((0x1000 + index * 16) << 32) |
                    ((0x123 + index) << 64))
            ctx.set(dut.dbg_cr_wr_en, 1)
            await ctx.tick()
        ctx.set(dut.dbg_cr_wr_en, 0)

        def state():
            return (
                tuple(tuple(ctx.get(w) for w in row) for row in dut.debug_cr_words),
                tuple(ctx.get(w) for w in dut.debug_dr_words),
                ctx.get(dut.flags.as_value()), ctx.get(dut.dbg_m_bit_state),
                ctx.get(dut.debug_isolated_m_flags),
            )

        before = state()
        origin = ctx.get(dut.nia)
        assert origin == 64, "fixture has retired 16 instructions (byte-addressed NIA)"
        ctx.set(dut.imem_data, CANDIDATE)
        ctx.set(dut.imem_valid, 1)
        assert ctx.get(dut.fault_valid)
        assert ctx.get(dut.fault) == FaultType.INVALID_OP
        assert ctx.get(dut.retire_fault_valid)
        assert ctx.get(dut.retire_nia) == origin
        assert ctx.get(dut.retire_instr) == CANDIDATE
        assert ctx.get(dut.retire_flags.as_value()) == before[2]
        assert state() == before
        assert not ctx.get(dut.dmem_wr_en)
        assert not ctx.get(dut.ns_wr_en)
        assert not ctx.get(dut.clist_wr_en)
        await ctx.tick()
        # Model the integration fetch gate, NOT an intrinsic core halt latch.
        ctx.set(dut.imem_valid, 0)
        assert ctx.get(dut.fault_instr) == CANDIDATE
        assert ctx.get(dut.fault_stage) == 1
        assert state() == before, "fault edge must preserve the pre-fault register bank"
        if deferred:
            for _ in range(20):
                assert ctx.get(dut.nia) == origin
                assert state() == before
                assert not ctx.get(dut.dmem_wr_en)
                assert not ctx.get(dut.ns_wr_en)
                assert not ctx.get(dut.clist_wr_en)
                await ctx.tick()
        else:
            assert ctx.get(dut.nia) == 0, "default integration resets, it does not return"
            await ctx.tick()
            assert state() != before, "pre-fault preservation is not post-reset preservation"

    sim = Simulator(dut)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()
