"""Full-top watchdog preflight using real instruction and UART pins.

Includes USER B progress and the SYSTEM self-CHANGE waiting case.
The success tests end at terminal retirement, not at a UART evidence exchange.
"""
import importlib.util
from pathlib import Path
from collections import deque
import pytest

from amaranth import Module
from amaranth.sim import Simulator
from hardware.wukong_top import ChurchWukongXC7A100T
from hardware.hw_types import FaultType
from hardware.boot_rom import encode_turing
from hardware.hw_types import TuringOpcode as Op, CondCode
from hardware.integrity32 import integrity32
from hardware.uart_rx import UartRx
from hardware.request_protocol import REQUEST, RESPONSE, WORDS, OFFSETS

spec = importlib.util.spec_from_file_location(
    "prior_uart_fixture", Path(__file__).resolve().parent.parent /
    "test_uart_retry_preparation.py")
prior = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prior)


def cooperative_fixture(other_user):
    mem = prior.uart_retry_fixture()
    if other_user:
        for slot, base, limit in [(8, 0x6000, 255), (9, 0x7000, 63)]:
            base_word = base // 4
            mem.update({slot * 16: base_word, slot * 16 + 4: limit,
                        slot * 16 + 8: integrity32(base_word, limit),
                        slot * 16 + 12: 0})
        for off in range(256):
            mem[0x6000 + off * 4] = mem.get(0x3000 + off * 4, 0)
        for off in range(64):
            mem[0x7000 + off * 4] = mem.get(0x4000 + off * 4, 0)
        mem[0x6000 + 242 * 4] = 0x4A000009
        mem[0x6000 + 244 * 4] = 0x4A000009
        mem[0x7000 + 62 * 4] = 0x4A000009
        # CHANGE/LLR uses scratch CRs. Reload B through SYSTEM's real C-list
        # after every return, instead of assuming an incoming scratch CR survives.
        mem[0x2000 + 63 * 4] = 0x02000008
        mem[0x7008] = encode_turing(Op.IADD, dr_dst=11, dr_src=11, imm=1)
        mem[0x700C] = prior.CHANGE_CR1
        mem[0x7010] = encode_turing(Op.BRANCH, imm=-2)
    # Status checked only by SYSTEM. Pending USER A is never selected.
    pending_change = 0x27028000 if other_user else 0x27060000
    program = [
        encode_turing(Op.DREAD, dr_dst=7, dr_src=4, imm=1 << 4),
        encode_turing(Op.ISUB, dr_dst=8, dr_src=7, imm=1),
        encode_turing(Op.BRANCH, CondCode.EQ, imm=7),
        encode_turing(Op.ISUB, dr_dst=8, dr_src=7, imm=2),
        encode_turing(Op.BRANCH, CondCode.EQ, imm=4),
        0x072B0010 if other_user else encode_turing(Op.BRANCH, imm=1),
        pending_change,
        encode_turing(Op.BRANCH, imm=-7),
        0xF7000000,
    ]
    for offset in OFFSETS:
        program += [
            encode_turing(Op.DREAD, dr_dst=7, dr_src=4, imm=0),
            encode_turing(Op.DWRITE, dr_dst=7, dr_src=3, imm=offset << 4),
        ]
    program.append(prior.CHANGE_CR1)
    for i, word in enumerate(program):
        mem[0x2010 + i * 4] = word
    return mem


@pytest.mark.parametrize("other_user", [False, True])
def test_delayed_delivery_with_real_changes(other_user, record_property):
    words = [0] * 16384
    for addr, value in cooperative_fixture(other_user).items():
        words[addr // 4] = value
    top = ChurchWukongXC7A100T(
        sim_mode=True, clk_freq=20000, baud=2500,
        sim_boot_image_words=words, expected_boot_guard=prior.GUARD,
        diagnostic_retry_return_stop=True, diagnostic_uart_receive=True,
        diagnostic_uart_request=True)
    module = Module()
    module.submodules.top = top
    monitor = module.submodules.monitor = UartRx(clk_freq=20000, baud=2500)
    module.d.comb += monitor.rx.eq(top.uart_tx_pin)
    sim = Simulator(module)
    sim.add_clock(1 / 20000)

    async def bench(ctx):
        core = top.sim_core
        rx = bytearray()
        pending = deque()
        request_cycle = None
        sent = False
        remaining = 0
        progress = changes = handoffs = retries = 0
        writes = []
        ctx.set(top.uart_rx_pin, 1)
        for cycle in range(180000):
            assert not ctx.get(core.fault_valid), (
                other_user, cycle, hex(ctx.get(core.nia)), ctx.get(core.fault),
                [hex(ctx.get(core.debug_cr_words[i][0])) for i in (1, 5, 12)],
                changes, progress, core.sim_watchdog.period)
            handoffs += ctx.get(core.llr_complete)
            if ctx.get(monitor.valid):
                rx.append(ctx.get(monitor.data))
                if rx.endswith(REQUEST):
                    assert request_cycle is None, "Duplicate request"
                    request_cycle = cycle
            if ctx.get(core.retire_valid):
                nia = ctx.get(core.retire_nia)
                progress += nia == 0x7008
                changes += nia == 0x2028
                retries += nia == 0x4008
                if not sent:
                    assert nia not in (0x4008, 0x5008), "Premature requester resume"
            if ctx.get(core.dmem_wr_en) and 0x5000 <= ctx.get(core.dmem_addr) < 0x5100:
                assert sent
                writes.append((ctx.get(core.dmem_addr), ctx.get(core.dmem_wr_data)))
            if request_cycle is not None and cycle - request_cycle >= 60000 and not sent:
                assert changes >= 2
                assert (progress >= 2) if other_user else progress == 0
                assert handoffs == 1 and retries == 0 and not writes
                for byte in RESPONSE:
                    pending.extend((bit, 8) for bit in
                                   [0, *((byte >> n) & 1 for n in range(8)), 1])
                sent = True
            if remaining == 0 and pending:
                bit, remaining = pending.popleft()
                ctx.set(top.uart_rx_pin, bit)
            if remaining:
                remaining -= 1
            elif not pending:
                ctx.set(top.uart_rx_pin, 1)
            if ctx.get(top.diagnostic_llr_stopped):
                assert retries == handoffs == 1
                assert writes == [(0x5000 + off * 4, word)
                                  for off, word in zip(OFFSETS, WORDS)]
                assert ctx.get(core.debug_dr_words[12]) == 13
                record_property("cooperative_result", {
                    "other_user": other_user, "cycles": cycle,
                    "delay_cycles": 60000, "clock_hz": 20000,
                    "system_pending_changes": changes,
                    "user_b_progress_retirements": progress,
                    "llr_completions": handoffs, "retry_retirements": retries,
                    "writes": writes,
                    "watchdog_remaining": ctx.get(core.sim_watchdog.remaining),
                    "scope": "ends at terminal stop; host observation not qualified",
                })
                return
            await ctx.tick()
        raise AssertionError("Delayed delivery did not reach retry terminal")

    sim.add_testbench(bench)
    sim.run()


def test_unrenewed_system_expires_and_blocks_writes():
    words = [0] * 16384
    for addr, value in prior.uart_retry_fixture().items():
        words[addr // 4] = value
    top = ChurchWukongXC7A100T(
        sim_mode=True, clk_freq=10000, baud=1250,
        sim_boot_image_words=words, expected_boot_guard=prior.GUARD,
        diagnostic_retry_return_stop=True, diagnostic_uart_receive=True,
        diagnostic_uart_request=True)
    sim = Simulator(top)
    sim.add_clock(1 / 10000)

    async def bench(ctx):
        core = top.sim_core
        wdt = core.sim_watchdog
        ctx.set(top.uart_rx_pin, 1)
        renewals = 0
        for cycle in range(30000):
            renewals += ctx.get(core.llr_complete)
            if ctx.get(core.fault_valid):
                assert ctx.get(core.fault) == FaultType.WATCHDOG, (
                    cycle, ctx.get(core.fault), hex(ctx.get(core.nia)))
                assert renewals == 1
                assert ctx.get(wdt.block_program_writes)
                for _ in range(100):
                    assert not ctx.get(core.dmem_wr_en)
                    assert not ctx.get(core.ns_wr_en)
                    assert not ctx.get(core.clist_wr_en)
                    await ctx.tick()
                assert ctx.get(wdt.expired)
                return
            await ctx.tick()
        raise AssertionError("Unrenewed SYSTEM did not expire")

    sim.add_testbench(bench)
    sim.run()
