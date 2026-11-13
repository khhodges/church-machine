"""Maintenance-selected CSI1 transport. No raw command grants or host PASS.

Header: magic(4), operation(1), image(1), reserved-zero(2), epoch BE(4),
length BE(4). BEGIN=1, FINISH=2, START=3, ABORT=4. BEGIN's epoch names
the current epoch; acceptance increments it. Other operations name the new
epoch. BEGIN is followed by exactly 65536 raw little-endian image bytes.
"""
from amaranth import Array, Cat, Const, Elaboratable, Module, Signal
from .starter_lifecycle import StarterLifecycle

MAGIC = b"CSI1"
IMAGE_BYTES = 65536


def command(op, image, epoch, length=0, *, general_image=False):
    magic = b"CSI2" if general_image else MAGIC
    return magic + bytes((op, image, 0, 0)) + epoch.to_bytes(4, "big") + length.to_bytes(4, "big")


class StarterTransport(Elaboratable):
    def __init__(self, *, clock_hz, general_image=False):
        # CSI2: selector zero, BEGIN header, 32-byte SHA256 (big endian),
        # then exactly IMAGE_BYTES. The hash is consistency, not authentication.
        self.general_image = general_image
        self.expected_digest = Signal(256)
        self.digest_valid = Signal()
        self.control = StarterLifecycle()
        self.maintenance = Signal()
        self.valid = Signal()
        self.byte = Signal(8)
        self.error = Signal()
        self.image = Signal()
        self.rejected = Signal(32)
        self.clock_hz = clock_hz
        self.tx_req = Signal()
        self.tx_byte = Signal(8)
        self.tx_last = Signal()
        self.tx_ack = Signal()

    def elaborate(self, platform):
        m = Module()
        ctl = m.submodules.lifecycle = self.control
        header = Signal(128)
        count = Signal(4)
        data_mode = Signal()
        digest_mode = Signal()
        digest_count = Signal(5)
        left = Signal(range(IMAGE_BYTES + 1))
        word = Signal(32)
        byte_index = Signal(2)
        index = Signal(32)
        idle = Signal(range(self.clock_hz * 2 + 1))
        active = (ctl.state == ctl.LOADING) | (ctl.state == ctl.VERIFYING) | (ctl.state == ctl.READY)
        complete = Signal()
        frame = Signal(128)
        op, image, epoch, length = frame[88:96], frame[80:88], frame[32:64], frame[:32]
        magic = b"CSI2" if self.general_image else MAGIC
        valid_header = ((frame[96:] == int.from_bytes(magic, "big")) &
                        (frame[64:80] == 0) &
                        ((image == 0) if self.general_image else (image < 2)))
        epoch_ok = epoch == ctl.epoch
        timeout = idle == self.clock_hz * 2
        m.d.comb += [
            frame.eq(Cat(self.byte, header[:120])),
            ctl.begin_authorized.eq(self.maintenance),
            ctl.start_authorized.eq(self.maintenance),
            ctl.start_epoch.eq(epoch),
            ctl.word_index.eq(index),
            ctl.word_data.eq(Cat(word[:24], self.byte)),
        ]
        # Loss of physical authorization fails an unfinished replacement.
        # It never resets or renews an already running watchdog.
        with m.If(active & (~self.maintenance | self.error | timeout)):
            m.d.comb += ctl.abort.eq(1)
        with m.If(~self.maintenance | self.error | timeout):
            m.d.sync += [count.eq(0), data_mode.eq(0), digest_mode.eq(0),
                         self.digest_valid.eq(0), idle.eq(0)]
        with m.Else():
            with m.If(self.valid):
                m.d.sync += idle.eq(0)
                with m.If(digest_mode):
                    m.d.sync += [
                        self.expected_digest.eq(Cat(self.byte, self.expected_digest[:248])),
                        digest_count.eq(digest_count + 1)]
                    with m.If(digest_count == 31):
                        m.d.sync += [digest_mode.eq(0), data_mode.eq(1),
                                     self.digest_valid.eq(1)]
                with m.Elif(data_mode):
                    m.d.sync += [word.word_select(byte_index, 8).eq(self.byte),
                                 byte_index.eq(byte_index + 1), left.eq(left - 1)]
                    with m.If(byte_index == 3):
                        m.d.comb += ctl.word_valid.eq(1)
                        m.d.sync += index.eq(index + 1)
                    with m.If(left == 1):
                        m.d.sync += data_mode.eq(0)
                with m.Else():
                    m.d.sync += [header.eq(frame), count.eq(count + 1)]
                    with m.If(count == 15):
                        m.d.comb += complete.eq(1)
            with m.Elif(data_mode | digest_mode | (count != 0)):
                m.d.sync += idle.eq(idle + 1)

        with m.If(complete):
            with m.If(valid_header & epoch_ok):
                with m.Switch(op):
                    with m.Case(1):
                        with m.If(length == IMAGE_BYTES):
                            m.d.comb += ctl.begin.eq(1)
                            with m.If(ctl.begin_accepted):
                                m.d.sync += [
                                    self.image.eq(image), data_mode.eq(not self.general_image),
                                    digest_mode.eq(self.general_image), digest_count.eq(0),
                                    self.expected_digest.eq(0), self.digest_valid.eq(0),
                                    left.eq(IMAGE_BYTES), index.eq(0),
                                    byte_index.eq(0), word.eq(0)]
                            with m.Else():
                                m.d.sync += self.rejected.eq(self.rejected + 1)
                        with m.Else():
                            m.d.sync += self.rejected.eq(self.rejected + 1)
                    with m.Case(2, 3, 4):
                        with m.If((length == 0) & (image == self.image)):
                            with m.Switch(op):
                                with m.Case(2):
                                    m.d.comb += ctl.finish.eq(1)
                                with m.Case(3):
                                    m.d.comb += ctl.start.eq(1)
                                with m.Case(4):
                                    m.d.comb += ctl.abort.eq(1)
                        with m.Else():
                            m.d.sync += self.rejected.eq(self.rejected + 1)
                    with m.Default():
                        m.d.sync += self.rejected.eq(self.rejected + 1)
                        with m.If(active):
                            m.d.comb += ctl.abort.eq(1)
            with m.Else():
                m.d.sync += self.rejected.eq(self.rejected + 1)
                # A malformed active transaction cannot be resumed as data.
                with m.If(active & ~valid_header):
                    m.d.comb += ctl.abort.eq(1)

        # Frozen status frames, serialized independently of command reception.
        # CS, state, selected image, epoch BE. No validation-success input.
        last_state = Signal(3, init=7)
        tx_index = Signal(3)
        snapshot = Signal(64)
        busy = Signal()
        m.d.comb += [
            self.tx_req.eq(busy), self.tx_last.eq(tx_index == 7),
            self.tx_byte.eq(Array(snapshot[i:i+8] for i in range(56, -1, -8))[tx_index]),
        ]
        with m.If(~busy & (ctl.state != last_state)):
            m.d.sync += [
                snapshot.eq(Cat(ctl.epoch, self.image, Const(0, 7),
                                ctl.state, Const(0, 5), Const(0x4353, 16))),
                last_state.eq(ctl.state), tx_index.eq(0), busy.eq(1)]
        with m.Elif(busy & self.tx_ack):
            with m.If(tx_index == 7):
                m.d.sync += busy.eq(0)
            with m.Else():
                m.d.sync += tx_index.eq(tx_index + 1)
        return m
