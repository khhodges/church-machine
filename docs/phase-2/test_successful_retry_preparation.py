"""Exact synthetic fixture: normal DWRITE publishes availability; no host writes."""
import binascii
import struct
import pytest
from amaranth.sim import Simulator
from hardware.wukong_top import ChurchWukongXC7A100T
from hardware.test_phase2_guarded_llr import guarded_fixture, GUARD, CHANGE_CR1
from hardware.boot_rom import encode_turing
from hardware.hw_types import TuringOpcode, make_gt, GT_TYPE_INFORM, PERM_MASK_W


def successful_retry_fixture():
    mem = guarded_fixture()
    # SYSTEM alone owns an explicit fixture W capability, restored through
    # normal Thread homes. USER's target capability stays E-only.
    mem[0x1000 + (244 + 3) * 4] = make_gt(
        gt_type=GT_TYPE_INFORM, perms=PERM_MASK_W, slot_id=6)
    mem[0x1000 + (7 + 1) * 4] = 0xF8001001
    mem[0x2010] = encode_turing(TuringOpcode.DWRITE, dr_dst=7, dr_src=3, imm=0)
    mem[0x2014] = CHANGE_CR1
    # Prepositioned body, deliberately still unavailable until SYSTEM writes cw.
    mem.update({0x5004: 2, 0x50FC: 0x4A000006,
                0x5008: 0xAF60400D, 0x500C: 0x1F000000})
    assert mem[0x5000] == 0xF8000001
    return mem


@pytest.mark.parametrize("baud", [125000, 62500])
def test_successful_retry_snapshot(baud):
    words = [0] * 16384
    for addr, word in successful_retry_fixture().items():
        words[addr // 4] = word
    top = ChurchWukongXC7A100T(
        sim_mode=True, clk_freq=1000000, baud=baud,
        sim_boot_image_words=words, expected_boot_guard=GUARD,
        diagnostic_retry_return_stop=True)

    async def bench(ctx):
        ctx.set(top.uart_rx_pin, 1)
        core = top.sim_core
        retired, publications, frame = [], [], bytearray()
        handoffs = 0
        for cycle in range(200000):
            assert not ctx.get(core.fault_valid), (
                cycle, hex(ctx.get(core.imem_addr)), ctx.get(core.fault), retired)
            if ctx.get(core.llr_complete):
                handoffs += 1
            if ctx.get(core.retire_valid):
                retired.append(ctx.get(core.retire_nia))
                assert retired[-1] != 0x400C, "caller continuation escaped stop"
            if ctx.get(core.dmem_wr_en) and 0x5000 <= ctx.get(core.dmem_addr) < 0x5100:
                publications.append((ctx.get(core.dmem_addr), ctx.get(core.dmem_wr_data)))
            if ctx.get(top.sim_snapshot_req) and ctx.get(top.sim_snapshot_ack):
                frame.append(ctx.get(top.sim_snapshot_byte))
            if ctx.get(top.sim_snapshot_complete):
                assert handoffs == 1
                assert publications == [(0x5000, 0xF8001001)]
                assert retired == [4, 8, 0x2008, 0x200C, 0x2010, 0x2014,
                                   0x4008, 0x5008, 0x500C]
                assert len(frame) == 292
                assert frame[:4] == bytes.fromhex("ac01011c")
                assert binascii.crc_hqx(frame[:-2], 0xFFFF) == int.from_bytes(frame[-2:], "big")
                p = frame[6:-2]
                assert p[0] == 3
                assert struct.unpack_from(">I", p, 4)[0] == 0x400C
                assert struct.unpack_from(">I", p, 28 + 12 * 12)[0] == 0x02070004
                assert struct.unpack_from(">16I", p, 220)[12] == 13
                for _ in range(100):
                    assert ctx.get(core.imem_addr) == 0x400C
                    assert not ctx.get(core.imem_valid)
                    assert not ctx.get(core.dmem_wr_en)
                    await ctx.tick()
                return
            await ctx.tick()
        pytest.fail(f"Observation limit: handoffs={handoffs}, retired={retired}")

    sim = Simulator(top)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()
