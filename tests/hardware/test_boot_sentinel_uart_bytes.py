"""RTL regression: the boot sentinel must arrive on the UART TX pin as the
full 4-byte sequence 0xBC N_INIT&0xFF TU_VERSION BUILD_VERSION at boot, after
an explicit 'f', and after an authorized fault recovery.

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
from amaranth.hdl._ast import Operator, SwitchValue
import amaranth.hdl._dsl as _amaranth_dsl
from amaranth.hdl._xfrm import DomainCollector, ValueTransformer
import amaranth.hdl._ir as _amaranth_ir

from hardware.wukong_top import ChurchWukongXC7A100T, WUKONG_BUILD_VERSION
from hardware import wukong_bridge as wb


def _memoize_amaranth_shapes():
    """Apply the generator's safe AST cache before elaborating this full SoC."""
    if getattr(Operator.shape, "_wukong_cached", False):
        return
    original_operator_shape = Operator.shape
    original_switch_shape = SwitchValue.shape
    original_check_rhs = _amaranth_dsl._check_rhs
    original_domain_on_value = DomainCollector.on_value
    original_transform_on_value = ValueTransformer.on_value
    original_collect_signals = _amaranth_ir.Design._collect_used_signals_value

    def cached_operator_shape(self):
        try:
            return self._shape_cache
        except AttributeError:
            self._shape_cache = original_operator_shape(self)
            return self._shape_cache

    def cached_switch_shape(self):
        try:
            return self._shape_cache
        except AttributeError:
            self._shape_cache = original_switch_shape(self)
            return self._shape_cache

    checked_ids = set()
    def cached_check_rhs(value):
        value_id = id(value)
        if value_id in checked_ids:
            return
        checked_ids.add(value_id)
        return original_check_rhs(value)

    def cached_domain_on_value(self, value):
        seen = getattr(self, "_wukong_seen_values", None)
        if seen is None:
            seen = self._wukong_seen_values = set()
        if id(value) in seen:
            return
        seen.add(id(value))
        return original_domain_on_value(self, value)

    def cached_transform_on_value(self, value):
        cache = getattr(self, "_wukong_value_cache", None)
        if cache is None:
            cache = self._wukong_value_cache = {}
        key = id(value)
        if key not in cache:
            cache[key] = original_transform_on_value(self, value)
        return cache[key]

    def cached_collect_signals(self, fragment, value):
        seen = getattr(self, "_wukong_collect_seen", None)
        if seen is None:
            seen = self._wukong_collect_seen = set()
        key = (id(fragment), id(value))
        if key in seen:
            return
        seen.add(key)
        return original_collect_signals(self, fragment, value)

    cached_operator_shape._wukong_cached = True
    Operator.shape = cached_operator_shape
    SwitchValue.shape = cached_switch_shape
    _amaranth_dsl._check_rhs = cached_check_rhs
    DomainCollector.on_value = cached_domain_on_value
    ValueTransformer.on_value = cached_transform_on_value
    _amaranth_ir.Design._collect_used_signals_value = cached_collect_signals


def _boot_and_capture():
    _memoize_amaranth_shapes()
    # Keep a ten-cycle bit period for efficient RTL simulation while preserving
    # real mid-bit UART sampling and the UartTx DONE-state handshake.
    top = ChurchWukongXC7A100T(clk_freq=100, baud=10, sim_mode=True)
    bit = top.clk_freq // top.baud

    boot_bytes = []
    refire_bytes = []
    fault_bytes = []
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

        async def send_uart(byte):
            for level in ([0] + [(byte >> b) & 1 for b in range(8)] + [1]):
                ctx.set(top.uart_rx_pin, level)
                for _ in range(bit):
                    await ctx.tick()

        def snapshot_start():
            header = [wb.SNAPSHOT_MAGIC, wb.SNAPSHOT_VERSION,
                      wb.SNAPSHOT_PAYLOAD_LEN >> 8,
                      wb.SNAPSHOT_PAYLOAD_LEN & 0xFF]
            for offset in range(len(fault_bytes) - len(header) + 1):
                if fault_bytes[offset:offset + len(header)] == header:
                    return offset
            return None

        # Phase A: boot — wait for 4 sentinel bytes.
        for _ in range(8_000):
            await ctx.tick()
            if len(boot_bytes) >= 4:
                break
        # Phase B: send 'f' and collect the re-fired sentinel.  Trace packets
        # may interleave, so collect generously and scan for the 0xBC magic
        # (exactly what the bridge does).
        rx_bytes = refire_bytes
        await send_uart(0x66)
        for _ in range(60_000):
            await ctx.tick()
            # A re-fired sentinel now holds instruction fetch until all four
            # identity bytes leave UART, so no trace bytes need to follow it.
            if len(refire_bytes) >= 4:
                break

        # Phase C: inject a fault into the production top. The CM must remain
        # held while its reason-2 snapshot drains, even if run/step arrive.
        # Only the bridge's post-promotion 'g' authorization may produce the
        # recovered sentinel.
        rx_bytes = fault_bytes
        ctx.set(top.sim_fault_inject, 1)
        snap_start = None
        for _ in range(80_000):
            await ctx.tick()
            snap_start = snapshot_start()
            if snap_start is not None:
                break
        ctx.set(top.sim_fault_inject, 0)

        # These would bypass fail-closed recovery if recovery_hold were absent.
        await send_uart(0x72)  # 'r'
        await send_uart(0x73)  # 's'

        snapshot_len = (
            wb.SNAPSHOT_HEADER_LEN + wb.SNAPSHOT_PAYLOAD_LEN +
            wb.SNAPSHOT_CRC_LEN)
        if snap_start is not None:
            for _ in range(80_000):
                await ctx.tick()
                if len(fault_bytes) >= snap_start + snapshot_len:
                    break

        await send_uart(0x67)  # 'g' — accepted promoted-fault recovery
        for _ in range(60_000):
            await ctx.tick()
            if snap_start is not None:
                snapshot_end = snap_start + snapshot_len
                if len(fault_bytes) >= snapshot_end + 4:
                    break

    sim = Simulator(top)
    sim.add_clock(1e-6)
    sim.add_testbench(drive)
    sim.add_testbench(uart_capture, background=True)
    sim.run()
    return top, boot_bytes, refire_bytes, fault_bytes


def _find_sentinel(byte_list, n_init):
    expected = [0xBC, n_init & 0xFF, 0x02, WUKONG_BUILD_VERSION & 0xFF]
    for i in range(len(byte_list) - 3):
        if byte_list[i : i + 4] == expected:
            return True
    return False


def test_boot_sentinel_full_four_bytes_on_tx_pin():
    top, boot_bytes, refire_bytes, fault_bytes = _boot_and_capture()
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

    expected_refire = [0xBC, n_init & 0xFF, 0x02, WUKONG_BUILD_VERSION & 0xFF]
    assert refire_bytes[:4] == expected_refire, (
        "'f' must emit the full sentinel before restarted execution can use "
        f"UART TX; expected {[hex(b) for b in expected_refire]}, "
        f"got {[hex(b) for b in refire_bytes[:8]]}")

    snapshot_len = (
        wb.SNAPSHOT_HEADER_LEN + wb.SNAPSHOT_PAYLOAD_LEN +
        wb.SNAPSHOT_CRC_LEN)
    snapshot_start = next(
        (i for i in range(len(fault_bytes) - 3)
         if fault_bytes[i:i + 4] == [
             wb.SNAPSHOT_MAGIC, wb.SNAPSHOT_VERSION,
             wb.SNAPSHOT_PAYLOAD_LEN >> 8,
             wb.SNAPSHOT_PAYLOAD_LEN & 0xFF]),
        None)
    assert snapshot_start is not None, (
        f"fault recovery emitted no complete snapshot header: {fault_bytes[:32]}")
    snapshot_end = snapshot_start + snapshot_len
    snapshot = wb.decode_snapshot_frame(
        bytes(fault_bytes[snapshot_start:snapshot_end]))
    assert snapshot['reason'] == wb.FaultRecovery.FAULT_SNAPSHOT_REASON

    # CRC validation above proves the attempted r/s and the recovered sentinel
    # did not preempt or corrupt any byte of the snapshot frame.
    recovered_bytes = bytes(fault_bytes[snapshot_end:snapshot_end + 4])
    recovered = wb.parse_boot_sentinel(recovered_bytes)
    assert recovered is not False
    assert recovered['length'] == wb.SENTINEL_V2_LEN
    assert recovered_bytes == bytes(expected_refire), (
        "authorized fault recovery must emit the complete current sentinel; "
        f"expected {[hex(b) for b in expected_refire]}, "
        f"got {[hex(b) for b in fault_bytes[snapshot_end:snapshot_end + 8]]}")
