from amaranth import *
from amaranth.lib.data import View

from .hw_types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT, LUMP_HEADER_LAYOUT
from .thread_design import THREAD_STO_OFFSET


class ChurchLambda(Elaboratable):
    def __init__(self):
        self.lambda_start = Signal()
        self.cr_target = Signal(4)
        self.lambda_busy = Signal()
        self.lambda_complete = Signal()
        self.lambda_fault = Signal()
        self.fault_type = Signal(4)

        self.cr_rd_addr = Signal(4)
        self.cr_rd_data = Signal(CAP_REG_LAYOUT)

        self.nia_set = Signal()
        self.nia_value = Signal(32)
        self.saved_nia = Signal(32)
        self.thread_base = Signal(32)
        self.thread_hdr = Signal(32)
        self.code_cap = Signal(CAP_REG_LAYOUT)
        self.flags = Signal(4)
        self.mem_rd_addr = Signal(32)
        self.mem_rd_en = Signal()
        self.mem_rd_data = Signal(32)
        self.mem_rd_valid = Signal()
        self.mem_wr_addr = Signal(32)
        self.mem_wr_data = Signal(32)
        self.mem_wr_en = Signal()

    def elaborate(self, platform):
        m = Module()

        target_cap = Signal(CAP_REG_LAYOUT)
        target_view = View(CAP_REG_LAYOUT, target_cap)
        target_gt = View(GT_LAYOUT, target_view.word0_gt)

        has_x_perm = ~target_gt.dom & target_gt.perm[PERM_X]   # Turing dom=0, perm[2]=X
        is_null = Signal()
        m.d.comb += is_null.eq(target_gt.gt_type == GT_TYPE_NULL)

        fault_flag = Signal()
        fault_latched = Signal(4)
        base = Signal(32)
        hdr = Signal(LUMP_HEADER_LAYOUT)
        code = Signal(CAP_REG_LAYOUT)
        continuation = Signal(32)
        indicator = Signal(32)
        flags = Signal(4)
        armed = Signal()
        hv = View(LUMP_HEADER_LAYOUT, hdr)
        cv = View(CAP_REG_LAYOUT, code)
        cg = View(GT_LAYOUT, cv.word0_gt)
        size = Signal(22)
        floor = Signal(22)
        ceiling = Signal(22)
        m.d.comb += [
            size.eq(Const(1, 22) << (hv.n_minus_6 + 6)),
            ceiling.eq(size - 13),
            floor.eq(size - 12 - hv.cw),
        ]

        with m.FSM(name="lambda") as fsm:
            with m.State("IDLE"):
                m.d.sync += [fault_flag.eq(0), fault_latched.eq(FaultType.NONE)]
                with m.If(self.lambda_start):
                    m.d.sync += [
                        base.eq(self.thread_base), hdr.eq(self.thread_hdr),
                        code.eq(self.code_cap), continuation.eq(self.saved_nia),
                        flags.eq(self.flags),
                        armed.eq(0),
                    ]
                    m.d.comb += self.cr_rd_addr.eq(self.cr_target)
                    m.next = "READ_CR"

            with m.State("READ_CR"):
                m.d.comb += self.cr_rd_addr.eq(self.cr_target)
                m.d.sync += target_cap.eq(self.cr_rd_data)
                m.next = "CHECK_PERM"

            with m.State("CHECK_PERM"):
                with m.If(is_null):
                    m.d.sync += [fault_flag.eq(1), fault_latched.eq(FaultType.NULL_CAP)]
                    m.next = "FAULT"
                with m.Elif(~has_x_perm):
                    m.d.sync += [fault_flag.eq(1), fault_latched.eq(FaultType.PERM_X)]
                    m.next = "FAULT"
                with m.Else():
                    m.next = "CHECK_CONTEXT"

            with m.State("CHECK_CONTEXT"):
                # Same-context transfer: neither entry nor continuation may
                # escape the current executable descriptor.
                with m.If((target_gt.gt_type != GT_TYPE_INFORM) |
                          (cg.gt_type != GT_TYPE_INFORM) | cg.dom | ~cg.perm[PERM_X] |
                          (hv.magic != 31) | (hv.typ != 2) |
                          (hv.n_minus_6 > 6) | (hv.cw == 0) |
                          (floor <= THREAD_STO_OFFSET) |
                          (target_view.word1_location < cv.word1_location) |
                          (target_view.word1_location >
                           cv.word1_location + (cv.word2_w2[:21] << 2)) |
                          (continuation < cv.word1_location) |
                          (continuation >
                           cv.word1_location + (cv.word2_w2[:21] << 2)) |
                          (continuation[:2] != 0) | (continuation >= 0x1FFFC) |
                          (target_view.word1_location[:2] != 0)):
                    m.d.sync += [fault_flag.eq(1), fault_latched.eq(FaultType.BOUNDS)]
                    m.next = "FAULT"
                with m.Else():
                    m.next = "READ_STO"

            with m.State("READ_STO"):
                m.d.comb += [self.mem_rd_addr.eq(base + THREAD_STO_OFFSET * 4),
                             self.mem_rd_en.eq(1)]
                m.d.sync += armed.eq(1)
                with m.If(self.mem_rd_valid & armed):
                    m.d.sync += [indicator.eq(self.mem_rd_data), armed.eq(0)]
                    m.next = "CHECK_STO"

            with m.State("CHECK_STO"):
                with m.If((indicator[13:28] != 0) |
                          (indicator[:12] <= floor + 1) |
                          (indicator[:12] > ceiling)):
                    m.d.sync += [fault_flag.eq(1), fault_latched.eq(FaultType.BOUNDS)]
                    m.next = "FAULT"
                with m.Else():
                    m.next = "PUSH_FRAME"

            with m.State("PUSH_FRAME"):
                m.d.comb += [
                    self.mem_wr_addr.eq(base + (indicator[:12] << 2)),
                    self.mem_wr_data.eq(Cat(indicator[:13], continuation[2:17],
                                            flags)),
                    self.mem_wr_en.eq(1),
                ]
                m.next = "PUSH_STO"

            with m.State("PUSH_STO"):
                m.d.comb += [
                    self.mem_wr_addr.eq(base + THREAD_STO_OFFSET * 4),
                    self.mem_wr_data.eq(
                        ((indicator[:12] - 1) & 0xFFF) | (flags << 28)),
                    self.mem_wr_en.eq(1),
                ]
                m.next = "EXECUTE"

            with m.State("EXECUTE"):
                m.d.comb += [
                    self.nia_set.eq(1),
                    self.nia_value.eq(target_view.word1_location[:32]),
                ]
                m.next = "COMPLETE"

            with m.State("COMPLETE"):
                m.next = "IDLE"

            with m.State("FAULT"):
                m.next = "IDLE"

        m.d.comb += [
            self.lambda_busy.eq(~fsm.ongoing("IDLE")),
            self.lambda_complete.eq(fsm.ongoing("COMPLETE")),
            self.lambda_fault.eq(fault_flag),
            self.fault_type.eq(fault_latched),
        ]

        return m
