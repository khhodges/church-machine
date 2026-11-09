"""UART pin -> private receiver -> ordinary SYSTEM reads/writes -> USER retry."""
import binascii
import struct

import pytest
from amaranth.sim import Simulator
from hardware.wukong_top import ChurchWukongXC7A100T
from hardware.test_phase2_guarded_llr import guarded_fixture, GUARD, CHANGE_CR1
from hardware.boot_rom import encode_turing
from hardware.integrity32 import integrity32
from hardware.hw_types import (
    TuringOpcode as Op, CondCode, FaultType,
    make_gt, GT_TYPE_INFORM, PERM_MASK_R, PERM_MASK_W,
)
from hardware.uart_retry_receiver import DiagnosticReceiver, FRAME, PAYLOAD_WORDS


OFFSETS = (1, 2, 3, 63, 0)


def uart_retry_fixture(case="success"):
    mem = guarded_fixture()
    # Resident RAM locations use words; device descriptors retain byte addresses.
    base, limit = 0x4000001C, 1
    mem.update({112: base, 116: limit, 120: integrity32(base, limit), 124: 0})
    for reg, slot, rights in (
        (3, 6, PERM_MASK_R if case == "no_write" else PERM_MASK_W),
        (4, 7, PERM_MASK_W if case == "no_read" else PERM_MASK_R),
    ):
        mem[0x1000 + (244 + reg) * 4] = make_gt(
            gt_type=GT_TYPE_INFORM, perms=rights, slot_id=slot)
    for offset in range(1, 64):
        mem[0x5000 + offset * 4] = 0
    # status pending=0, ready=1, rejected=2. No elapsed-time transition.
    program = [
        encode_turing(Op.DREAD, dr_dst=7, dr_src=4, imm=1 << 4),  # 2010
        encode_turing(Op.ISUB, dr_dst=8, dr_src=7, imm=1),
        encode_turing(Op.BRANCH, CondCode.EQ, imm=5),            # ->202C
        encode_turing(Op.ISUB, dr_dst=8, dr_src=7, imm=2),
        encode_turing(Op.BRANCH, CondCode.EQ, imm=2),            # ->2028
        encode_turing(Op.BRANCH, imm=-5),                        # ->2010
        0xF7000000,                                             # hard fault
    ]
    for offset in OFFSETS:
        program += [
            encode_turing(Op.DREAD, dr_dst=7, dr_src=4, imm=0),
            encode_turing(Op.DWRITE, dr_dst=7, dr_src=3, imm=offset << 4),
        ]
    program += [CHANGE_CR1]
    for i, word in enumerate(program):
        mem[0x2010 + i * 4] = word
    return mem


@pytest.mark.parametrize("baud", [125000, 62500])
@pytest.mark.parametrize("case", [
    "success", "delayed", "partial", "malformed", "no_read", "no_write",
    "command_bytes", "excess_before_claim",
])
def test_uart_retry(case, baud):
    words = [0] * 16384
    for addr, word in uart_retry_fixture(case).items():
        words[addr // 4] = word
    top = ChurchWukongXC7A100T(
        sim_mode=True, clk_freq=1000000, baud=baud,
        sim_boot_image_words=words, expected_boot_guard=GUARD,
        diagnostic_retry_return_stop=True, diagnostic_uart_receive=True)
    sim = Simulator(top)
    sim.add_clock(1e-6)
    shared = {"handoffs": 0, "sent": False}

    async def sender(ctx):
        ctx.set(top.uart_rx_pin, 1)
        # Overflow control delivers before boot finishes, so nobody can claim.
        if case != "excess_before_claim":
            while shared["handoffs"] == 0:
                await ctx.tick()
        payload = FRAME
        if case == "partial":
            payload = FRAME[:17]
        elif case == "malformed":
            payload = FRAME[:10] + bytes([FRAME[10] ^ 1]) + FRAME[11:]
        elif case == "command_bytes":
            payload = b"srhfugbq"
        elif case == "excess_before_claim":
            payload = FRAME + b"x"
        for i, byte in enumerate(payload):
            if case == "delayed" and i == 17:
                await ctx.tick().repeat(5000)
            for bit in [0, *((byte >> n) & 1 for n in range(8)), 1]:
                ctx.set(top.uart_rx_pin, bit)
                await ctx.tick().repeat(1000000 // baud)
        ctx.set(top.uart_rx_pin, 1)
        shared["sent"] = True

    async def observer(ctx):
        core = top.sim_core
        retired, writes, frame = [], [], bytearray()
        expected_writes = [(0x5000 + offset * 4, value)
                           for offset, value in zip(OFFSETS, PAYLOAD_WORDS)]
        partial_wait = 0
        # Includes draining poll-loop trace traffic ahead of the snapshot.
        # Observer limit only: no deadline exists in receiver or USER resume.
        for cycle in range(300000):
            if ctx.get(core.llr_complete):
                shared["handoffs"] += 1
            if ctx.get(core.retire_valid) and not ctx.get(core.fault_valid):
                retired.append(ctx.get(core.retire_nia))
                assert retired[-1] != 0x400C
            if ctx.get(core.dmem_wr_en) and 0x5000 <= ctx.get(core.dmem_addr) < 0x5100:
                assert ctx.get(top.sim_diagnostic_rx.accepted)
                writes.append((ctx.get(core.dmem_addr), ctx.get(core.dmem_wr_data)))
                assert writes == expected_writes[:len(writes)]
            if ctx.get(core.fault_valid):
                expected = {
                    "no_read": FaultType.PERM_R, "no_write": FaultType.PERM_W,
                    "malformed": FaultType.INVALID_OP,
                    "command_bytes": FaultType.INVALID_OP,
                    "excess_before_claim": FaultType.INVALID_OP,
                }
                assert case in expected, (case, cycle, ctx.get(core.fault), retired[-15:])
                assert ctx.get(core.fault) == expected[case]
                assert writes == [] and shared["handoffs"] == 1
                assert 0x4008 not in retired and 0x5008 not in retired
                assert ctx.get(core.retire_nia) == (
                    0x2010 if case == "no_read" else
                    0x2030 if case == "no_write" else 0x2028)
                return
            if case == "partial" and shared["sent"]:
                partial_wait += 1
                assert writes == [] and not ctx.get(top.sim_diagnostic_rx.accepted)
                assert not ctx.get(top.sim_diagnostic_rx.failed)
                assert 0x4008 not in retired
                if partial_wait == 5000:
                    assert shared["handoffs"] == 1
                    return
            if ctx.get(top.sim_snapshot_req) and ctx.get(top.sim_snapshot_ack):
                frame.append(ctx.get(top.sim_snapshot_byte))
            if ctx.get(top.sim_snapshot_complete):
                assert case in ("success", "delayed")
                assert writes == expected_writes and shared["handoffs"] == 1
                assert retired.count(0x4008) == 1
                assert retired[-14:] == list(range(0x202C, 0x2058, 4)) + [
                    0x4008, 0x5008, 0x500C]
                assert len(frame) == 292 and frame[:4] == bytes.fromhex("ac01011c")
                assert binascii.crc_hqx(frame[:-2], 0xFFFF) == int.from_bytes(frame[-2:], "big")
                p = frame[6:-2]
                assert p[0] == 3 and struct.unpack_from(">I", p, 4)[0] == 0x400C
                assert struct.unpack_from(">I", p, 28 + 12 * 12)[0] == 0x02070004
                assert struct.unpack_from(">16I", p, 220)[12] == 13
                for _ in range(100):
                    assert not ctx.get(core.imem_valid) and not ctx.get(core.dmem_wr_en)
                    await ctx.tick()
                return
            await ctx.tick()
        rx = top.sim_diagnostic_rx
        pytest.fail(
            f"{case}: observation limit, retired={retired[-15:]}, "
            f"rx_count={ctx.get(rx.count)}, rx_status={ctx.get(rx.status)}, "
            f"accepted={ctx.get(rx.accepted)}, index={ctx.get(rx.index)}")

    sim.add_testbench(sender, background=True)
    sim.add_testbench(observer)
    sim.run()


@pytest.mark.parametrize("case", ["partial", "wrong_length", "wrong_end", "overflow", "claim_collision", "claimed"])
def test_receiver_boundaries(case):
    rx = DiagnosticReceiver()
    sim = Simulator(rx)
    sim.add_clock(1e-6)

    async def bench(ctx):
        payload = FRAME
        if case == "partial":
            payload = FRAME[:-1]
        elif case == "wrong_length":
            payload = FRAME[:5] + b"\x15" + FRAME[6:]
        elif case == "wrong_end":
            payload = FRAME[:-1] + b"?"
        elif case == "overflow":
            payload = FRAME + b"x"
        for byte in payload:
            ctx.set(rx.valid, 1)
            ctx.set(rx.byte, byte)
            await ctx.tick()
        ctx.set(rx.valid, 0)
        assert ctx.get(rx.data) == 0
        if case == "partial":
            await ctx.tick().repeat(1000)
            assert ctx.get(rx.status) == 0 and not ctx.get(rx.accepted)
        elif case in ("wrong_length", "wrong_end", "overflow"):
            assert ctx.get(rx.status) == 2 and not ctx.get(rx.accepted)
        elif case == "claim_collision":
            ctx.set(rx.claim, 1)
            ctx.set(rx.valid, 1)
            ctx.set(rx.byte, 0x72)
            assert ctx.get(rx.status) == 2
            await ctx.tick()
            assert ctx.get(rx.failed) and not ctx.get(rx.accepted)
        else:
            assert ctx.get(rx.status) == 1
            ctx.set(rx.claim, 1)
            await ctx.tick()
            ctx.set(rx.claim, 0)
            # After acceptance, the frame is immutable; extra bytes are ignored.
            ctx.set(rx.valid, 1)
            ctx.set(rx.byte, 0x75)
            for word in PAYLOAD_WORDS:
                assert ctx.get(rx.data) == word
                ctx.set(rx.pop, 1)
                await ctx.tick()
            ctx.set(rx.pop, 0)
            assert ctx.get(rx.data) == 0 and not ctx.get(rx.failed)

    sim.add_testbench(bench)
    sim.run()
