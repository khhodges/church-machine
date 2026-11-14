import hashlib
import struct
import pytest
from amaranth import Module
from amaranth.sim import Simulator
from candidate_test_support import module

protocol = module("amoeba_protocol")
Memory = module("candidate_memory").CandidateMemory
Delivery = module("candidate_delivery").CandidateDelivery


def record(base=0x12000):
    words = [0xf8000c01, 2, 0xaf084025, 0x18000000] + [0] * 59 + [0x4a00000a]
    return dict(slot=10, sizeWords=64, baseByte=base, words=words,
                localizedSha256LE=hashlib.sha256(struct.pack("<64I", *words)).hexdigest())


@pytest.mark.parametrize("base,valid", [(0x12000, True), (0x1ff00, True),
                                      (0x1ff04, False), (0x20000, False)])
def test_candidate_destination_stays_outside_staging(base, valid):
    args = dict(staging_base=0x20000, staging_words=4096, memory_profile="candidate128")
    if valid:
        protocol.validate_records([record(base)], **args)
    else:
        with pytest.raises(ValueError):
            protocol.validate_records([record(base)], **args)


def test_legacy_profile_does_not_acquire_candidate_memory():
    with pytest.raises(ValueError):
        protocol.validate_records([record()], staging_base=0xa000, staging_words=256)


@pytest.mark.parametrize("corrupt", [False, True])
def test_real_banked_staging_hash_and_no_executable_publication(corrupt):
    r = record()
    m = Module()
    m.submodules.memory = mem = Memory(init=[0xa55aa55a] * 32768)
    m.submodules.delivery = delivery = Delivery(mem, [r], clock_hz=1000)
    rx = delivery.receiver
    m.d.comb += [mem.cpu_enabled.eq(1), rx.tx_ack.eq(rx.tx_req)]
    sim = Simulator(m)
    sim.add_clock(1e-6)

    async def bench(ctx):
        ctx.set(delivery.enabled, 1)
        ctx.set(delivery.epoch, 7)
        await ctx.tick().repeat(3)
        ctx.set(rx.request_slot, 10)
        ctx.set(rx.request, 1)
        await ctx.tick()
        ctx.set(rx.request, 0)
        await ctx.tick().repeat(30)
        txn = ctx.get(rx.transaction)
        commits = []

        async def tick():
            if ctx.get(mem.commit):
                a = ctx.get(mem.commit_address)
                assert 0x20000 <= a < 0x24000
                assert ctx.get(mem.commit_source) == 3
                commits.append(a)
            await ctx.tick()

        async def send(data):
            for b in data:
                ctx.set(rx.byte, b)
                ctx.set(rx.valid, 1)
                await tick()
                ctx.set(rx.valid, 0)
                await tick()
                await tick()

        raw = bytearray(struct.pack("<64I", *r["words"]))
        if corrupt:
            raw[8] ^= 1
        await send(protocol.command(protocol.BEGIN, 10, 7, txn, len(raw)))
        await send(raw)
        await send(protocol.command(protocol.FINISH, 10, 7, txn))
        for _ in range(1500):
            if ctx.get(rx.state) in (rx.READY, rx.FAILED):
                break
            await tick()
        assert ctx.get(rx.state) == (rx.FAILED if corrupt else rx.READY)
        assert commits == list(range(0x20000, 0x20100, 4))
        # Receiver writes never publish target bytes, including low aliases.
        for address in (0x12000, 0x2000):
            ctx.set(mem.fetch.address, address)
            ctx.set(mem.fetch.read, 1)
            await tick()
            assert ctx.get(mem.fetch.rdata) == 0xa55aa55a
        if not corrupt:
            for word in r["words"]:
                await tick()
                assert ctx.get(rx.word) == word
                ctx.set(rx.pop, 1)
                await tick()
                ctx.set(rx.pop, 0)
                await tick()
            ctx.set(rx.commit_transaction, txn)
            ctx.set(rx.commit, 1)
            await tick()
            assert ctx.get(rx.state) == rx.CONSUMED
    sim.add_testbench(bench)
    sim.run()
