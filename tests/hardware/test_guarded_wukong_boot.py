"""Exact-image full-top reset probe, not an installed-board verification."""
import hashlib
from pathlib import Path
import struct
import pytest

from amaranth.sim import Simulator
from hardware.wukong_top import ChurchWukongXC7A100T
from hardware.test_wukong_upload_fsm import _install_amaranth_elaboration_caches


class KnownContinuationFault(AssertionError):
    """Narrowly identifies the retained image's unresolved full-top failure."""


@pytest.mark.parametrize("verify_uart", [
    False,
    pytest.param(True, marks=pytest.mark.xfail(
        strict=True, raises=KnownContinuationFault,
        reason="INVALID_OP at fetch PC 0x350c before final LOAD trace byte drains")),
])
def test_guarded_full_top_reaches_authored_load(verify_uart):
    image = (Path(__file__).resolve().parents[2] /
             "docs/phase-1/reload-evidence/new-layout-guarded/candidate-le.bin").read_bytes()
    assert hashlib.sha256(image).hexdigest() == (
        "866886bca3670f74e9e5ee3726c26302741d3557b2fef40622ffa9e9ee994879")
    words = struct.unpack("<16384I", image)
    _install_amaranth_elaboration_caches()
    top = ChurchWukongXC7A100T(
        clk_freq=80, baud=10, sim_mode=True, sim_dmem_init=False,
        expected_boot_guard=23971, sim_boot_image_words=words)
    sim = Simulator(top)
    sim.add_clock(1e-6)

    async def bench(ctx):
        core = top.sim_core
        retired = []
        wire = bytearray()
        sample_at = None
        bit = 0
        value = 0
        load_pending = False
        load_committed = False
        for cycle in range(20000):
            if load_pending:
                assert ctx.get(core.debug_cr_words[2][0]) == 0x0200000b
                assert retired == [(4, 0x27000001), (8, 0x17000001),
                                   (0x3508, 0x07130010)]
                load_pending = False
                load_committed = True
                if not verify_uart:
                    return
            if ctx.get(core.fault_valid):
                evidence = (cycle, ctx.get(core.fault), ctx.get(core.imem_addr),
                            ctx.get(core.imem_data), ctx.get(core.imem_valid), retired)
                sources = {name: ctx.get(signal) for name, signal
                           in core.model_fault_sources.items() if ctx.get(signal)}
                await ctx.tick()
                detail = (evidence, "fault stage", ctx.get(core.fault_stage),
                          "latched instruction", hex(ctx.get(core.fault_instr)),
                          "sources", sources, "UART bytes", wire.hex())
                if load_committed and evidence[1:4] == (11, 0x350c, 0x27110000):
                    assert sources == {"change": 1}
                    assert (evidence[3] >> 19) & 15 == 2  # forbidden destination field
                    assert (evidence[3] >> 15) & 15 == 2  # intended source CR2
                    assert evidence[3] & 0x7fff == 0
                    raise KnownContinuationFault(detail)
                raise AssertionError(detail)
            # Decode the physical TX signal at divisor 8; no internal trace
            # queue or byte-accept signal is substituted for UART delivery.
            pin = ctx.get(top.uart_tx_pin)
            if sample_at is None and pin == 0:
                sample_at, bit, value = cycle + 12, 0, 0
            elif sample_at == cycle:
                if bit < 8:
                    value |= pin << bit
                    bit += 1
                    sample_at += 8
                else:
                    assert pin == 1, "UART stop-bit failure"
                    wire.append(value)
                    sample_at = None
                    # Sentinel is four bytes. Subsequent trace frames are 12.
                    if len(wire) >= 4:
                        assert wire[0] == 0xbc
                        frames = [wire[i:i+12] for i in range(4, len(wire)-11, 12)]
                        for frame in frames:
                            assert frame[0] == 0xaa
                            assert not frame[11] & 0x40, bytes(frame).hex()
                        if (frames and load_committed and
                                int.from_bytes(frames[-1][1:5], "big") == 0x3508 and
                                int.from_bytes(frames[-1][6:10], "big") == 0x0200000b):
                            assert {int.from_bytes(f[1:5], "big") for f in frames} == {
                                4, 8, 0x3504, 0x3508}
                            return
            if ctx.get(core.retire_valid):
                retired.append((ctx.get(core.retire_nia), ctx.get(core.retire_instr)))
                if retired[-1][0] == 0x3508:
                    load_pending = True
            await ctx.tick()
        raise AssertionError(("full-top deadline", retired,
                              ctx.get(core.imem_addr), ctx.get(top.step_halted)))

    sim.add_testbench(bench)
    sim.run()


def test_simulation_image_cannot_enter_hardware_build():
    with pytest.raises(ValueError, match="full simulation model"):
        ChurchWukongXC7A100T(sim_boot_image_words=[0] * 16384)
