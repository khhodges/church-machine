from amaranth import *
from amaranth.lib.data import View

from .hw_types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT


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

        with m.FSM(name="lambda") as fsm:
            with m.State("IDLE"):
                m.d.sync += [fault_flag.eq(0), fault_latched.eq(FaultType.NONE)]
                with m.If(self.lambda_start):
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
