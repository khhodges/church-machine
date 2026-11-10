"""Independent hashlib oracle for the received-RAM SHA-256 datapath."""
import hashlib
import struct

import pytest
from amaranth import Module, unsigned
from amaranth.lib.memory import Memory
from amaranth.sim import Simulator
from starter_sha256 import ReceivedImageSHA256


@pytest.mark.parametrize("data", [bytes(64), bytes(range(64)), bytes(range(256)) * 256])
def test_received_ram_digest(data):
    dut = ReceivedImageSHA256(words=len(data) // 4)
    m = Module()
    m.submodules.sha = dut
    mem = m.submodules.memory = Memory(shape=unsigned(32), depth=len(data) // 4,
                                      init=struct.unpack(f"<{len(data)//4}I", data))
    rd = mem.read_port()
    m.d.comb += [rd.addr.eq(dut.address), dut.data.eq(rd.data)]
    sim = Simulator(m)
    sim.add_clock(1e-6)

    async def bench(ctx):
        for _ in range(2):
            ctx.set(dut.start, 1)
            await ctx.tick()
            ctx.set(dut.start, 0)
            for _ in range((len(data) // 64 + 1) * 100 + 10):
                if ctx.get(dut.done):
                    assert ctx.get(dut.digest) == int(hashlib.sha256(data).hexdigest(), 16)
                    break
                await ctx.tick()
            else:
                pytest.fail("RAM verifier did not finish")
            await ctx.tick()
    sim.add_testbench(bench)
    sim.run()
