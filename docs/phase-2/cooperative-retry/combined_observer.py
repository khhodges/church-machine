"""Read-only, periodically snapshotted UART evidence for the combined candidate.

Same big-endian words and CRC-CCITT as UCV3; a distinct version prevents an
older host interpreting the different payload. No RX parser or control outputs.
"""
import hashlib
import json
import struct

from amaranth import Array, Const, Elaboratable, Module, Mux, Signal
from .request_diagnostic import be, crc_step
from .request_protocol import crc

MAGIC = b"UCV4"
FIELDS = ("epoch", "phase", "transaction", "receiver_state", "publications",
          "result_count", "result0", "result1", "result2",
          "pc0", "pc1", "pc2", "progress", "renewals", "fault_seen", "ticks")
REPORT_SIZE = 4 + 4 + 32 + 32 + 4 * len(FIELDS) + 2


def input_identity(records, callers):
    # Includes exact bytes, geometry, caller observation addresses and metadata.
    for row in [*records, *callers]:
        raw = struct.pack("<" + "I" * len(row["words"]), *row["words"])
        if hashlib.sha256(raw).hexdigest() != row["localizedSha256LE"]:
            raise ValueError("observer input digest mismatch")
    return hashlib.sha256(json.dumps([records, callers], sort_keys=True,
                                    separators=(",", ":")).encode()).digest()


def decode_report(frame, *, image_digest, inputs_digest):
    if len(frame) != REPORT_SIZE or frame[:4] != MAGIC:
        raise ValueError("Wrong combined report format")
    if crc(frame[:-2]) != int.from_bytes(frame[-2:], "big"):
        raise ValueError("Report CRC mismatch")
    if frame[8:40].hex() != image_digest or frame[40:72] != inputs_digest:
        raise ValueError("Report input identity mismatch")
    return dict(sequence=int.from_bytes(frame[4:8], "big"),
                **dict(zip(FIELDS, struct.unpack(">16I", frame[72:-2]))))


class CombinedObserver(Elaboratable):
    def __init__(self, records, callers, *, clock_hz):
        if len(callers) != 2:
            raise ValueError("two exact caller records required")
        self.identity = input_identity(records, callers)
        self.callers, self.records, self.clock_hz = callers, records, clock_hz
        self.epoch = Signal(32)
        self.image_digest = Signal(256)
        self.phase, self.transaction, self.receiver_state = Signal(32), Signal(32), Signal(32)
        self.retire, self.fault, self.renew = Signal(), Signal(), Signal()
        self.nia, self.result, self.ticks = Signal(32), Signal(32), Signal(32)
        self.write = Signal()
        self.address, self.data = Signal(32), Signal(32)
        self.tx_req, self.tx_ack, self.tx_last = Signal(), Signal(), Signal()
        self.tx_byte = Signal(8)

    def elaborate(self, platform):
        m = Module()
        count = Signal(2)
        results = Array(Signal(32) for _ in range(3))
        pcs = Array(Signal(32) for _ in range(3))
        publications = Signal(2)
        progress, renewals, fault = Signal(32), Signal(32), Signal(32)
        with m.If(self.fault):
            m.d.sync += fault.eq(1)
        with m.If(self.renew):
            m.d.sync += renewals.eq(renewals + 1)
        with m.If(self.retire & ~self.fault):
            with m.If(self.nia == 0x7008):
                m.d.sync += progress.eq(progress + 1)
            with m.If(((self.nia == self.callers[0]["baseByte"] + 16) |
                       (self.nia == self.callers[1]["baseByte"] + 16)) & (count < 3)):
                m.d.sync += [results[count].eq(self.result), pcs[count].eq(self.nia),
                             count.eq(count + 1)]
        for i, row in enumerate(self.records):
            # Old lazy body publishes header last. New allocation publishes
            # its Namespace integrity word last, after copying the whole body.
            address = row["baseByte"] if i == 0 else row["slot"] * 16 + 8
            value = row["words"][0] if i == 0 else row["descriptor"][2]
            with m.If(self.write & (self.address == address) & (self.data == value)):
                m.d.sync += publications[i].eq(1)

        sources = [self.epoch, self.phase, self.transaction, self.receiver_state,
                   publications, count, *results, *pcs, progress, renewals, fault, self.ticks]
        fields = [Signal(32) for _ in FIELDS]
        digest = Signal(256)
        sequence = Signal(32)
        packet = Array([*(Const(b, 8) for b in MAGIC), *be(sequence),
                        *(digest[i:i+8] for i in range(248, -1, -8)),
                        *(Const(b, 8) for b in self.identity),
                        *(b for field in fields for b in be(field))])
        checksum = Signal(16, init=0xffff)
        index = Signal(range(REPORT_SIZE))
        delay = Signal(range(max(2, self.clock_hz // 4)))
        with m.FSM():
            with m.State("WAIT"):
                with m.If(delay == 0):
                    m.d.sync += [*(f.eq(s) for f, s in zip(fields, sources)),
                                 digest.eq(self.image_digest), sequence.eq(sequence + 1),
                                 checksum.eq(0xffff), index.eq(0)]
                    m.next = "SEND"
                with m.Else():
                    m.d.sync += delay.eq(delay - 1)
            with m.State("SEND"):
                m.d.comb += [
                    self.tx_req.eq(1), self.tx_last.eq(index == REPORT_SIZE - 1),
                    self.tx_byte.eq(Mux(index < REPORT_SIZE - 2, packet[index],
                                       Mux(index == REPORT_SIZE - 2, checksum[8:], checksum[:8])))]
                with m.If(self.tx_ack):
                    with m.If(index < REPORT_SIZE - 2):
                        m.d.sync += checksum.eq(crc_step(m, checksum, self.tx_byte))
                    with m.If(self.tx_last):
                        m.d.sync += delay.eq(self.clock_hz // 4 - 1)
                        m.next = "WAIT"
                    with m.Else():
                        m.d.sync += index.eq(index + 1)
        return m
