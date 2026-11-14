"""Bounded report-delivery tracking for the isolated candidate.

The acknowledgement inputs belong to the trusted Home-IDE transport, not
architectural registers. This module does not simulate a successful delivery.
It is optional observation: no output connects to execution admission or faults.
An undelivered report may be replaced by the next report; execution never waits.
"""
from amaranth import Elaboratable, Module, Signal


class AuditGate(Elaboratable):
    IDLE, PENDING, ACKED, FAILED = range(4)

    def __init__(self, *, timeout_cycles):
        if type(timeout_cycles) is not int or timeout_cycles < 2:
            raise ValueError("Audit acknowledgement requires a bounded deadline")
        self.timeout_cycles = timeout_cycles
        self.start, self.enabled = Signal(), Signal()
        self.namespace, self.thread, self.execution = Signal(96), Signal(32), Signal(32)
        self.record_namespace, self.record_thread, self.record_execution = Signal(96), Signal(32), Signal(32)
        self.sequence = Signal(32)
        self.state = Signal(2)
        self.ack_valid, self.ack_failed = Signal(), Signal()
        self.ack_sequence = Signal(32)

    def elaborate(self, platform):
        m = Module()
        remaining = Signal(range(self.timeout_cycles + 1))
        with m.If(self.start):
            with m.If(~self.enabled | (self.sequence == 0xffffffff)):
                m.d.sync += self.state.eq(self.FAILED)
            with m.Else():
                m.d.sync += [
                    self.sequence.eq(self.sequence + 1), self.state.eq(self.PENDING),
                    remaining.eq(self.timeout_cycles),
                    self.record_namespace.eq(self.namespace),
                    self.record_thread.eq(self.thread), self.record_execution.eq(self.execution)]
        with m.Elif(self.state == self.PENDING):
            with m.If(~self.enabled | (remaining == 0)):
                m.d.sync += self.state.eq(self.FAILED)
            with m.Elif(self.ack_valid & (self.ack_sequence == self.sequence)):
                m.d.sync += self.state.eq(self.ACKED)
                with m.If(self.ack_failed):
                    m.d.sync += self.state.eq(self.FAILED)
            with m.Else():
                m.d.sync += remaining.eq(remaining - 1)
        return m
