"""Isolated memory-to-memory loading diagnostic; no host writes during execution."""
import binascii
import struct

import pytest
from amaranth.sim import Simulator
from hardware.wukong_top import ChurchWukongXC7A100T
from hardware.test_phase2_guarded_llr import guarded_fixture, GUARD, CHANGE_CR1
from hardware.boot_rom import encode_turing
from hardware.integrity32 import integrity32
from hardware.hw_types import (
    TuringOpcode, make_gt, GT_TYPE_INFORM, PERM_MASK_R, PERM_MASK_W, FaultType,
)


# Copy method entry, instructions, and c-list before publishing the header.
COPY_WORDS = [(1, 2), (2, 0xAF60400D), (3, 0x1F000000),
              (63, 0x4A000006), (0, 0xF8001001)]


def copy_retry_fixture(case="success"):
    mem = guarded_fixture()
    base, limit = 0x6000 >> 2, 4
    mem.update({7 * 16: base, 7 * 16 + 4: limit,
                7 * 16 + 8: integrity32(base, limit), 7 * 16 + 12: 0})
    # Rights-negative controls retain valid Inform identities, not NULL tokens.
    for reg, slot, rights in [
        (3, 6, PERM_MASK_R if case == "no_write" else PERM_MASK_W),
        (4, 7, PERM_MASK_W if case == "no_read" else PERM_MASK_R),
    ]:
        mem[0x1000 + (244 + reg) * 4] = make_gt(
            gt_type=GT_TYPE_INFORM, perms=rights, slot_id=slot)
    for offset in range(1, 64):
        mem[0x5000 + offset * 4] = 0
    pc = 0x2010
    for index, (offset, word) in enumerate(COPY_WORDS):
        mem[0x6000 + index * 4] = word
        # Phase-1 addressing: DR0 + magnitude in bits 13:4, not raw imm15.
        mem[pc] = encode_turing(TuringOpcode.DREAD, dr_dst=7, dr_src=4, imm=index << 4)
        mem[pc + 4] = encode_turing(TuringOpcode.DWRITE, dr_dst=7, dr_src=3, imm=offset << 4)
        pc += 8
    mem[pc] = CHANGE_CR1
    assert mem[0x5000] == 0xF8000001
    return mem


@pytest.mark.parametrize("baud", [125000, 62500])
@pytest.mark.parametrize("case", ["success", "no_read", "no_write"])
def test_copy_retry(case, baud):
    words = [0] * 16384
    for address, word in copy_retry_fixture(case).items():
        words[address // 4] = word
    top = ChurchWukongXC7A100T(
        sim_mode=True, clk_freq=1000000, baud=baud,
        sim_boot_image_words=words, expected_boot_guard=GUARD,
        diagnostic_retry_return_stop=True)

    async def bench(ctx):
        ctx.set(top.uart_rx_pin, 1)
        core = top.sim_core
        retired, writes, frame = [], [], bytearray()
        handoffs = 0
        expected_writes = [(0x5000 + offset * 4, word) for offset, word in COPY_WORDS]
        for cycle in range(200000):
            if ctx.get(core.llr_complete):
                handoffs += 1
            # This trace also pulses for fault events; count commits separately.
            if ctx.get(core.retire_valid) and not ctx.get(core.fault_valid):
                retired.append(ctx.get(core.retire_nia))
                assert retired[-1] != 0x400C
            if ctx.get(core.dmem_wr_en):
                addr = ctx.get(core.dmem_addr)
                assert not 0x6000 <= addr < 0x6014, "source changed"
                if 0x5000 <= addr < 0x5100:
                    writes.append((addr, ctx.get(core.dmem_wr_data)))
                    assert writes == expected_writes[:len(writes)]
            if ctx.get(core.fault_valid):
                assert case != "success", (cycle, ctx.get(core.fault), retired)
                expected = FaultType.PERM_R if case == "no_read" else FaultType.PERM_W
                assert ctx.get(core.fault) == expected
                assert ctx.get(core.retire_valid)
                assert ctx.get(core.retire_nia) == (0x2010 if case == "no_read" else 0x2014)
                assert handoffs == 1 and writes == []
                assert retired == [4, 8, 0x2008, 0x200C] + (
                    [0x2010] if case == "no_write" else [])
                return  # observe first hard fault, not subsequent recovery
            if ctx.get(top.sim_snapshot_req) and ctx.get(top.sim_snapshot_ack):
                frame.append(ctx.get(top.sim_snapshot_byte))
            if ctx.get(top.sim_snapshot_complete):
                assert case == "success"
                assert handoffs == 1 and writes == expected_writes
                assert retired == [4, 8, 0x2008, 0x200C] + list(
                    range(0x2010, 0x203C, 4)) + [0x4008, 0x5008, 0x500C]
                assert len(frame) == 292 and frame[:4] == bytes.fromhex("ac01011c")
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
        pytest.fail(f"Observation limit: {case}, handoffs={handoffs}, retired={retired}")

    sim = Simulator(top)
    sim.add_clock(1e-6)
    sim.add_testbench(bench)
    sim.run()
