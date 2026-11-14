"""Checked 128 KiB allocation + 16 KiB staging fabric; no capability authority.

Three synchronous physical read channels, one shared write channel. Explicit
64/64/16 KiB banks avoid power-of-two padding of a triplicated 144 KiB RAM.
Core/MMIO and fault-entry integration is a separate stage: a rejected request
returns error, never a successful zero read or an aliased write.
"""
from amaranth import Array, Const, Elaboratable, Module, Mux, Signal, unsigned
from amaranth.lib.memory import Memory

ALLOCATION_BYTES = 0x20000
STAGING_BYTES = 0x4000
TOTAL_BYTES = ALLOCATION_BYTES + STAGING_BYTES


class Port:
    """Byte addressed, one word per request; ready/error describe this beat.

Requester holds address/operation/data until ready. Reads return one cycle
later on rvalid, with rerror and rdata. Writes commit iff ready and not error.
Simultaneous read+write is malformed. Permission/GT checks belong upstream.
"""
    def __init__(self, name):
        for key, width in (("address", 32), ("wdata", 32), ("rdata", 32),
                           ("read", 1), ("write", 1), ("ready", 1),
                           ("error", 1), ("rvalid", 1), ("rerror", 1)):
            setattr(self, key, Signal(width, name=f"{name}_{key}"))


class CandidateMemory(Elaboratable):
    def __init__(self, *, init=()):
        self.init = tuple(init)
        if (len(self.init) > TOTAL_BYTES // 4 or
                any(type(v) is not int or not 0 <= v <= 0xffffffff for v in self.init)):
            raise ValueError("Invalid initial RAM words")
        self.ns, self.clist, self.data = (Port(n) for n in ("ns", "clist", "data"))
        self.fetch, self.inspect = Port("fetch"), Port("inspect")
        self.image, self.clear, self.receive = (Port(n) for n in ("image", "clear", "receive"))
        self.cpu_enabled = Signal()
        self.receiver_enabled = Signal()
        self.maintenance = Signal()
        self.commit = Signal()
        self.commit_address = Signal(32)
        self.commit_data = Signal(32)
        self.commit_source = Signal(3)

    def elaborate(self, platform):
        m = Module()
        banks = [(0, 0x10000), (0x10000, ALLOCATION_BYTES),
                 (ALLOCATION_BYTES, TOTAL_BYTES)]
        reads, writes = [], []
        for i, (base, end) in enumerate(banks):
            mem = Memory(shape=unsigned(32), depth=(end-base)//4,
                         init=self.init[base//4:end//4])
            m.submodules[f"bank{i}"] = mem
            reads.append([mem.read_port() for _ in range(3)])
            writes.append(mem.write_port())

        def requested(p):
            return p.read | p.write

        def valid(p, lo, hi, read_only=False, write_only=False):
            return ((p.address[:2] == 0) & (p.address >= lo) & (p.address < hi) &
                    ~(p.read & p.write) &
                    (~p.write if read_only else Const(1)) &
                    (~p.read if write_only else Const(1)))

        # Image/clear own the write channel while stopped. CPU NS > C-list >
        # data use the shared access channel while running. Even an invalid
        # higher-priority request is consumed as an error, not bypassed.
        access = Port("access")
        owner = Signal(2)
        cpu_ports = [self.ns, self.clist, self.data]
        prior = Const(0)
        for i, p in enumerate(cpu_ports):
            selected = self.cpu_enabled & ~self.maintenance & ~prior & requested(p)
            with m.If(selected):
                m.d.comb += [access.address.eq(p.address), access.wdata.eq(p.wdata),
                             access.read.eq(p.read), access.write.eq(p.write),
                             p.ready.eq(1), p.error.eq(~valid(p, 0, ALLOCATION_BYTES)),
                             owner.eq(i)]
            prior = prior | requested(p)

        # Read-channel routing. The bank selector is captured alongside its
        # synchronous read, so changing the next address cannot relabel data.
        for channel, p, enabled, hi in (
                (0, access, self.cpu_enabled & ~self.maintenance, ALLOCATION_BYTES),
                (1, self.fetch, self.cpu_enabled & ~self.maintenance, ALLOCATION_BYTES),
                (2, self.inspect, Const(1), TOTAL_BYTES)):
            ok = valid(p, 0, hi, read_only=(channel != 0))
            m.d.comb += [p.ready.eq(enabled & requested(p)), p.error.eq(~ok & p.ready)]
            bank = Signal(2, name=f"read_bank_{channel}")
            m.d.sync += [p.rvalid.eq(p.ready & p.read), p.rerror.eq(p.error)]
            for i, (base, end) in enumerate(banks):
                rd = reads[i][channel]
                hit = (p.address >= base) & (p.address < end)
                m.d.comb += [rd.en.eq(p.ready & p.read & ok & hit),
                             rd.addr.eq((p.address - base) >> 2)]
                with m.If(p.ready & p.read & ok & hit):
                    m.d.sync += bank.eq(i)
            m.d.comb += p.rdata.eq(Mux(p.rvalid & ~p.rerror,
                                      Array(row[channel].data for row in reads)[bank], 0))
        saved_owner = Signal(2)
        m.d.sync += saved_owner.eq(owner)
        for i, p in enumerate(cpu_ports):
            m.d.comb += [p.rvalid.eq(access.rvalid & (saved_owner == i)),
                         p.rerror.eq(access.rerror), p.rdata.eq(access.rdata)]

        write_address, write_data, write_ok = Signal(32), Signal(32), Signal()
        writers = [
            (self.image, self.maintenance, 0, ALLOCATION_BYTES),
            (self.clear, self.maintenance, ALLOCATION_BYTES, TOTAL_BYTES),
            (access, self.cpu_enabled & ~self.maintenance, 0, ALLOCATION_BYTES),
            (self.receive, self.receiver_enabled & ~self.maintenance,
             ALLOCATION_BYTES, TOTAL_BYTES),
        ]
        prior = Const(0)
        for i, (p, enabled, lo, hi) in enumerate(writers):
            # A CPU read occupies its own read channel, not the write port.
            req = p.write if p is access else requested(p)
            selected = enabled & req & ~prior
            ok = valid(p, lo, hi, write_only=(p is not access))
            if p is not access:
                m.d.comb += [p.ready.eq(selected), p.error.eq(selected & ~ok)]
            with m.If(selected):
                m.d.comb += [write_address.eq(p.address), write_data.eq(p.wdata),
                             write_ok.eq(ok & p.write), self.commit_source.eq(i)]
            prior = prior | (enabled & req)
        for i, (base, end) in enumerate(banks):
            wr = writes[i]
            m.d.comb += [
                wr.en.eq(write_ok & (write_address >= base) & (write_address < end)),
                wr.addr.eq((write_address-base) >> 2), wr.data.eq(write_data)]
        m.d.comb += [self.commit.eq(write_ok), self.commit_address.eq(write_address),
                     self.commit_data.eq(write_data)]
        return m
