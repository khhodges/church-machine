from amaranth import *
from amaranth.lib.data import View

from .hw_types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT


class ChurchTperm(Elaboratable):
    def __init__(self):
        self.tperm_start = Signal()
        self.cr_target = Signal(4)   # CRd — target CR to attenuate (or compare for EXACT)
        self.cr_src    = Signal(4)   # CRs — reference CR for EXACT mode
        self.preset = Signal(4)

        # FRAME preset input: 1 if a real return frame exists on the call stack
        # (i.e. RETURN would not underflow into the boot sentinel).
        # Driven by core.py: stack_has_frame = (STO < sp_max).
        self.stack_has_frame = Signal()

        self.tperm_busy = Signal()
        self.tperm_complete = Signal()
        self.tperm_fault = Signal()
        self.fault_type = Signal(4)

        # Z-flag result latched on the cycle before COMPLETE.
        # Semantics by path:
        #   CLEAR / exact permission preset → 1
        #   same-domain permission mismatch → 0 (no write, no fault)
        #   EXACT (CHECK_EXACT)        → 1 (word0s matched; mismatch takes FAULT path)
        #   FRAME (CHECK_FRAME)        → stack_has_frame (1 if real return frame exists)
        # Valid only when tperm_complete is high.
        self.tperm_z_result = Signal()

        self.cr_rd_addr = Signal(4)
        self.cr_rd_data = Signal(CAP_REG_LAYOUT)

        self.cr_wr_addr = Signal(4)
        self.cr_wr_data = Signal(CAP_REG_LAYOUT)
        self.cr_wr_en = Signal()

    def elaborate(self, platform):
        m = Module()

        target_cap = Signal(CAP_REG_LAYOUT)
        target_view = View(CAP_REG_LAYOUT, target_cap)
        target_gt = View(GT_LAYOUT, target_view.word0_gt)

        ref_cap = Signal(CAP_REG_LAYOUT)          # latched for EXACT comparison
        ref_view = View(CAP_REG_LAYOUT, ref_cap)

        preset_reg   = Signal(4)
        fault_flag   = Signal()
        fault_latched = Signal(4)
        z_result_reg = Signal()   # latched Z value, forwarded to tperm_z_result on COMPLETE

        # 6-bit logical permission mask for the requested preset (PERM_MASK_* constants).
        new_perms = Signal(6)
        is_reserved = Signal()
        is_clear = Signal()
        is_exact  = Signal()   # preset == TpermPreset.EXACT
        is_frame  = Signal()   # preset == TpermPreset.FRAME

        # Decode target GT dom+perm[2:0] → 6-bit logical perms for comparison.
        #   Turing (dom=0): logical[2:0] = perm (XWR), [5:3] = 0
        #   Church (dom=1): logical[5:3] = perm (ESL), [2:0] = 0
        target_logical = Signal(6)
        m.d.comb += target_logical.eq(
            Mux(target_gt.dom,
                Cat(C(0, 3), target_gt.perm),   # Church: perm → [5:3]
                Cat(target_gt.perm, C(0, 3))    # Turing: perm → [2:0]
            )
        )

        with m.Switch(preset_reg):
            with m.Case(TpermPreset.CLEAR):
                m.d.comb += [new_perms.eq(0), is_clear.eq(1)]
            with m.Case(TpermPreset.R):
                m.d.comb += new_perms.eq(PERM_MASK_R)
            with m.Case(TpermPreset.RW):
                m.d.comb += new_perms.eq(PERM_MASK_R | PERM_MASK_W)
            with m.Case(TpermPreset.X):
                m.d.comb += new_perms.eq(PERM_MASK_X)
            with m.Case(TpermPreset.RX):
                m.d.comb += new_perms.eq(PERM_MASK_R | PERM_MASK_X)
            with m.Case(TpermPreset.RWX):
                m.d.comb += new_perms.eq(PERM_MASK_R | PERM_MASK_W | PERM_MASK_X)
            with m.Case(TpermPreset.L):
                m.d.comb += new_perms.eq(PERM_MASK_L)
            with m.Case(TpermPreset.S):
                m.d.comb += new_perms.eq(PERM_MASK_S)
            with m.Case(TpermPreset.E):
                m.d.comb += new_perms.eq(PERM_MASK_E)
            with m.Case(TpermPreset.LS):
                m.d.comb += new_perms.eq(PERM_MASK_L | PERM_MASK_S)
            with m.Case(TpermPreset.EXACT):
                m.d.comb += [new_perms.eq(0), is_exact.eq(1)]
            with m.Case(TpermPreset.FRAME):
                m.d.comb += [new_perms.eq(0), is_frame.eq(1)]
            with m.Default():
                m.d.comb += [new_perms.eq(0), is_reserved.eq(1)]

        # Ordinary presets are exact assertions, not subset checks.  Domain
        # purity is checked independently so a cross-domain request remains a
        # hard fault even when the target is missing the requested permission.
        requested_turing = Signal()
        requested_church = Signal()
        domain_purity_fault = Signal()
        permissions_exact = Signal()
        m.d.comb += [
            requested_turing.eq(new_perms[:3] != 0),
            requested_church.eq(new_perms[3:6] != 0),
            domain_purity_fault.eq(
                (requested_turing & requested_church) |
                (requested_turing & target_gt.dom) |
                (requested_church & ~target_gt.dom)
            ),
            permissions_exact.eq(target_logical == new_perms),
        ]

        with m.FSM(name="tperm") as fsm:
            with m.State("IDLE"):
                m.d.sync += [fault_flag.eq(0), fault_latched.eq(FaultType.NONE)]
                with m.If(self.tperm_start):
                    m.d.sync += preset_reg.eq(self.preset)
                    m.next = "READ_CR"

            with m.State("READ_CR"):
                m.d.comb += self.cr_rd_addr.eq(self.cr_target)
                m.d.sync += target_cap.eq(self.cr_rd_data)
                m.next = "CHECK"

            with m.State("CHECK"):
                with m.If(is_reserved):
                    m.d.sync += [fault_flag.eq(1), fault_latched.eq(FaultType.TPERM_RSV)]
                    m.next = "FAULT"
                with m.Elif(is_exact):
                    m.next = "READ_CR2"
                with m.Elif(is_frame):
                    m.next = "CHECK_FRAME"
                with m.Elif(is_clear):
                    # CLEAR is an existence check, not a permission rewrite.
                    m.d.sync += z_result_reg.eq(1)
                    m.next = "COMPLETE"
                with m.Elif(domain_purity_fault):
                    m.d.sync += [fault_flag.eq(1), fault_latched.eq(FaultType.DOMAIN_PURITY)]
                    m.next = "FAULT"
                with m.Elif(~permissions_exact):
                    # Same-domain missing or extra permissions are ordinary
                    # failed checks.  Do not enter APPLY: the capability must
                    # remain byte-for-byte unchanged.
                    m.d.sync += z_result_reg.eq(0)
                    m.next = "COMPLETE"
                with m.Else():
                    m.next = "APPLY"

            with m.State("CHECK_FRAME"):
                # FRAME: Z=1 if a real return frame exists (RETURN would not underflow).
                # stack_has_frame is driven by core.py: 1 when STO < sp_max.
                # No CR is read or written; crDst is ignored.
                m.d.sync += z_result_reg.eq(self.stack_has_frame)
                m.next = "COMPLETE"

            with m.State("READ_CR2"):
                # EXACT mode: read the reference CR (CRs) for the identity comparison.
                m.d.comb += self.cr_rd_addr.eq(self.cr_src)
                m.d.sync += ref_cap.eq(self.cr_rd_data)
                m.next = "CHECK_EXACT"

            with m.State("CHECK_EXACT"):
                # EXACT: fault BIND if CRd.word0_gt != CRs.word0_gt (all 32 bits).
                with m.If(target_view.word0_gt != ref_view.word0_gt):
                    m.d.sync += [fault_flag.eq(1), fault_latched.eq(FaultType.BIND)]
                    m.next = "FAULT"
                with m.Else():
                    m.d.sync += z_result_reg.eq(1)
                    m.next = "COMPLETE"

            with m.State("APPLY"):
                # Reached only for an exact ordinary permission-set match → Z=1.
                m.d.sync += z_result_reg.eq(1)
                # Encode result logical perms (new_perms & target_logical) back to dom+perm.
                result_logical = Signal(6)
                result_dom = Signal()
                result_perm3 = Signal(3)
                m.d.comb += result_logical.eq(new_perms & target_logical)
                # dom=1 if any Church bit (L=bit3, S=bit4, E=bit5) is set in result.
                m.d.comb += result_dom.eq(
                    result_logical[PERM_L] | result_logical[PERM_S] | result_logical[PERM_E]
                )
                # Church: perm[0]=L=logical[3], perm[1]=S=logical[4], perm[2]=E=logical[5]
                #         → result_logical[3:6] as a 3-bit slice
                # Turing: perm[0]=R=logical[0], perm[1]=W=logical[1], perm[2]=X=logical[2]
                #         → result_logical[0:3] as a 3-bit slice
                m.d.comb += result_perm3.eq(
                    Mux(result_dom, result_logical[3:6], result_logical[0:3])
                )

                result_cap = Signal(CAP_REG_LAYOUT)
                result_view = View(CAP_REG_LAYOUT, result_cap)
                result_gt = View(GT_LAYOUT, result_view.word0_gt)
                m.d.comb += [
                    result_cap.eq(target_cap),
                    result_gt.dom.eq(result_dom),
                    result_gt.perm.eq(result_perm3),
                    self.cr_wr_addr.eq(self.cr_target),
                    self.cr_wr_data.eq(result_cap),
                    self.cr_wr_en.eq(1),
                ]
                m.next = "COMPLETE"

            with m.State("COMPLETE"):
                m.next = "IDLE"

            with m.State("FAULT"):
                m.next = "IDLE"

        m.d.comb += [
            self.tperm_busy.eq(~fsm.ongoing("IDLE")),
            self.tperm_complete.eq(fsm.ongoing("COMPLETE")),
            self.tperm_fault.eq(fault_flag),
            self.fault_type.eq(fault_latched),
            self.tperm_z_result.eq(z_result_reg),
        ]

        return m
