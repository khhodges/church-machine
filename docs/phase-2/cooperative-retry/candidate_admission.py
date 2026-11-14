"""Local CSI3 memory/admission foundation, deliberately not a runnable FPGA top.

Decoded UART bytes enter the real transport; received banked RAM is SHA-checked.
The checked CPU-facing ports are integration seams, not a simulated ChurchCore.
No LUMP receiver or new authority is invented to make this stage runnable.
"""
from amaranth import Elaboratable, Module, Mux, ResetInserter, Signal
from .candidate_memory import CandidateMemory, Port, ALLOCATION_BYTES, STAGING_BYTES
from .starter_transport import StarterTransport
from .starter_sha256 import ReceivedImageSHA256


class CandidateAdmission(Elaboratable):
    def __init__(self, *, clock_hz=25_000_000):
        self.transport = StarterTransport(clock_hz=clock_hz, general_image=True,
                                          combined_image=True)
        self.control = self.transport.control
        self.memory = CandidateMemory()
        self.sha = ReceivedImageSHA256(words=ALLOCATION_BYTES // 4)
        self.probe = Port("probe")
        self.staging_ready = Signal()
        self.admitted_epoch = Signal(32)
        self.admitted_digest = Signal(256)
        self.install_error = Signal()

    def elaborate(self, platform):
        m = Module()
        tr, ctl, mem, sha = self.transport, self.control, self.memory, self.sha
        m.submodules.transport = tr
        m.submodules.memory = mem
        m.submodules.sha = ResetInserter(ctl.begin_accepted)(sha)
        clear_active = Signal()
        clear_index = Signal(range(STAGING_BYTES // 4))
        m.d.comb += [
            mem.maintenance.eq(ctl.execution_reset),
            mem.cpu_enabled.eq(~ctl.execution_reset),
            # Until Namespace-aware delivery is integrated, no runtime
            # receiver is permitted to write staging through this foundation.
            mem.receiver_enabled.eq(0),
            mem.image.write.eq(ctl.memory_write),
            mem.image.address.eq(ctl.memory_address << 2),
            mem.image.wdata.eq(ctl.memory_data),
            mem.clear.write.eq(clear_active & ~ctl.begin_accepted),
            mem.clear.address.eq(ALLOCATION_BYTES + (clear_index << 2)),
            mem.clear.wdata.eq(0),
            ctl.start_ready.eq(self.staging_ready & ~self.install_error),
        ]
        with m.If(ctl.begin_accepted):
            m.d.sync += [clear_active.eq(1), clear_index.eq(0),
                         self.staging_ready.eq(0), self.install_error.eq(0),
                         self.admitted_epoch.eq(0), self.admitted_digest.eq(0)]
        with m.Elif(mem.clear.ready & mem.clear.write):
            with m.If(mem.clear.error):
                m.d.sync += [self.install_error.eq(1), clear_active.eq(0)]
            with m.Elif(clear_index == STAGING_BYTES // 4 - 1):
                m.d.sync += [clear_active.eq(0), self.staging_ready.eq(1)]
            with m.Else():
                m.d.sync += clear_index.eq(clear_index + 1)
        with m.If(ctl.memory_write & (~mem.image.ready | mem.image.error)):
            m.d.sync += self.install_error.eq(1)

        verifying = Signal()
        verify_epoch = Signal(32)
        expected = Signal(256)
        digest_valid = Signal()
        hashing = ctl.validate_request | verifying
        probe_owner = Signal()
        m.d.comb += [
            mem.inspect.read.eq(Mux(hashing, 1, self.probe.read)),
            mem.inspect.write.eq(Mux(hashing, 0, self.probe.write)),
            mem.inspect.address.eq(Mux(hashing, sha.address << 2, self.probe.address)),
            sha.data.eq(mem.inspect.rdata),
            sha.start.eq(ctl.validate_request & ~verifying),
            self.probe.ready.eq(mem.inspect.ready & ~hashing),
            self.probe.error.eq(mem.inspect.error & ~hashing),
            self.probe.rvalid.eq(mem.inspect.rvalid & probe_owner),
            self.probe.rerror.eq(mem.inspect.rerror),
            self.probe.rdata.eq(mem.inspect.rdata),
            ctl.validation_valid.eq(sha.done & verifying),
            ctl.validation_epoch.eq(verify_epoch),
            ctl.validation_ok.eq(digest_valid & (sha.digest == expected) &
                                 (verify_epoch == ctl.epoch) &
                                 self.staging_ready & ~self.install_error),
        ]
        m.d.sync += probe_owner.eq(~hashing)
        with m.If(sha.start):
            m.d.sync += [verifying.eq(1), verify_epoch.eq(ctl.epoch),
                         expected.eq(tr.expected_digest), digest_valid.eq(tr.digest_valid)]
        with m.If(sha.done | ctl.begin_accepted):
            m.d.sync += verifying.eq(0)
        with m.If(sha.done & verifying & ctl.validate_request & ctl.validation_ok & ~ctl.abort):
            m.d.sync += [self.admitted_epoch.eq(verify_epoch),
                         self.admitted_digest.eq(sha.digest)]
        with m.If(ctl.abort):
            m.d.sync += [self.admitted_epoch.eq(0), self.admitted_digest.eq(0)]
        return m
