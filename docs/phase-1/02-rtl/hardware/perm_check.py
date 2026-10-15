from amaranth import *
from amaranth.lib.data import View

from .hw_types import *
from .layouts import GT_LAYOUT


def perm_bit(gt_signal, perm_idx: int):
    """Return an Amaranth expression: 1 iff gt_signal carries logical perm at perm_idx.

    perm_idx: PERM_R=0, PERM_W=1, PERM_X=2 (Turing); PERM_L=3, PERM_S=4, PERM_E=5 (Church).

    Uses the new dom+perm[2:0] GT encoding:
      dom=0 (Turing): perm[2]=X, perm[1]=W, perm[0]=R
      dom=1 (Church): perm[2]=E, perm[1]=S, perm[0]=L

    Accepts a raw Signal (shape=GT_LAYOUT or 32-bit) or an existing View(GT_LAYOUT, ...).
    """
    try:
        dom  = gt_signal.dom
        perm = gt_signal.perm
    except AttributeError:
        v = View(GT_LAYOUT, gt_signal)
        dom  = v.dom
        perm = v.perm
    if perm_idx < 3:   # Turing bit (R=0, W=1, X=2)
        return ~dom & perm[perm_idx]
    else:              # Church bit (L=3, S=4, E=5)
        return dom & perm[perm_idx - 3]


class ChurchPermCheck(Elaboratable):
    def __init__(self):
        self.gt_in = Signal(GT_LAYOUT)
        self.required_perms = Signal(6)
        self.check_valid = Signal()

        self.access_index = Signal(16)
        self.limit = Signal(32)
        self.check_bounds = Signal()

        self.stored_gt_seq = Signal(9)
        self.gt_seq = Signal(9)
        self.check_version = Signal()

        self.calculated_seal = Signal(32)
        self.stored_seal = Signal(32)
        self.check_seal = Signal()

        self.perm_granted = Signal()
        self.bounds_ok = Signal()
        self.version_ok = Signal()
        self.seal_valid = Signal()
        self.all_checks_pass = Signal()
        self.fault_type = Signal(4)
        self.fault_valid = Signal()

        self.check_domain_purity = Signal()
        self.domain_purity_ok = Signal()

    def elaborate(self, platform):
        m = Module()

        gt_view = View(GT_LAYOUT, self.gt_in)

        # Decode dom+perm[2:0] → 6-bit logical perms (combinational):
        #   Turing (dom=0): logical[2:0] = perm (X W R), logical[5:3] = 0
        #   Church (dom=1): logical[5:3] = perm (E S L), logical[2:0] = 0
        # Cat(a, b) places a at LSB, so:
        #   Cat(gt_view.perm, C(0,3)) → perm at [2:0], zeros at [5:3]  (Turing)
        #   Cat(C(0,3), gt_view.perm) → zeros at [2:0], perm at [5:3]  (Church)
        gt_perms = Signal(6)
        m.d.comb += gt_perms.eq(
            Mux(gt_view.dom,
                Cat(C(0, 3), gt_view.perm),   # Church: perm → [5:3]
                Cat(gt_view.perm, C(0, 3))    # Turing: perm → [2:0]
            )
        )

        is_null_gt = Signal()
        perms_match = Signal()

        m.d.comb += [
            is_null_gt.eq(gt_view.gt_type == GT_TYPE_NULL),
            perms_match.eq((gt_perms & self.required_perms) == self.required_perms),
            self.perm_granted.eq(~is_null_gt & perms_match),
        ]

        # Domain purity is structurally enforced by the dom bit in the GT encoding.
        # A GT can never carry both Turing and Church permissions simultaneously.
        m.d.comb += self.domain_purity_ok.eq(1)

        m.d.comb += self.bounds_ok.eq(~self.check_bounds | (self.access_index < self.limit[:16]))
        m.d.comb += self.version_ok.eq(~self.check_version | (self.gt_seq == self.stored_gt_seq))
        m.d.comb += self.seal_valid.eq(~self.check_seal | (self.calculated_seal == self.stored_seal))

        m.d.comb += self.all_checks_pass.eq(
            self.perm_granted & self.bounds_ok & self.version_ok & self.seal_valid
        )

        m.d.comb += [
            self.fault_valid.eq(0),
            self.fault_type.eq(FaultType.NONE),
        ]

        with m.If(self.check_valid):
            with m.If(is_null_gt):
                m.d.comb += [
                    self.fault_valid.eq(1),
                    self.fault_type.eq(FaultType.NULL_CAP),
                ]
            with m.Elif(~perms_match):
                m.d.comb += self.fault_valid.eq(1)
                with m.If((self.required_perms & PERM_MASK_R) & ~(gt_perms & PERM_MASK_R)):
                    m.d.comb += self.fault_type.eq(FaultType.PERM_R)
                with m.Elif((self.required_perms & PERM_MASK_W) & ~(gt_perms & PERM_MASK_W)):
                    m.d.comb += self.fault_type.eq(FaultType.PERM_W)
                with m.Elif((self.required_perms & PERM_MASK_X) & ~(gt_perms & PERM_MASK_X)):
                    m.d.comb += self.fault_type.eq(FaultType.PERM_X)
                with m.Elif((self.required_perms & PERM_MASK_L) & ~(gt_perms & PERM_MASK_L)):
                    m.d.comb += self.fault_type.eq(FaultType.PERM_L)
                with m.Elif((self.required_perms & PERM_MASK_S) & ~(gt_perms & PERM_MASK_S)):
                    m.d.comb += self.fault_type.eq(FaultType.PERM_S)
                with m.Elif((self.required_perms & PERM_MASK_E) & ~(gt_perms & PERM_MASK_E)):
                    m.d.comb += self.fault_type.eq(FaultType.PERM_E)
                with m.Else():
                    m.d.comb += self.fault_type.eq(FaultType.PERM_R)
            with m.Elif(self.check_bounds & ~self.bounds_ok):
                m.d.comb += [
                    self.fault_valid.eq(1),
                    self.fault_type.eq(FaultType.BOUNDS),
                ]
            with m.Elif(self.check_version & ~self.version_ok):
                m.d.comb += [
                    self.fault_valid.eq(1),
                    self.fault_type.eq(FaultType.VERSION),
                ]
            with m.Elif(self.check_seal & ~self.seal_valid):
                m.d.comb += [
                    self.fault_valid.eq(1),
                    self.fault_type.eq(FaultType.SEAL),
                ]

        return m
