from amaranth import *
from amaranth.lib.data import View

from .hw_types import *
from .layouts import GT_LAYOUT


class ChurchPermCheck(Elaboratable):
    def __init__(self):
        self.gt_in = Signal(GT_LAYOUT)
        self.required_perms = Signal(6)
        self.check_valid = Signal()

        self.access_index = Signal(16)
        self.limit = Signal(32)
        self.check_bounds = Signal()

        self.stored_gt_seq = Signal(7)
        self.gt_seq = Signal(7)
        self.check_version = Signal()

        self.calculated_seal = Signal(16)
        self.stored_seal = Signal(16)
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
        gt_perms = gt_view.perms

        is_null_gt = Signal()
        perms_match = Signal()

        m.d.comb += [
            is_null_gt.eq(gt_view.gt_type == GT_TYPE_NULL),
            perms_match.eq((gt_perms & self.required_perms) == self.required_perms),
            self.perm_granted.eq(~is_null_gt & perms_match),
        ]

        has_turing = Signal()
        has_church = Signal()
        m.d.comb += [
            has_turing.eq((gt_perms & DATA_PERMS) != 0),
            has_church.eq((gt_perms & CAP_PERMS) != 0),
            self.domain_purity_ok.eq(~(has_turing & has_church)),
        ]

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
            with m.Elif(self.check_domain_purity & ~self.domain_purity_ok):
                m.d.comb += [
                    self.fault_valid.eq(1),
                    self.fault_type.eq(FaultType.DOMAIN_PURITY),
                ]

        return m
