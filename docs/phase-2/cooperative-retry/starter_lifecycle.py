"""Isolated reset/load/validate/start control; not a transport or validator.

Only a protected control decoder may drive authorization inputs. Validation
must be supplied by a trusted verifier for the exact epoch and received memory.
This module does not authenticate requests or verify executable content itself.
The controller runs outside the execution domain it holds in reset.
"""
from amaranth import Elaboratable, Module, Signal


class StarterLifecycle(Elaboratable):
    HELD, LOADING, VERIFYING, READY, RUNNING, FAILED = range(6)

    def __init__(self, *, image_words=16384):
        if type(image_words) is not int or not 0 < image_words <= 16384:
            raise ValueError("image_words must be 1..16384")
        self.image_words = image_words
        self.state = Signal(range(6), init=self.HELD)
        self.epoch = Signal(32)
        self.words_received = Signal(range(image_words + 1))
        self.begin = Signal()
        self.begin_authorized = Signal()
        self.begin_accepted = Signal()
        self.word_valid = Signal()
        self.word_index = Signal(32)
        self.word_data = Signal(32)
        self.finish = Signal()
        self.abort = Signal()
        self.validation_valid = Signal()
        self.validation_epoch = Signal(32)
        self.validation_ok = Signal()
        self.validate_request = Signal()
        self.start = Signal()
        self.start_authorized = Signal()
        self.start_epoch = Signal(32)
        self.start_accepted = Signal()
        self.execution_reset = Signal()
        self.program_write_allowed = Signal()
        self.memory_write = Signal()
        self.memory_address = Signal(range(image_words))
        self.memory_data = Signal(32)

    def elaborate(self, platform):
        m = Module()
        in_transfer = Signal()
        bad_word = Signal()
        valid_start = Signal()
        m.d.comb += [
            in_transfer.eq((self.state == self.LOADING) |
                           (self.state == self.VERIFYING) |
                           (self.state == self.READY)),
            self.begin_accepted.eq(
                self.begin & self.begin_authorized & ~in_transfer &
                (self.epoch != 0xFFFFFFFF)),
            bad_word.eq(self.word_valid & in_transfer &
                        ((self.state != self.LOADING) |
                         (self.words_received >= self.image_words) |
                         (self.word_index != self.words_received))),
            valid_start.eq((self.state == self.READY) & self.start &
                           self.start_authorized & (self.start_epoch == self.epoch)),
            self.start_accepted.eq(valid_start & ~self.abort & ~bad_word),
            self.execution_reset.eq((self.state != self.RUNNING) |
                                    self.begin_accepted),
            self.program_write_allowed.eq(~self.execution_reset),
            self.memory_write.eq(
                (self.state == self.LOADING) & self.word_valid &
                ~bad_word & ~self.abort & ~self.finish),
            self.memory_address.eq(self.words_received),
            self.memory_data.eq(self.word_data),
            self.validate_request.eq(self.state == self.VERIFYING),
        ]

        # An epoch must never wrap and make an old validation result reusable.
        # Exhaustion refuses BEGIN without disturbing a running application.
        with m.If(self.begin_accepted):
            m.d.sync += [self.epoch.eq(self.epoch + 1),
                         self.words_received.eq(0),
                         self.state.eq(self.LOADING)]
        with m.Elif(in_transfer & (self.abort | bad_word)):
            m.d.sync += self.state.eq(self.FAILED)
        with m.Else():
            with m.Switch(self.state):
                with m.Case(self.LOADING):
                    # FINISH is a separate control beat after all data words.
                    with m.If(self.finish):
                        with m.If((self.words_received == self.image_words) &
                                  ~self.word_valid):
                            m.d.sync += self.state.eq(self.VERIFYING)
                        with m.Else():
                            m.d.sync += self.state.eq(self.FAILED)
                    with m.Elif(self.memory_write):
                        m.d.sync += self.words_received.eq(self.words_received + 1)
                with m.Case(self.VERIFYING):
                    with m.If(self.validation_valid):
                        with m.If(self.validation_ok &
                                  (self.validation_epoch == self.epoch)):
                            m.d.sync += self.state.eq(self.READY)
                        with m.Else():
                            m.d.sync += self.state.eq(self.FAILED)
                with m.Case(self.READY):
                    with m.If(self.start_accepted):
                        m.d.sync += self.state.eq(self.RUNNING)
        return m
