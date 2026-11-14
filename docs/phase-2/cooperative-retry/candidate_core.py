"""Isolated maintained-core connection; no vendor/board or live-image operations.

This stage exercises RAM and trusted Boot with exact disposable fixtures.
MMIO/peripheral and watchdog/service integration are not silently stubbed.
Unsupported devices or an unexpected bus collision are explicit assertions
and exported stop conditions, never successful zero-result operations.
"""
from amaranth import (Assert, Cat, ClockDomain, ClockSignal, Const, DomainRenamer,
                      Elaboratable, Module, Mux, ResetSignal, Signal)
from hardware.core import ChurchCore
from hardware.boot_rom import BootRom
from hardware.wukong_top import _WUKONG_ROM, _WUKONG_BOOT_WINDOW_BYTES
from hardware.reset_marker import RESET_MARKER_WORD
from hardware.fault_entry import FaultBootBinding
from .candidate_admission import CandidateAdmission
from .candidate_memory import ALLOCATION_BYTES
from .candidate_qualified_delivery import QualifiedDelivery
from .candidate_service import CandidateService


class CandidateCoreBridge(Elaboratable):
    """Connect a one-cycle checked fabric to a trusted, reset-held core."""
    def __init__(self, memory, binding, service=None, *, m_control_recipients=None):
        if binding.memory_bytes != ALLOCATION_BYTES:
            raise ValueError("Candidate requires explicit 128 KiB Boot binding")
        self.memory, self.binding = memory, binding
        self.service = service
        self.core = ChurchCore(expected_boot_guard=binding.boot_guard,
                              fault_boot_binding=binding,
                              checked_memory=True, memory_bytes=ALLOCATION_BYTES,
                              m_control_recipients=m_control_recipients)
        self.held = Signal(init=1)
        self.protocol_error = Signal()
        self.unsupported_mmio = Signal()

    def elaborate(self, platform):
        m = Module()
        m.domains += ClockDomain("candidate_execution")
        m.d.comb += [ClockSignal("candidate_execution").eq(ClockSignal("sync")),
                     ResetSignal("candidate_execution").eq(self.held)]
        core, mem = self.core, self.memory
        m.submodules.core = DomainRenamer("candidate_execution")(core)
        rom_words = list(_WUKONG_ROM)
        rom_words[1] = RESET_MARKER_WORD
        m.submodules.rom = rom = BootRom(rom_words)
        boot_sent = Signal()
        previous = Signal(32, init=0xffffffff)
        rom_selected = Signal()
        active = ~self.held & ~core.fault_catastrophic
        rom_address = core.imem_addr < _WUKONG_BOOT_WINDOW_BYTES
        m.d.candidate_execution += [
            boot_sent.eq(1), previous.eq(core.imem_addr), rom_selected.eq(rom_address)]
        m.d.comb += [
            core.boot_start.eq(active & ~boot_sent),
            core.halt_req.eq(self.held),
            core.defer_fault_reset.eq(1),
            rom.addr.eq(core.imem_addr[2:12]),
            mem.fetch.address.eq(core.imem_addr),
            mem.fetch.read.eq(active & ~rom_address),
            core.imem_data.eq(Mux(rom_selected, rom.data, mem.fetch.rdata)),
            core.imem_from_reset_rom.eq(rom_selected),
            core.imem_fetch_address.eq(previous),
            core.imem_valid.eq(active & ~core.fault_entry_active & (previous == core.imem_addr) &
                (core.imem_addr[:2] == 0) &
                (rom_selected | (mem.fetch.rvalid & ~mem.fetch.rerror))),
        ]
        requests, rejected = [], []
        mmio_address = core.dmem_addr[30:32] == 1
        for p, address, read, write, data in (
                (mem.ns, core.ns_addr, core.ns_rd_en, core.ns_wr_en, core.ns_wr_data[:32]),
                (mem.clist, core.clist_addr, core.clist_rd_en, core.clist_wr_en, core.clist_wr_data),
                (mem.data, core.dmem_addr, core.dmem_rd_en, core.dmem_wr_en, core.dmem_wr_data)):
            ram = ~mmio_address if p is mem.data else Const(1)
            m.d.comb += [p.address.eq(address), p.read.eq(active & read & ram),
                          p.write.eq(active & write & ram), p.wdata.eq(data)]
            requests.append((read | write) & active)
            rejected.append(p.ready & p.error)
        mmio = mmio_address & requests[2]
        service_read, service_valid, service_grant, service_error = (
            Signal(32), Signal(), Signal(), Signal())
        if self.service is not None:
            m.submodules.service = svc = self.service
            p = svc.bus
            m.d.comb += [
                svc.enabled.eq(active & ~core.fault_entry_active &
                               self.memory.cpu_enabled & ~self.memory.maintenance),
                svc.namespace.eq(Cat(*core.debug_cr_words[15][:3])),
                svc.thread.eq(core.debug_cr_words[12][0]),
                svc.execution.eq(core.debug_cr_words[14][0]),
                svc.report_start.eq(core.retire_valid & ~core.retire_fault_valid &
                                    (core.retire_instr[27:32] == 5)),
                p.address.eq(core.dmem_addr), p.wdata.eq(core.device_write_data),
                p.read.eq(mmio & core.dmem_rd_en),
                p.write.eq(mmio & core.dmem_wr_en & core.device_write_request),
                service_read.eq(p.rdata), service_valid.eq(p.rvalid & ~p.rerror),
                service_grant.eq(p.ready & p.write & ~p.error),
                service_error.eq((p.ready & p.error) |
                    (mmio & core.dmem_wr_en & ~core.device_write_request)),
            ]
            m.d.sync += svc.delivery.fault.eq(
                active & core.fault_valid & ~core.fault_entry_active)
            with m.If(active & core.fault_valid & ~core.fault_entry_active):
                m.d.sync += [
                    svc.delivery.fault_namespace.eq(Cat(*core.debug_cr_words[15][:3])),
                    svc.delivery.fault_thread.eq(core.debug_cr_words[12][0]),
                ]
        m.d.comb += [
            self.unsupported_mmio.eq(mmio if self.service is None else 0),
            self.protocol_error.eq(
                (requests[0] & ~mem.ns.ready) |
                (requests[1] & ~mem.clist.ready) |
                 (requests[2] & ~mmio & ~mem.data.ready)),
            core.memory_reject.eq(active & ~core.fault_entry_active &
                (service_error | (~mmio &
                (rejected[0] | rejected[1] | rejected[2] |
                  mem.fetch.error | (rom_address & (core.imem_addr[:2] != 0)))))),
            core.ns_rd_data.eq(Cat(mem.ns.rdata, Const(0, 96))),
            core.clist_rd_data.eq(mem.clist.rdata),
            core.dmem_rd_data.eq(Mux(service_valid, service_read, mem.data.rdata)),
            core.dmem_rd_valid.eq(service_valid | (mem.data.rvalid & ~mem.data.rerror)),
            core.dmem_write_granted.eq(service_grant | (mem.data.write & mem.data.ready & ~mem.data.error &
                                       mem.commit & (mem.commit_source == 2))),
            # Evidence is already directly stashed by the core. No external
            # diagnostic receiver is allowed to keep the local recovery held.
            core.fault_evidence_captured.eq(core.fault_evidence_ready),
        ]
        # Acceptance is sampled at the commit edge, not during combinational
        # delta settling after reset/owner changes.
        m.d.sync += [Assert(~self.unsupported_mmio), Assert(~self.protocol_error)]
        # This fabric has no posted writes: accepted writes commit at the
        # edge, before the next recovery phase. Do not invent a pending-write
        # cycle after that edge: it would falsely revoke ownership while
        # FaultStash verifies its own just-completed store.
        # Ownership is independent of the requests that FaultEntry gates with
        # this signal. In this fabric maintenance excludes CPU service, CPU
        # stores precede the staging receiver, and no writes are posted.
        # FaultEntry's core mux owns the CPU lanes during stashing. Individual
        # denied operations still fail via the real grant/response interface.
        m.d.comb += core.fault_memory_safe.eq(
            active & mem.cpu_enabled & ~mem.maintenance)
        return m


class CandidateCoreTop(Elaboratable):
    """CSI3 admission + checked RAM + core, with fixed trusted foundational words.

The prepared image derives the binding; compatible later images may change
other contents. Actual received Boot descriptors/header must still match.
This does not authenticate the image sender or bypass normal guarded boot.
"""
    def __init__(self, words, binding, *, clock_hz=25_000_000, delivery_records=None):
        checked = FaultBootBinding.from_image(
            words, namespace=binding.namespace, thread_gt=binding.thread & 0xffffffff,
            image_sha256=binding.image_sha256, resident_words=binding.resident_words,
            boot_guard=binding.boot_guard, memory_bytes=ALLOCATION_BYTES)
        if checked != binding:
            raise ValueError("Unverified trusted Boot binding")
        self.admission = CandidateAdmission(clock_hz=clock_hz, trusted_words=binding.checks)
        self.delivery = (QualifiedDelivery(self.admission.runtime_memory,
                         delivery_records, clock_hz=clock_hz)
                         if delivery_records is not None else None)
        self.service = CandidateService(self.delivery) if self.delivery is not None else None
        self.bridge = CandidateCoreBridge(self.admission.memory, binding, self.service)
        self.core = self.bridge.core

    def elaborate(self, platform):
        m = Module()
        m.submodules.admission = self.admission
        m.submodules.bridge = self.bridge
        m.d.comb += self.bridge.held.eq(self.admission.control.execution_reset)
        if self.delivery is not None:
            m.submodules.delivery = d = self.delivery
            m.d.comb += [d.enabled.eq(self.admission.runtime_allowed),
                         d.epoch.eq(self.admission.admitted_epoch)]
        return m
