"""Local CSI3 memory/admission foundation, deliberately not a runnable FPGA top.

Decoded UART bytes enter the real transport; received banked RAM is SHA-checked.
The checked CPU-facing ports are integration seams, not a simulated ChurchCore.
No LUMP receiver or new authority is invented to make this stage runnable.
"""
from amaranth import Array, Const, Elaboratable, Module, Mux, ResetInserter, Signal
from types import SimpleNamespace
from .candidate_memory import CandidateMemory, Port, ALLOCATION_BYTES, STAGING_BYTES
from .starter_transport import StarterTransport
from .starter_sha256 import ReceivedImageSHA256


class CandidateAdmission(Elaboratable):
    def __init__(self, *, clock_hz=25_000_000, trusted_words=()):
        self.trusted_words = tuple(trusted_words)
        if (len({a for a, _ in self.trusted_words}) != len(self.trusted_words) or
                any(type(a) is not int or a % 4 or not 0 <= a < ALLOCATION_BYTES or
                    type(v) is not int or not 0 <= v <= 0xffffffff
                    for a, v in self.trusted_words)):
            raise ValueError("Invalid trusted image words")
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
        # A separate interface prevents the runtime adapter from also driving
        # the physical memory ports owned by this installer.
        self.runtime_allowed = Signal()
        self.runtime_memory = SimpleNamespace(
            inspect=Port("runtime_inspect"), receive=Port("runtime_receive"),
            receiver_enabled=Signal())

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
            mem.receiver_enabled.eq(self.runtime_allowed &
                                    self.runtime_memory.receiver_enabled),
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
        checking, check_phase, checks_ok, hash_ok = Signal(), Signal(), Signal(), Signal()
        check_index = Signal(range(max(2, len(self.trusted_words))))
        check_done, check_match = Signal(), Signal()
        inspection_address = Signal(32)
        validation_done, validation_match = Signal(), Signal()
        if self.trusted_words:
            addresses = Array(Const(a, 32) for a, _ in self.trusted_words)
            values = Array(Const(v, 32) for _, v in self.trusted_words)
            m.d.comb += [
                inspection_address.eq(Mux(checking, addresses[check_index], sha.address << 2)),
                check_match.eq(mem.inspect.rvalid & ~mem.inspect.rerror &
                               (mem.inspect.rdata == values[check_index])),
                check_done.eq(checking & check_phase &
                              (check_index == len(self.trusted_words) - 1)),
                validation_done.eq(check_done),
                validation_match.eq(hash_ok & checks_ok & check_match),
            ]
            with m.If(sha.done & verifying):
                m.d.sync += [checking.eq(1), check_phase.eq(0), check_index.eq(0),
                             checks_ok.eq(1), hash_ok.eq(sha.digest == expected)]
            with m.Elif(checking):
                m.d.sync += check_phase.eq(~check_phase)
                with m.If(check_phase):
                    m.d.sync += checks_ok.eq(checks_ok & check_match)
                    with m.If(check_done):
                        m.d.sync += checking.eq(0)
                    with m.Else():
                        m.d.sync += check_index.eq(check_index + 1)
            with m.If(ctl.begin_accepted):
                m.d.sync += [checking.eq(0), check_phase.eq(0)]
        else:
            m.d.comb += [inspection_address.eq(sha.address << 2),
                         validation_done.eq(sha.done),
                         validation_match.eq(sha.digest == expected)]
        hashing = ctl.validate_request | verifying
        probe_owner = Signal()
        runtime_owner = Signal()
        rt = self.runtime_memory
        runtime_selected = self.runtime_allowed & rt.receiver_enabled
        m.d.comb += [
            self.runtime_allowed.eq(~ctl.execution_reset & ~tr.maintenance &
                                    ~hashing & ~ctl.begin_accepted),
            mem.receive.write.eq(rt.receive.write & runtime_selected),
            mem.receive.address.eq(rt.receive.address),
            mem.receive.wdata.eq(rt.receive.wdata),
            rt.receive.ready.eq(mem.receive.ready & runtime_selected),
            rt.receive.error.eq(mem.receive.error & runtime_selected),
        ]
        m.d.comb += [
            mem.inspect.read.eq(Mux(hashing, 1,
                Mux(runtime_selected, rt.inspect.read, self.probe.read))),
            mem.inspect.write.eq(Mux(hashing, 0,
                Mux(runtime_selected, rt.inspect.write, self.probe.write))),
            mem.inspect.address.eq(Mux(hashing, inspection_address,
                Mux(runtime_selected, rt.inspect.address, self.probe.address))),
            sha.data.eq(mem.inspect.rdata),
            sha.start.eq(ctl.validate_request & ~verifying),
            self.probe.ready.eq(mem.inspect.ready & ~hashing & ~runtime_selected),
            self.probe.error.eq(mem.inspect.error & ~hashing & ~runtime_selected),
            self.probe.rvalid.eq(mem.inspect.rvalid & probe_owner),
            self.probe.rerror.eq(mem.inspect.rerror),
            self.probe.rdata.eq(mem.inspect.rdata),
            rt.inspect.ready.eq(mem.inspect.ready & runtime_selected),
            rt.inspect.error.eq(mem.inspect.error & runtime_selected),
            rt.inspect.rvalid.eq(mem.inspect.rvalid & runtime_owner & runtime_selected),
            rt.inspect.rerror.eq(mem.inspect.rerror & runtime_owner & runtime_selected),
            rt.inspect.rdata.eq(Mux(runtime_owner & runtime_selected,
                                    mem.inspect.rdata, 0)),
            ctl.validation_valid.eq(validation_done & verifying),
            ctl.validation_epoch.eq(verify_epoch),
            ctl.validation_ok.eq(digest_valid & validation_match &
                                 (verify_epoch == ctl.epoch) &
                                 self.staging_ready & ~self.install_error),
        ]
        m.d.sync += [probe_owner.eq(~hashing & ~runtime_selected),
                     runtime_owner.eq(runtime_selected)]
        with m.If(sha.start):
            m.d.sync += [verifying.eq(1), verify_epoch.eq(ctl.epoch),
                         expected.eq(tr.expected_digest), digest_valid.eq(tr.digest_valid)]
        with m.If(validation_done | ctl.begin_accepted):
            m.d.sync += verifying.eq(0)
        with m.If(validation_done & verifying & ctl.validate_request & ctl.validation_ok & ~ctl.abort):
            m.d.sync += [self.admitted_epoch.eq(verify_epoch),
                         self.admitted_digest.eq(sha.digest)]
        with m.If(ctl.abort):
            m.d.sync += [self.admitted_epoch.eq(0), self.admitted_digest.eq(0)]
        return m
