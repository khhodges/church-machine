"""RTL regression: the boot sentinel must arrive on the UART TX pin as the
full 4-byte sequence 0xBC N_INIT&0xFF TU_VERSION BUILD_VERSION, both at boot
and after an 'f' (force-retransmit) command.

Guards against the UartTx DONE-gap double-increment bug: UartTx has a
one-cycle DONE state (busy=0, done=1) during which `start` is ignored; any
requester that advances its byte counter on `~busy` alone double-increments
across that cycle and silently skips every other byte.  That bug made the
sentinel come out as 2 wrong bytes (0xBC TU_VERSION), so the bridge never
recognised the board — it looked completely dead over UART.

The test decodes real UART frames off uart_tx_pin (mid-bit sampling), so it
exercises the arbitrator + UartTx handshake end to end, not internal signals.
"""
import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))

from amaranth.sim import Simulator

from hardware.wukong_top import ChurchWukongXC7A100T, WUKONG_BUILD_VERSION


def _boot_and_capture():
    top = ChurchWukongXC7A100T(clk_freq=100, baud=1, sim_mode=True)
    bit = top.clk_freq // top.baud

    boot_bytes = []
    refire_bytes = []
    rx_bytes = boot_bytes  # capture target (switched to refire_bytes later)

    async def uart_capture(ctx):
        while True:
            if ctx.get(top.uart_tx_pin) == 0:
                # start bit — move to middle of data bit 0
                for _ in range(bit + bit // 2):
                    await ctx.tick()
                val = 0
                for b in range(8):
                    val |= (ctx.get(top.uart_tx_pin) & 1) << b
                    for _ in range(bit):
                        await ctx.tick()
                rx_bytes.append(val)
                for _ in range(bit // 2):
                    await ctx.tick()
            else:
                await ctx.tick()

    async def drive(ctx):
        nonlocal rx_bytes
        # Phase A: boot — wait for 4 sentinel bytes.
        for _ in range(30_000):
            await ctx.tick()
            if len(boot_bytes) >= 4:
                break
        # Phase B: send 'f' and collect the re-fired sentinel.  Trace packets
        # may interleave, so collect generously and scan for the 0xBC magic
        # (exactly what the bridge does).
        rx_bytes = refire_bytes
        for level_bits in ([0] + [(0x66 >> b) & 1 for b in range(8)] + [1]):
            ctx.set(top.uart_rx_pin, level_bits)
            for _ in range(bit):
                await ctx.tick()
        for _ in range(60_000):
            await ctx.tick()
            if len(refire_bytes) >= 8:
                break

    sim = Simulator(top)
    sim.add_clock(1e-6)
    sim.add_testbench(drive)
    sim.add_testbench(uart_capture, background=True)
    sim.run()
    return top, boot_bytes, refire_bytes


def _find_sentinel(byte_list, n_init):
    expected = [0xBC, n_init & 0xFF, 0x02, WUKONG_BUILD_VERSION & 0xFF]
    for i in range(len(byte_list) - 3):
        if byte_list[i : i + 4] == expected:
            return True
    return False


def test_boot_sentinel_full_four_bytes_on_tx_pin():
    top, boot_bytes, refire_bytes = _boot_and_capture()
    # N_INIT is len(hw_init_pairs); recover it from the second boot byte only
    # after validating structure — assert magic and known bytes explicitly.
    assert len(boot_bytes) >= 4, f"boot: expected ≥4 UART bytes, got {boot_bytes}"
    assert boot_bytes[0] == 0xBC, (
        f"boot sentinel magic wrong: {[hex(b) for b in boot_bytes[:4]]}")
    n_init = boot_bytes[1]
    assert boot_bytes[2] == 0x02, (
        f"TU_VERSION byte wrong (DONE-gap skip?): {[hex(b) for b in boot_bytes[:4]]}")
    assert boot_bytes[3] == (WUKONG_BUILD_VERSION & 0xFF), (
        f"BUILD_VERSION byte wrong: {[hex(b) for b in boot_bytes[:4]]}")

    assert _find_sentinel(refire_bytes, n_init), (
        f"'f' did not re-fire the full 4-byte sentinel; "
        f"got {[hex(b) for b in refire_bytes]}")
