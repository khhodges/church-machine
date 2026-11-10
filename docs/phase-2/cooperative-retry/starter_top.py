"""Isolated starter top using retained ChurchCore, ROM, UART and diagnostic.

This bounded diagnostic top is not the production Wukong top. It has no legacy
debug-command parser, auto-recovery or startup memory initializer. Its only
loader write master is StarterLifecycle; the CPU owns RAM only in RUNNING.
No board pin assignment, synthesis, programmer or network operation is here.
"""
from amaranth import (Array, Cat, ClockDomain, ClockSignal, Const, DomainRenamer,
                      Elaboratable, Module, Mux, ResetInserter, ResetSignal, Signal, unsigned)
from amaranth.lib.memory import Memory
from .core import ChurchCore
from .boot_rom import BootRom
from .wukong_top import _WUKONG_ROM, _WUKONG_BOOT_WINDOW_BYTES
from .reset_marker import RESET_MARKER_WORD
from .uart_rx import UartRx
from .uart_tx import UartTx
from .uart_packet_arbiter import UartPacketArbiter
from .request_diagnostic import RequestDiagnostic
from .starter_transport import StarterTransport
from .starter_sha256 import ReceivedImageSHA256

# Pinned retained application binaries, not hashes supplied by the UART sender.
IMAGE_SHA256 = (
    "925fe029a47c8abc80c91ab7df80334d8015cae74fd116f41560174e6478e6d7",
    "c55a7e0158fd2402cc492d43d58c7f376a12edc6ef2eb3c4a9508499d7b6d480")
BOOT_GUARD = (46 << 9) | 419


class StarterTop(Elaboratable):
    def __init__(self, *, clock_hz=25_000_000, baud=57600, sim_mode=False):
        self.clock_hz, self.baud, self.sim_mode = clock_hz, baud, sim_mode
        self.clk = Signal()
        # A physical input, synchronized below. No UART/MMIO assignment.
        self.maintenance_enable = Signal()
        self.uart_rx_pin = Signal(init=1)
        self.uart_tx_pin = Signal(init=1)
        self.transport = StarterTransport(clock_hz=clock_hz)
        self.control = self.transport.control
        self.core = ChurchCore(expected_boot_guard=BOOT_GUARD, watchdog_clock_hz=clock_hz)
        self.verifier = ReceivedImageSHA256()
        self.diagnostic = RequestDiagnostic()
        self.memory_write = Signal()
        self.memory_address = Signal(14)
        self.memory_data = Signal(32)
        self.program_commit = Signal()
        self.admitted_epoch = Signal(32)
        self.admitted_digest = Signal(256)
        self.boots = Signal(32)

    def elaborate(self, platform):
        m = Module()
        m.domains += ClockDomain("sync", reset_less=True)
        m.domains += ClockDomain("execution")
        if not self.sim_mode:
            m.d.comb += ClockSignal("sync").eq(self.clk)
        ctl, core, tr, sha, diag = self.control, self.core, self.transport, self.verifier, self.diagnostic
        m.submodules.transport = tr
        m.submodules.verifier = ResetInserter(ctl.begin_accepted)(sha)
        m.submodules.core = DomainRenamer("execution")(core)
        m.submodules.diagnostic = DomainRenamer("execution")(diag)
        m.d.comb += [
            ClockSignal("execution").eq(ClockSignal("sync")),
            ResetSignal("execution").eq(ctl.execution_reset),
        ]
        enable_meta, enable = Signal(), Signal()
        m.d.sync += [enable_meta.eq(self.maintenance_enable), enable.eq(enable_meta)]
        rx = m.submodules.rx = UartRx(clk_freq=self.clock_hz, baud=self.baud)
        tx = m.submodules.tx = UartTx(clk_freq=self.clock_hz, baud=self.baud)
        arb = UartPacketArbiter(2)
        m.submodules.tx_arbiter = ResetInserter(ctl.begin_accepted)(arb)
        m.d.comb += [
            rx.rx.eq(self.uart_rx_pin), self.uart_tx_pin.eq(tx.tx),
            tr.maintenance.eq(enable), tr.valid.eq(rx.valid & enable),
            tr.byte.eq(rx.data), tr.error.eq(rx.error & enable),
            diag.valid.eq(rx.valid & ~enable & ~ctl.execution_reset),
            diag.byte.eq(rx.data), diag.error.eq(rx.error & ~enable),
            arb.req[0].eq(tr.tx_req), arb.data[0].eq(tr.tx_byte),
            arb.last[0].eq(tr.tx_last), tr.tx_ack.eq(arb.ack[0]),
            arb.req[1].eq(diag.tx_req & ~ctl.execution_reset),
            arb.data[1].eq(diag.tx_byte), arb.last[1].eq(diag.tx_last),
            diag.tx_ack.eq(arb.ack[1]),
            arb.ready.eq(~tx.busy & ~tx.done),
            tx.start.eq(arb.tx_start), tx.data.eq(arb.tx_data),
        ]
        # BEGIN discards execution-owned diagnostic state, including a partial
        # report. Release its TX ownership; the byte already on the wire drains.

        memory = m.submodules.memory = Memory(shape=unsigned(32), depth=16384, init=[])
        rd = memory.read_port()
        fetch = memory.read_port()
        inspect = memory.read_port()
        wr = memory.write_port()
        m.d.comb += [
            rd.addr.eq(Mux(core.ns_rd_en | core.ns_wr_en, core.ns_addr[2:16],
                           Mux(core.clist_rd_en | core.clist_wr_en,
                               core.clist_addr[2:16], core.dmem_addr[2:16]))),
            core.ns_rd_data.eq(Cat(rd.data, Const(0, 96))),
            core.clist_rd_data.eq(rd.data),
            inspect.addr.eq(Mux(ctl.validate_request, sha.address, diag.mem_addr)),
            sha.data.eq(inspect.data), diag.mem_data.eq(inspect.data),
        ]
        verifying = Signal()
        verify_epoch = Signal(32)
        verify_image = Signal()
        m.d.comb += sha.start.eq(ctl.validate_request & ~verifying)
        with m.If(sha.start):
            m.d.sync += [verifying.eq(1), verify_epoch.eq(ctl.epoch), verify_image.eq(tr.image)]
        with m.If(sha.done):
            m.d.sync += verifying.eq(0)
        with m.If(ctl.begin_accepted):
            m.d.sync += verifying.eq(0)
        expected = Array(Const(int(h, 16), 256) for h in IMAGE_SHA256)
        m.d.comb += [
            ctl.validation_valid.eq(sha.done),
            ctl.validation_epoch.eq(verify_epoch),
            ctl.validation_ok.eq((sha.digest == expected[verify_image]) &
                                 (verify_epoch == ctl.epoch) & (verify_image == tr.image)),
        ]
        with m.If(sha.done & ctl.validate_request & ctl.validation_ok & ~ctl.abort):
            m.d.sync += [self.admitted_epoch.eq(verify_epoch), self.admitted_digest.eq(sha.digest)]

        # ROM provenance and synchronous memory settle rule match the retained
        # top. The actual guarded boot validates Namespace and Thread entry state.
        rom_words = list(_WUKONG_ROM)
        rom_words[1] = RESET_MARKER_WORD
        rom = m.submodules.rom = BootRom(rom_words)
        use_memory = Signal()
        previous_address = Signal(32, init=0xFFFFFFFF)
        boot_sent = Signal()
        m.d.execution += [
            use_memory.eq(core.imem_addr >= _WUKONG_BOOT_WINDOW_BYTES),
            previous_address.eq(core.imem_addr),
            core.imem_fetch_address.eq(core.imem_addr),
            boot_sent.eq(1),
        ]
        m.d.comb += [
            rom.addr.eq(core.imem_addr[2:12]), fetch.addr.eq(core.imem_addr[2:16]),
            core.imem_data.eq(Mux(use_memory, fetch.data, rom.data)),
            core.imem_from_reset_rom.eq(~use_memory),
            core.imem_valid.eq(~ctl.execution_reset &
                               (previous_address == core.imem_addr) & ~core.thread_switch_busy),
            core.boot_start.eq(~boot_sent & ~ctl.execution_reset),
            core.halt_req.eq(ctl.execution_reset),
            core.defer_fault_reset.eq(1),
            core.reboot_req.eq(0), core.skip_fault_req.eq(0),
            core.free_run_start.eq(0), core.free_run_nia.eq(0), core.gc_start.eq(0),
        ]
        with m.If(core.boot_start):
            m.d.sync += self.boots.eq(self.boots + 1)

        mmio = core.dmem_addr[30] & ~core.dmem_addr[31]
        read_mmio = core.dmem_rd_en & mmio & ~ctl.execution_reset
        mmio_data = Signal(32)
        with m.Switch(core.dmem_addr):
            with m.Case(0x4000001C):
                m.d.comb += mmio_data.eq(diag.data)
            with m.Case(0x40000020):
                m.d.comb += mmio_data.eq(diag.status)
        mmio_valid, ram_valid = Signal(), Signal()
        mmio_latched = Signal(32)
        m.d.execution += [
            mmio_valid.eq(read_mmio), mmio_latched.eq(mmio_data),
            ram_valid.eq(core.dmem_rd_en & ~mmio),
        ]
        m.d.comb += [
            core.dmem_rd_data.eq(Mux(mmio_valid, mmio_latched, rd.data)),
            core.dmem_rd_valid.eq(mmio_valid | ram_valid),
            diag.claim.eq(read_mmio & (core.dmem_addr == 0x40000020)),
            diag.pop.eq(read_mmio & (core.dmem_addr == 0x4000001C)),
            diag.start.eq(diag.claim), diag.snapshot_complete.eq(1),
            diag.renew.eq(core.sim_watchdog.transition_complete),
            diag.watchdog_fault.eq(core.fault_valid),
            diag.ticks.eq(core.sim_watchdog.remaining),
            diag.write.eq(core.dmem_wr_en & ~ctl.execution_reset &
                          (core.dmem_addr >= 0x5000) & (core.dmem_addr < 0x5100)),
            diag.write_addr.eq(core.dmem_addr), diag.handoff.eq(core.llr_complete),
            diag.retry.eq(core.retire_valid & ~core.fault_valid & (core.retire_nia == 0x4008)),
            diag.retire.eq(core.retire_valid & ~ctl.execution_reset),
            diag.nia.eq(core.retire_nia), diag.cr12.eq(core.debug_cr_words[12][0]),
            diag.dr12.eq(core.debug_dr_words[12]),
        ]
        # Match the retained diagnostic's terminal observation: callee RETURN,
        # not the earlier retried CALL retirement.
        with m.If(core.retire_valid & ~core.fault_valid & (core.retire_nia == 0x500C)):
            m.d.execution += diag.stopped.eq(1)

        # One write port: loader in reset, otherwise CPU arbitration exactly
        # NS > C-list > data. Verifier/observer have read-only ports.
        cpu_write = core.ns_wr_en | core.clist_wr_en | (core.dmem_wr_en & ~mmio)
        m.d.comb += [
            self.program_commit.eq(cpu_write & ctl.program_write_allowed &
                                   ~core.sim_watchdog.block_program_writes),
            wr.en.eq(ctl.memory_write | self.program_commit),
            wr.addr.eq(Mux(ctl.memory_write, ctl.memory_address, rd.addr)),
            wr.data.eq(Mux(ctl.memory_write, ctl.memory_data,
                           Mux(core.ns_wr_en, core.ns_wr_data[:32],
                               Mux(core.clist_wr_en, core.clist_wr_data, core.dmem_wr_data)))),
            self.memory_write.eq(wr.en), self.memory_address.eq(wr.addr),
            self.memory_data.eq(wr.data),
        ]
        return m
