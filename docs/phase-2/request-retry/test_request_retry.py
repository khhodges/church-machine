"""Exact isolated full-top serial-pin requests, responses, and observations."""
from collections import deque
import importlib.util
from pathlib import Path

import pytest
from amaranth import Module
from amaranth.sim import Simulator
from hardware.uart_rx import UartRx
from hardware.wukong_top import ChurchWukongXC7A100T
from hardware.hw_types import FaultType
from protocol import REQUEST, RESPONSE, WORDS, OFFSETS
from responder import Session

spec = importlib.util.spec_from_file_location(
    "prior_uart_fixture", Path(__file__).resolve().parent.parent / "test_uart_retry_preparation.py")
prior = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prior)


@pytest.mark.parametrize("case,baud", [
    ("success", 125000), ("success", 62500), ("delayed", 125000),
    ("wrong_object", 125000), ("malformed", 125000),
    ("wrong_length", 125000), ("bad_crc", 125000),
    ("partial", 125000), ("no_read", 125000), ("no_write", 125000),
    ("bad_stop", 125000), ("early_response", 125000),
])
def test_full_top(case, baud):
    words = [0] * 16384
    for addr, value in prior.uart_retry_fixture(case).items():
        words[addr // 4] = value
    top = ChurchWukongXC7A100T(
        sim_mode=True, clk_freq=1000000, baud=baud,
        sim_boot_image_words=words, expected_boot_guard=prior.GUARD,
        diagnostic_retry_return_stop=True, diagnostic_uart_receive=True,
        diagnostic_uart_request=True)
    module = Module()
    module.submodules.top = top
    monitor = module.submodules.monitor = UartRx(clk_freq=1000000, baud=baud)
    module.d.comb += monitor.rx.eq(top.uart_tx_pin)
    sim = Simulator(module)
    sim.add_clock(1e-6)
    successful = case in ("success", "delayed")

    async def bench(ctx):
        host = Session(0x91827364)
        pending = deque()
        capture = bytearray()
        writes = []
        retired = []
        requests = 0
        handoffs = 0
        bit_left = 0
        sent_response = False
        wait_partial = 0
        expected_writes = [(0x5000 + offset * 4, value)
                           for offset, value in zip(OFFSETS, WORDS)]

        def enqueue(payload, response=False):
            for i, byte in enumerate(payload):
                if response and case == "delayed" and i == 25:
                    pending.append((1, 5000))
                for bit in [0, *((byte >> n) & 1 for n in range(8)),
                            0 if response and case == "bad_stop" and i == 8 else 1]:
                    pending.append((bit, 1000000 // baud))

        if case == "early_response":
            enqueue(RESPONSE, True)
        ctx.set(top.uart_rx_pin, 1)
        for cycle in range(500000):
            if bit_left == 0 and pending:
                bit, bit_left = pending.popleft()
                ctx.set(top.uart_rx_pin, bit)
            if bit_left:
                bit_left -= 1
            elif not pending:
                ctx.set(top.uart_rx_pin, 1)
            assert not ctx.get(monitor.error), "Device TX framing error"
            if ctx.get(monitor.valid):
                byte = ctx.get(monitor.data)
                capture.append(byte)
                if successful:
                    for payload in host.feed(bytes([byte])):
                        is_response = payload == RESPONSE
                        if is_response:
                            requests += 1
                            assert handoffs == 1 and not writes
                        enqueue(payload, is_response)
                elif not sent_response and capture.endswith(REQUEST):
                    requests += 1
                    assert handoffs == 1 and not writes
                    response = bytearray(RESPONSE)
                    if case == "wrong_object":
                        response[4] ^= 1
                    elif case == "wrong_length":
                        response[37] ^= 1
                    elif case == "malformed":
                        response[40] ^= 1
                    elif case == "bad_crc":
                        response[-1] ^= 1
                    elif case == "partial":
                        response = response[:28]
                    if case != "early_response":
                        enqueue(response, True)
                    sent_response = True
            core = top.sim_core
            if ctx.get(core.llr_complete):
                handoffs += 1
            if ctx.get(core.retire_valid) and not ctx.get(core.fault_valid):
                retired.append(ctx.get(core.retire_nia))
                assert retired[-1] != 0x400C
            if ctx.get(core.dmem_wr_en) and 0x5000 <= ctx.get(core.dmem_addr) < 0x5100:
                assert ctx.get(top.sim_diagnostic_rx.accepted)
                writes.append((ctx.get(core.dmem_addr), ctx.get(core.dmem_wr_data)))
                assert writes == expected_writes[:len(writes)]
            if ctx.get(core.fault_valid):
                assert case not in ("success", "delayed", "partial")
                expected = {"no_read": FaultType.PERM_R, "no_write": FaultType.PERM_W}.get(
                    case, FaultType.INVALID_OP)
                assert ctx.get(core.fault) == expected
                assert not writes and handoffs == 1
                assert 0x4008 not in retired and 0x5008 not in retired
                # SYSTEM's authorized status read can emit its request before
                # software branches to HARDFAULT on an already-failed receiver.
                # Early input must never become accepted data, not suppress TX.
                assert requests == (0 if case == "no_read" else 1)
                if case == "early_response":
                    assert not ctx.get(top.sim_diagnostic_rx.accepted)
                return
            if case == "partial" and sent_response and not pending and bit_left == 0:
                wait_partial += 1
                assert not writes and not ctx.get(top.sim_diagnostic_rx.accepted)
                assert not ctx.get(top.sim_diagnostic_rx.failed)
                if wait_partial == 5000:
                    assert handoffs == requests == 1
                    return
            if host.done:
                assert successful and writes == expected_writes
                assert handoffs == requests == 1
                assert retired[-14:] == list(range(0x202C, 0x2058, 4)) + [0x4008, 0x5008, 0x500C]
                assert host.baseline["write_count"] == host.after["write_count"] == 5
                for _ in range(100):
                    assert not ctx.get(core.imem_valid) and not ctx.get(core.dmem_wr_en)
                    await ctx.tick()
                # Retain real serialized TX evidence for the successful full-top case.
                if case == "success" and baud == 125000:
                    root = Path(__file__).resolve().parents[3] / "generated-artifacts"
                    (root / "request-retry-sim-capture.bin").write_bytes(capture)
                return
            await ctx.tick()
        pytest.fail(f"{case}: observer limit, state={host.state}, requests={requests}, "
                    f"retired={retired[-12:]}, bytes={len(capture)}")

    sim.add_testbench(bench)
    sim.run()
