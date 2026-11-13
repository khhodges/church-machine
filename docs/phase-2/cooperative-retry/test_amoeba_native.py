"""Combined decoded-byte transport/RAM/SHA/core test, not physical evidence."""
import hashlib
import struct

import pytest
from amaranth import Elaboratable, Module, Signal
from amaranth.sim import Simulator
import hardware.starter_top as starter
from hardware.starter_transport import command as image_command
from hardware.amoeba_protocol import command, BEGIN, FINISH
from hardware.test_phase2_guarded_llr import GUARD
from amoeba_fixture import build


@pytest.mark.parametrize("system_first,corrupt", [(False, False), (False, True), (True, False)])
def test_only_amoeba_resident_user_lazy_delivery(monkeypatch, system_first, corrupt, record_property):
    raw, target, compiled = build(system_first=system_first)
    received = []
    class Bytes(Elaboratable):
        def __init__(self, **kwargs):
            self.rx, self.valid, self.data, self.error = Signal(init=1), Signal(), Signal(8), Signal()
            received.append(self)
        def elaborate(self, platform):
            return Module()
    monkeypatch.setattr(starter, "UartRx", Bytes)
    top = starter.StarterTop(sim_mode=True, general_image=True, boot_guard=GUARD,
        amoeba_records=[target], clock_hz=20000, baud=5000, staging_words=1024)
    sim = Simulator(top)
    sim.add_clock(1e-6)
    async def bench(ctx):
        rx, core, ctl, receiver = received[0], top.core, top.control, top.lump_receiver
        trace, publications = [], []
        control_writes = []
        copied = {}
        handoff = False
        async def tick(check=True):
            nonlocal handoff
            if ctx.get(core.llr_complete):
                handoff = True
            if ctx.get(core.retire_valid):
                trace.append((ctx.get(core.retire_nia), ctx.get(core.debug_dr_words[1])))
            if ctx.get(core.dmem_wr_en) and ctx.get(core.dmem_addr) >= 0x40000000:
                control_writes.append((ctx.get(core.dmem_addr), ctx.get(core.dmem_wr_data),
                                       ctx.get(receiver.state), ctx.get(receiver.consumed)))
            if ctx.get(top.program_commit):
                address = ctx.get(top.memory_address)*4
                value = ctx.get(top.memory_data)
                if target["baseByte"] <= address < target["baseByte"] + target["sizeWords"]*4:
                    copied[address] = value
                    if address == target["baseByte"]:
                        publications.append(value)
                        assert len(copied) == target["sizeWords"]
                        assert [copied[target["baseByte"]+i*4] for i in range(target["sizeWords"])] == target["words"]
            await ctx.tick()
            if check:
                assert not ctx.get(core.fault_valid), (
                    f"fault={ctx.get(core.fault)} nia={ctx.get(core.nia):x} "
                    f"state={ctx.get(receiver.state)} trace={trace[-15:]}")
        async def send(data, check=True, spacing=0):
            ctx.set(rx.valid, 1)
            for b in data:
                ctx.set(rx.data, b)
                await tick(check)
                if spacing:
                    ctx.set(rx.valid, 0)
                    for _ in range(spacing):
                        await tick(check)
                    ctx.set(rx.valid, 1)
            ctx.set(rx.valid, 0)
            await tick(check)
        ctx.set(top.maintenance_enable, 1)
        await ctx.tick().repeat(4)
        await send(image_command(1, 0, 0, 65536, general_image=True))
        await send(hashlib.sha256(raw).digest() + raw)
        await send(image_command(2, 0, 1, general_image=True))
        await ctx.tick().repeat(100000)
        assert ctx.get(ctl.state) == ctl.READY
        await send(image_command(3, 0, 1, general_image=True))
        ctx.set(top.maintenance_enable, 0)
        for _ in range(25000):
            await tick()
            if ctx.get(receiver.state) == receiver.WAITING:
                break
        assert handoff == (not system_first), f"unexpected handoff state: {trace[-20:]}"
        assert ctx.get(receiver.state) == receiver.WAITING, trace[-20:]
        assert not publications and not copied
        # Delayed delivery exercises real SYSTEM self-CHANGE, not host retry.
        for _ in range(2500):
            await tick()
        assert ctx.get(receiver.state) == receiver.WAITING
        payload = bytearray(struct.pack("<"+"I"*target["sizeWords"], *target["words"]))
        if corrupt:
            payload[8] ^= 1
        await send(command(BEGIN, target["slot"], 1, 1, len(payload)), spacing=39)
        await send(payload, spacing=39)
        await send(command(FINISH, target["slot"], 1, 1), spacing=39)
        for _ in range(50000):
            await tick(not corrupt)
            if corrupt and ctx.get(core.fault_valid):
                break
            if not corrupt and ctx.get(receiver.state) == receiver.CONSUMED and ctx.get(core.debug_dr_words[1]) == 37:
                break
        if corrupt:
            assert ctx.get(core.fault_valid)
            assert not publications and not copied
        else:
            assert ctx.get(receiver.state) == receiver.CONSUMED, (
                ctx.get(receiver.state), ctx.get(receiver.consumed), control_writes, trace[-15:])
            assert ctx.get(core.debug_dr_words[1]) == 37, trace[-20:]
            assert publications == [target["words"][0]]
            # Observe the compiled target's RETURN and subsequent USER yield.
            for _ in range(3500):
                await tick()
            assert any(nia == target["baseByte"] + 12 for nia, _ in trace)
            assert ctx.get(receiver.transaction) == 1, "resident target was requested again"
        record_property("amoeba_source_sha256", hashlib.sha256(
            open(__import__("amoeba_fixture").ROOT / "simulator/examples/amoeba_loader.cloomc", "rb").read()).hexdigest())
        record_property("scope", "decoded UART bytes; real RAM SHA, native loading and core; no physical operations")
    sim.add_testbench(bench)
    sim.run()
