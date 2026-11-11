"""Isolated Wukong V3 board wrapper; no production-top modifications."""
from amaranth import Elaboratable, Module, Signal
from .starter_top import StarterTop
from .wukong_top import WukongClock25


class CombinedStarterBoard(Elaboratable):
    """M21 50 MHz -> retained MMCM 25 MHz; M6 pressed-low = maintenance.

    M6 has no reset or scheduler connection in this experimental design.
    StarterTop synchronizes maintenance; no toggle, latch or timer exemption.
    sim_mode bypasses vendor clock primitives for local wrapper tests only.
    """

    def __init__(self, records, *, sim_mode=False, simulation_clock_hz=20_000):
        if len(records) != 4:
            raise ValueError("Expected old, old-caller, new, new-caller records")
        old, old_caller, new, new_caller = records
        self.sim_mode = sim_mode
        self.clk = Signal()
        self.maintenance_n = Signal(init=1)
        self.uart_rx_pin = Signal(init=1)
        self.uart_tx_pin = Signal(init=1)
        self.runtime = StarterTop(
            clock_hz=simulation_clock_hz if sim_mode else 25_000_000,
            baud=5_000 if sim_mode else 57_600,
            sim_mode=sim_mode, lump_records=[old, new],
            caller_records=[old_caller, new_caller])

    def elaborate(self, platform):
        m = Module()
        m.submodules.runtime = self.runtime
        if not self.sim_mode:
            clock = m.submodules.clock25 = WukongClock25()
            m.d.comb += [clock.clk_in.eq(self.clk),
                         self.runtime.clk.eq(clock.clk_out)]
        m.d.comb += [
            self.runtime.maintenance_enable.eq(~self.maintenance_n),
            self.runtime.uart_rx_pin.eq(self.uart_rx_pin),
            self.uart_tx_pin.eq(self.runtime.uart_tx_pin),
        ]
        return m

    def ports(self):
        return [self.clk, self.maintenance_n, self.uart_rx_pin, self.uart_tx_pin]
