"""Isolated IDX1 packet structural decode and exact index preflight.

This block is NOT an execution gate. Inputs must already be the complete,
authenticated packet at an admitted start, with stable accepted DR/flag/PC
values. No fetch, profile, authority, capability, or memory checks live here.
Outputs are facts for a later authority-first sequencer, never bus enables.
"""

from amaranth import *


# Local diagnostic categories, not architectural/device fault numbers.
IDX1_OK = 0
IDX1_HEADER_LENGTH = 1
IDX1_OPCODE_MODE = 2
IDX1_ROLE_MASK = 3
IDX1_RESERVED_REPLACEMENT = 4
IDX1_DESCRIPTOR = 5


class IDX1Preflight(Elaboratable):
    """Combinational IDX1 packet decoder and checked arithmetic.

    words_available is the number of supplied words (0..3). Extra supplied
    words are rejected: a packet is exactly two or three words. dr0_value and
    dr1_value correspond to the decoded selected roles (not arbitrary register
    read addresses); dr0 architectural register number 0 is forced to zero.
    For a role1-only packet its descriptor and value come from W0/dr1_value.
    role*_value are 34-bit two's-complement mathematical results; only consume
    when arithmetic_valid and the respective role is selected. Nonselected
    CALL literal operands are exposed separately. No dynamic grant is checked.
    """

    def __init__(self):
        self.w0 = Signal(32)
        self.w1 = Signal(32)
        self.w2 = Signal(32)
        self.words_available = Signal(2)
        self.dr0_value = Signal(32)
        self.dr1_value = Signal(32)
        self.pc_word = Signal(32)
        self.n = Signal()
        self.z = Signal()
        self.c = Signal()
        self.v = Signal()

        self.role_mask = Signal(2)
        self.length = Signal(2)
        self.opcode = Signal(5)
        self.condition = Signal(4)
        self.a = Signal(4)
        self.b = Signal(4)
        self.width = Signal(5)
        self.literal_row = Signal(5)
        self.literal_method = Signal(15)
        self.role0_reg = Signal(4)
        self.role1_reg = Signal(4)
        self.role0_sub = Signal()
        self.role1_sub = Signal()
        self.role0_magnitude = Signal(20)
        self.role1_magnitude = Signal(20)

        self.structure_ok = Signal()
        self.structure_reason = Signal(3)
        self.predicate_pass = Signal()
        self.arithmetic_valid = Signal()
        self.role0_value = Signal(34)
        self.role1_value = Signal(34)
        self.role0_arithmetic_ok = Signal()
        self.role1_arithmetic_ok = Signal()
        self.arithmetic_ok = Signal()
        self.branch_target = Signal(35)
        self.branch_target_u32_ok = Signal()
        self.bitfield_range_ok = Signal()

    def elaborate(self, platform):
        m = Module()
        mask = self.w0[25:27]
        op = self.w1[27:32]
        a = self.w1[19:23]
        b = self.w1[15:19]
        imm = self.w1[:15]
        indexed_call = (op == 2) & (a == 0) & (b == 6)
        direct_call = (op == 2) & (b == 0) & (a != 0)
        bf = (op == 18) | (op == 19)
        role0 = mask[0]
        role1 = mask[1]
        second = Mux(mask == 3, self.w2, self.w0)
        m.d.comb += [
            self.role_mask.eq(mask),
            self.length.eq(Mux(mask == 3, 3, 2)),
            self.opcode.eq(op),
            self.condition.eq(self.w1[23:27]),
            self.a.eq(a),
            self.b.eq(b),
            self.width.eq(imm[:5]),
            self.literal_row.eq(imm[:5]),
            self.literal_method.eq(Mux(indexed_call, imm[5:12], imm)),
            self.role0_reg.eq(self.w0[20:24]),
            self.role0_sub.eq(self.w0[24]),
            self.role0_magnitude.eq(self.w0[:20]),
            self.role1_reg.eq(second[20:24]),
            self.role1_sub.eq(second[24]),
            self.role1_magnitude.eq(second[:20]),
        ]

        mode_ok = Signal()
        allowed_roles = Signal()
        replacement = Signal()
        reserved = Signal()
        with m.Switch(op):
            with m.Case(0, 1):
                m.d.comb += [mode_ok.eq(1), allowed_roles.eq(mask == 1),
                             replacement.eq((self.w1 & 0x7fff) == 0)]
            with m.Case(5):
                m.d.comb += [mode_ok.eq((a >= 12) & (b <= 11)),
                             allowed_roles.eq(mask == 1),
                             replacement.eq((self.w1 & 0x7fff) == 0)]
            with m.Case(4):
                m.d.comb += [mode_ok.eq(a >= 12), allowed_roles.eq(mask == 1),
                             replacement.eq((self.w1 & 0x7fff) == 0)]
            with m.Case(2):
                m.d.comb += [
                    mode_ok.eq(indexed_call | direct_call),
                    allowed_roles.eq(Mux(indexed_call, mask != 0, mask == 2)),
                    reserved.eq(~indexed_call | (imm[12:15] == 0)),
                    replacement.eq(Mux(indexed_call,
                        (~role0 | ((self.w1 & 0x1f) == 0)) &
                        (~role1 | ((self.w1 & 0xfe0) == 0)),
                        (self.w1 & 0x7fff) == 0)),
                ]
            with m.Case(16, 17):
                m.d.comb += [mode_ok.eq(imm[14]), allowed_roles.eq(mask == 1),
                             replacement.eq((self.w1 & 0x3fff) == 0)]
            with m.Case(23):
                m.d.comb += [mode_ok.eq((a == 0) & (b == 0)),
                             allowed_roles.eq(mask == 1),
                             replacement.eq((self.w1 & 0x7fff) == 0)]
            with m.Case(18, 19):
                m.d.comb += [
                    mode_ok.eq((imm[10:15] == 0) & (imm[:5] != 0)),
                    allowed_roles.eq(mask == 1),
                    replacement.eq((self.w1 & 0x3e0) == 0),
                ]
        # Default reserved is true except for CALL (where it is assigned above).
        # Use an explicit expression instead to avoid comb-driver overlap.
        reserved_ok = Signal()
        m.d.comb += reserved_ok.eq(Mux(op == 2, reserved, 1) &
                                    ((mask != 3) | (self.w2[25:32] == 0)))
        reason = Signal(3)
        with m.If((self.w0[27:32] != 10) |
                  (self.words_available != self.length)):
            m.d.comb += reason.eq(IDX1_HEADER_LENGTH)
        with m.Elif(~mode_ok):
            m.d.comb += reason.eq(IDX1_OPCODE_MODE)
        with m.Elif(~allowed_roles):
            m.d.comb += reason.eq(IDX1_ROLE_MASK)
        with m.Elif(~reserved_ok | ~replacement):
            m.d.comb += reason.eq(IDX1_RESERVED_REPLACEMENT)
        with m.Elif((self.w0[24] & (self.w0[:20] == 0)) |
                    ((mask == 3) & self.w2[24] & (self.w2[:20] == 0))):
            m.d.comb += reason.eq(IDX1_DESCRIPTOR)
        m.d.comb += [
            self.structure_reason.eq(reason),
            self.structure_ok.eq(reason == IDX1_OK),
        ]

        cond = self.condition
        pred = Signal()
        with m.Switch(cond):
            with m.Case(0): m.d.comb += pred.eq(self.z)
            with m.Case(1): m.d.comb += pred.eq(~self.z)
            with m.Case(2): m.d.comb += pred.eq(self.c)
            with m.Case(3): m.d.comb += pred.eq(~self.c)
            with m.Case(4): m.d.comb += pred.eq(self.n)
            with m.Case(5): m.d.comb += pred.eq(~self.n)
            with m.Case(6): m.d.comb += pred.eq(self.v)
            with m.Case(7): m.d.comb += pred.eq(~self.v)
            with m.Case(8): m.d.comb += pred.eq(self.c & ~self.z)
            with m.Case(9): m.d.comb += pred.eq(~self.c | self.z)
            with m.Case(10): m.d.comb += pred.eq(self.n == self.v)
            with m.Case(11): m.d.comb += pred.eq(self.n != self.v)
            with m.Case(12): m.d.comb += pred.eq(~self.z & (self.n == self.v))
            with m.Case(13): m.d.comb += pred.eq(self.z | (self.n != self.v))
            with m.Case(14): m.d.comb += pred.eq(1)
            # NV (15) remains false.
        m.d.comb += [
            self.predicate_pass.eq(self.structure_ok & pred),
            self.arithmetic_valid.eq(self.structure_ok & pred),
        ]

        # Widen before sign extension and before subtraction: 34 bits retain
        # negative unsigned underflow and positive unsigned32 overflow.
        base0 = Signal(34)
        base1 = Signal(34)
        raw0 = Signal(34)
        raw1 = Signal(34)
        m.d.comb += [
            base0.eq(Mux(self.role0_reg == 0, 0, self.dr0_value)),
            base1.eq(Mux(self.role1_reg == 0, 0, self.dr1_value)),
        ]
        signed0 = Signal(34)
        m.d.comb += signed0.eq(Mux(self.dr0_value[31] & (self.role0_reg != 0),
                                    base0 | (3 << 32), base0))
        arg0 = Mux(op == 23, signed0, base0)
        m.d.comb += [
            raw0.eq(Mux(self.role0_sub, arg0 - self.role0_magnitude,
                        arg0 + self.role0_magnitude)),
            raw1.eq(Mux(self.role1_sub, base1 - self.role1_magnitude,
                        base1 + self.role1_magnitude)),
            self.role0_value.eq(Mux(self.arithmetic_valid & role0, raw0, 0)),
            self.role1_value.eq(Mux(self.arithmetic_valid & role1, raw1, 0)),
            self.role0_arithmetic_ok.eq(~role0 | (op == 23) |
                                         (raw0[32:34] == 0)),
            self.role1_arithmetic_ok.eq(~role1 | (raw1[32:34] == 0)),
        ]
        target = Signal(35)
        # Sign extend displacement to 35 bits before adding unsigned word PC.
        m.d.comb += target.eq(self.pc_word + Cat(raw0, raw0[33]))
        m.d.comb += [
            self.branch_target.eq(Mux(self.arithmetic_valid & (op == 23), target, 0)),
            self.branch_target_u32_ok.eq((target[32:35] == 0)),
            self.bitfield_range_ok.eq((raw0[32:34] == 0) &
                                       ((raw0 + self.width) <= 32)),
            self.arithmetic_ok.eq(self.arithmetic_valid &
                self.role0_arithmetic_ok & self.role1_arithmetic_ok &
                (~bf | self.bitfield_range_ok) &
                ((op != 23) | self.branch_target_u32_ok)),
        ]
        return m