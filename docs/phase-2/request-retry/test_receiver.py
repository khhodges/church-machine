"""Cycle-boundary checks complement serial-pin full-top coverage."""
import pytest
from amaranth.sim import Simulator
from hardware.request_diagnostic import RequestDiagnostic
from protocol import REQUEST, RESPONSE, WORDS


@pytest.mark.parametrize("case", ["partial", "wrong_object", "wrong_crc",
                                  "claim_collision", "claim_error", "claimed",
                                  "before_request", "wrong_length"])
def test_receiver(case):
    rx = RequestDiagnostic()
    sim = Simulator(rx)
    sim.add_clock(1e-6)

    async def bench(ctx):
        ctx.set(rx.tx_ack, 1)
        if case != "before_request":
            ctx.set(rx.start, 1)
            sent = []
            for _ in range(len(REQUEST) + 5):
                if ctx.get(rx.tx_req):
                    sent.append(ctx.get(rx.tx_byte))
                await ctx.tick()
            assert bytes(sent) == REQUEST
            assert ctx.get(rx.request_sent)
        frame = bytearray(RESPONSE)
        if case == "wrong_object":
            frame[4] ^= 1
        elif case == "wrong_crc":
            frame[-1] ^= 1
        elif case == "wrong_length":
            frame[37] ^= 1
        elif case == "partial":
            frame = frame[:-1]
        for byte in frame:
            ctx.set(rx.valid, 1)
            ctx.set(rx.byte, byte)
            await ctx.tick()
        ctx.set(rx.valid, 0)
        assert ctx.get(rx.data) == 0
        if case == "partial":
            await ctx.tick().repeat(100)
            assert ctx.get(rx.status) == 0 and not ctx.get(rx.accepted)
        elif case in ("wrong_object", "wrong_crc", "wrong_length", "before_request"):
            assert ctx.get(rx.failed)
            # Later exact input cannot rearm rejection.
            for byte in RESPONSE:
                ctx.set(rx.valid, 1)
                ctx.set(rx.byte, byte)
                await ctx.tick()
            assert ctx.get(rx.failed) and not ctx.get(rx.accepted)
        elif case in ("claim_collision", "claim_error"):
            ctx.set(rx.claim, 1)
            ctx.set(rx.valid if case == "claim_collision" else rx.error, 1)
            assert ctx.get(rx.status) == 2
            await ctx.tick()
            assert ctx.get(rx.failed) and not ctx.get(rx.accepted)
        else:
            ctx.set(rx.claim, 1)
            await ctx.tick()
            ctx.set(rx.claim, 0)
            ctx.set(rx.valid, 1)
            ctx.set(rx.error, 1)
            ctx.set(rx.byte, 0xFF)
            for value in WORDS:
                assert ctx.get(rx.data) == value
                ctx.set(rx.pop, 1)
                await ctx.tick()
            assert ctx.get(rx.accepted) and not ctx.get(rx.failed)
            assert [ctx.get(word) for word in rx.words] == list(WORDS)
            assert ctx.get(rx.data) == 0
    sim.add_testbench(bench)
    sim.run()
