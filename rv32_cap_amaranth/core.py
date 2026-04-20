from amaranth import *
from amaranth.lib.data import View

from .types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT, COND_FLAGS_LAYOUT
from .registers import CTMMCapRegisters
from .decoder import CTMMCapDecoder
from .perm_check import CTMMCapPermCheck
from .gc_unit import CTMMCapGCUnit
from .lambda_unit import CTMMCapLambda
from .call import CTMMCapCall
from .ret import CTMMCapReturn
from .tperm import CTMMCapTperm
from .save import CTMMCapSave


class CTMMCapCore(Elaboratable):
    def __init__(self):
        self.imem_addr = Signal(32)
        self.imem_data = Signal(32)
        self.imem_valid = Signal()

        self.dmem_addr = Signal(32)
        self.dmem_rd_en = Signal()
        self.dmem_rd_data = Signal(32)
        self.dmem_wr_data = Signal(32)
        self.dmem_wr_en = Signal()

        self.ns_addr = Signal(32)
        self.ns_rd_en = Signal()
        self.ns_rd_data = Signal(32 * 3)
        self.ns_wr_data = Signal(32 * 3)
        self.ns_wr_en = Signal()

        self.clist_addr = Signal(32)
        self.clist_rd_en = Signal()
        self.clist_rd_data = Signal(GT_LAYOUT)
        self.clist_wr_data = Signal(GT_LAYOUT)
        self.clist_wr_en = Signal()

        self.boot_start = Signal()
        self.boot_state = Signal(3)
        self.boot_complete = Signal()

        self.gc_start = Signal()
        self.gc_busy = Signal()
        self.gc_garbage_count = Signal(32)

        self.fault = Signal(4)
        self.fault_valid = Signal()

        self.nia = Signal(32)
        self.flags = Signal(COND_FLAGS_LAYOUT)

    def elaborate(self, platform):
        m = Module()

        u_regs = CTMMCapRegisters()
        u_decoder = CTMMCapDecoder()
        u_perm = CTMMCapPermCheck()
        u_gc = CTMMCapGCUnit()
        u_lambda = CTMMCapLambda()
        u_call = CTMMCapCall()
        u_return = CTMMCapReturn()
        u_tperm = CTMMCapTperm()
        u_save = CTMMCapSave()
        m.submodules.u_registers = u_regs
        m.submodules.u_decoder = u_decoder
        m.submodules.u_perm_check = u_perm
        m.submodules.u_gc_unit = u_gc
        m.submodules.u_lambda = u_lambda
        m.submodules.u_call = u_call
        m.submodules.u_return = u_return
        m.submodules.u_tperm = u_tperm
        m.submodules.u_save = u_save

        nia_reg = Signal(32)
        nia_next = Signal(32)
        nia_wr_en = Signal()

        boot_state_reg = Signal(3, init=BootState.IDLE)
        clear_all = Signal()

        m.d.comb += [
            self.boot_state.eq(boot_state_reg),
            self.boot_complete.eq(boot_state_reg == BootState.COMPLETE),
            clear_all.eq(boot_state_reg == BootState.FAULT_RST),
        ]

        with m.Switch(boot_state_reg):
            with m.Case(BootState.IDLE):
                with m.If(self.boot_start):
                    m.d.sync += boot_state_reg.eq(BootState.FAULT_RST)
            with m.Case(BootState.FAULT_RST):
                m.d.sync += boot_state_reg.eq(BootState.LOAD_NS)
            with m.Case(BootState.LOAD_NS):
                m.d.sync += boot_state_reg.eq(BootState.INIT_THRD)
            with m.Case(BootState.INIT_THRD):
                m.d.sync += boot_state_reg.eq(BootState.LOAD_NUC)
            with m.Case(BootState.LOAD_NUC):
                m.d.sync += boot_state_reg.eq(BootState.COMPLETE)
            with m.Case(BootState.COMPLETE):
                m.d.sync += boot_state_reg.eq(BootState.COMPLETE)

        m.d.comb += [
            u_decoder.instruction.eq(self.imem_data),
            u_decoder.instr_valid.eq(self.imem_valid & self.boot_complete),
        ]

        is_church_op = u_decoder.is_church_op
        is_ctmm_op = u_decoder.is_ctmm_op
        church_op = u_decoder.church_op
        cr_src = u_decoder.cr_src
        cr_dst = u_decoder.cr_dst
        cap_index = u_decoder.cap_index
        switch_target = u_decoder.switch_target

        exec_enable = Signal()
        m.d.comb += exec_enable.eq(self.boot_complete & self.imem_valid)

        lambda_start_sig = Signal()
        m.d.comb += lambda_start_sig.eq(
            exec_enable & is_church_op & (church_op == ChurchOpcode.LAMBDA)
        )

        tperm_start_sig = Signal()
        call_start_sig = Signal()
        ret_start_sig = Signal()

        m.d.comb += u_regs.cr_rd_addr.eq(
            Mux(lambda_start_sig | u_lambda.lambda_busy, u_lambda.cr_rd_addr,
                Mux(u_tperm.tperm_busy, u_tperm.cr_rd_addr,
                    Mux(u_call.call_busy, u_call.cr_rd_addr,
                        Mux(u_return.busy, u_return.cr_rd_addr,
                            Mux(u_save.save_busy, u_save.cr_rd_addr,
                                cr_src)))))
        )

        perm_gt_sig = Signal(GT_LAYOUT)
        m.d.comb += perm_gt_sig.eq(View(CAP_REG_LAYOUT, u_regs.cr_rd_data).word0_gt)

        required_perms = Signal(6)
        with m.Switch(church_op):
            with m.Case(ChurchOpcode.LOAD):
                m.d.comb += required_perms.eq(PERM_MASK_L)
            with m.Case(ChurchOpcode.SAVE):
                m.d.comb += required_perms.eq(PERM_MASK_S)
            with m.Case(ChurchOpcode.CALL):
                m.d.comb += required_perms.eq(PERM_MASK_E)
            with m.Case(ChurchOpcode.SWITCH):
                m.d.comb += required_perms.eq(PERM_MASK_L)
            with m.Case(ChurchOpcode.CHANGE):
                m.d.comb += required_perms.eq(PERM_MASK_L)
            with m.Case(ChurchOpcode.LAMBDA):
                m.d.comb += required_perms.eq(PERM_MASK_X)
            with m.Default():
                m.d.comb += required_perms.eq(0)

        m.d.comb += [
            u_perm.gt_in.eq(perm_gt_sig),
            u_perm.required_perms.eq(required_perms),
            u_perm.check_valid.eq(exec_enable & is_church_op),
            u_perm.check_domain_purity.eq(
                exec_enable & is_church_op & (church_op == ChurchOpcode.TPERM)
            ),
        ]

        all_checks_pass = u_perm.all_checks_pass

        m.d.comb += [
            u_gc.gc_start.eq(self.gc_start),
            u_gc.gc_mark_en.eq(1),
            u_gc.gc_sweep_en.eq(1),
            u_gc.ns_start_index.eq(0),
            u_gc.ns_end_index.eq(0x1000),
            u_gc.ns_rd_data.eq(self.ns_rd_data),
        ]

        m.d.comb += [
            self.gc_busy.eq(u_gc.gc_busy),
            self.gc_garbage_count.eq(u_gc.garbage_count),
        ]

        cr_rd_data_gt = Signal(GT_LAYOUT)
        m.d.comb += cr_rd_data_gt.eq(View(CAP_REG_LAYOUT, u_regs.cr_rd_data).word0_gt)

        m.d.comb += [
            self.clist_addr.eq(0),
            self.clist_rd_en.eq(0),
            self.clist_wr_data.eq(cr_rd_data_gt),
            self.clist_wr_en.eq(0),
        ]

        m.d.comb += [
            u_regs.xr_rd_addr1.eq(u_decoder.rs1),
            u_regs.xr_rd_addr2.eq(u_decoder.rs2),
        ]

        xr_wr_data = Signal(32)
        xr_wr_en = Signal()
        flags_in = Signal(COND_FLAGS_LAYOUT)
        flags_wr_en = Signal()
        flags_in_view = View(COND_FLAGS_LAYOUT, flags_in)

        alu_a = Signal(32)
        alu_b = Signal(32)
        alu_result = Signal(33)

        m.d.comb += alu_a.eq(u_regs.xr_rd_data1)

        rs1_val = u_regs.xr_rd_data1
        rs2_val = u_regs.xr_rd_data2
        imm_i = u_decoder.imm_i
        imm_s = u_decoder.imm_s
        imm_b = u_decoder.imm_b
        imm_u = u_decoder.imm_u
        imm_j = u_decoder.imm_j
        opcode = u_decoder.ctmm_opcode
        funct3 = u_decoder.funct3
        funct7 = u_decoder.funct7
        rd = u_decoder.rd
        rs1 = u_decoder.rs1

        branch_taken = Signal()
        branch_target = Signal(32)
        jump_taken = Signal()
        jump_target = Signal(32)

        dmem_addr_computed = Signal(32)
        dmem_rd_en_sig = Signal()
        dmem_wr_en_sig = Signal()
        dmem_wr_data_sig = Signal(32)

        with m.If(exec_enable & is_ctmm_op):
            with m.Switch(opcode):
                with m.Case(CTMMOpcode.LUI):
                    m.d.comb += [xr_wr_data.eq(imm_u), xr_wr_en.eq(1)]

                with m.Case(CTMMOpcode.AUIPC):
                    m.d.comb += [xr_wr_data.eq(nia_reg + imm_u), xr_wr_en.eq(1)]

                with m.Case(CTMMOpcode.JAL):
                    m.d.comb += [
                        xr_wr_data.eq(nia_reg + 4),
                        xr_wr_en.eq(1),
                        jump_taken.eq(1),
                        jump_target.eq(nia_reg + imm_j),
                    ]

                with m.Case(CTMMOpcode.JALR):
                    m.d.comb += [
                        xr_wr_data.eq(nia_reg + 4),
                        xr_wr_en.eq(1),
                        jump_taken.eq(1),
                        jump_target.eq((rs1_val + imm_i) & ~1),
                    ]

                with m.Case(CTMMOpcode.BRANCH):
                    m.d.comb += branch_target.eq(nia_reg + imm_b)
                    rs1_s = Signal(signed(32))
                    rs2_s = Signal(signed(32))
                    m.d.comb += [rs1_s.eq(rs1_val), rs2_s.eq(rs2_val)]
                    with m.Switch(funct3):
                        with m.Case(CTMMFunct3Branch.BEQ):
                            m.d.comb += branch_taken.eq(rs1_val == rs2_val)
                        with m.Case(CTMMFunct3Branch.BNE):
                            m.d.comb += branch_taken.eq(rs1_val != rs2_val)
                        with m.Case(CTMMFunct3Branch.BLT):
                            m.d.comb += branch_taken.eq(rs1_s < rs2_s)
                        with m.Case(CTMMFunct3Branch.BGE):
                            m.d.comb += branch_taken.eq(rs1_s >= rs2_s)
                        with m.Case(CTMMFunct3Branch.BLTU):
                            m.d.comb += branch_taken.eq(rs1_val < rs2_val)
                        with m.Case(CTMMFunct3Branch.BGEU):
                            m.d.comb += branch_taken.eq(rs1_val >= rs2_val)

                with m.Case(CTMMOpcode.LOAD):
                    m.d.comb += [
                        dmem_addr_computed.eq(rs1_val + imm_i),
                        dmem_rd_en_sig.eq(1),
                    ]
                    with m.Switch(funct3):
                        with m.Case(CTMMFunct3Load.LW):
                            m.d.comb += [xr_wr_data.eq(self.dmem_rd_data), xr_wr_en.eq(1)]
                        with m.Case(CTMMFunct3Load.LH):
                            half_val = Signal(signed(16))
                            sign_ext_h = Signal(signed(32))
                            m.d.comb += half_val.eq(self.dmem_rd_data[:16])
                            m.d.comb += sign_ext_h.eq(half_val)
                            m.d.comb += [xr_wr_data.eq(sign_ext_h), xr_wr_en.eq(1)]
                        with m.Case(CTMMFunct3Load.LB):
                            byte_val = Signal(signed(8))
                            sign_ext_b = Signal(signed(32))
                            m.d.comb += byte_val.eq(self.dmem_rd_data[:8])
                            m.d.comb += sign_ext_b.eq(byte_val)
                            m.d.comb += [xr_wr_data.eq(sign_ext_b), xr_wr_en.eq(1)]
                        with m.Case(CTMMFunct3Load.LHU):
                            m.d.comb += [xr_wr_data.eq(self.dmem_rd_data[:16]), xr_wr_en.eq(1)]
                        with m.Case(CTMMFunct3Load.LBU):
                            m.d.comb += [xr_wr_data.eq(self.dmem_rd_data[:8]), xr_wr_en.eq(1)]

                with m.Case(CTMMOpcode.STORE):
                    m.d.comb += [
                        dmem_addr_computed.eq(rs1_val + imm_s),
                        dmem_wr_en_sig.eq(1),
                    ]
                    with m.Switch(funct3):
                        with m.Case(CTMMFunct3Store.SW):
                            m.d.comb += dmem_wr_data_sig.eq(rs2_val)
                        with m.Case(CTMMFunct3Store.SH):
                            m.d.comb += dmem_wr_data_sig.eq(rs2_val[:16])
                        with m.Case(CTMMFunct3Store.SB):
                            m.d.comb += dmem_wr_data_sig.eq(rs2_val[:8])

                with m.Case(CTMMOpcode.ARITHI):
                    imm_ext = Signal(32)
                    m.d.comb += imm_ext.eq(imm_i)
                    with m.Switch(funct3):
                        with m.Case(CTMMFunct3ArithI.ADDI):
                            m.d.comb += alu_result.eq(rs1_val + imm_ext)
                            m.d.comb += [xr_wr_data.eq(alu_result[:32]), xr_wr_en.eq(1)]
                            m.d.comb += [
                                flags_in_view.N.eq(alu_result[31]),
                                flags_in_view.Z.eq(alu_result[:32] == 0),
                                flags_in_view.C.eq(alu_result[32]),
                                flags_wr_en.eq(1),
                            ]
                        with m.Case(CTMMFunct3ArithI.SLTI):
                            rs1_s_i = Signal(signed(32))
                            imm_s_i = Signal(signed(32))
                            m.d.comb += [rs1_s_i.eq(rs1_val), imm_s_i.eq(imm_ext)]
                            m.d.comb += [xr_wr_data.eq(Mux(rs1_s_i < imm_s_i, 1, 0)), xr_wr_en.eq(1)]
                        with m.Case(CTMMFunct3ArithI.SLTIU):
                            m.d.comb += [xr_wr_data.eq(Mux(rs1_val < imm_ext, 1, 0)), xr_wr_en.eq(1)]
                        with m.Case(CTMMFunct3ArithI.XORI):
                            m.d.comb += [xr_wr_data.eq(rs1_val ^ imm_ext), xr_wr_en.eq(1)]
                        with m.Case(CTMMFunct3ArithI.ORI):
                            m.d.comb += [xr_wr_data.eq(rs1_val | imm_ext), xr_wr_en.eq(1)]
                        with m.Case(CTMMFunct3ArithI.ANDI):
                            m.d.comb += [xr_wr_data.eq(rs1_val & imm_ext), xr_wr_en.eq(1)]
                        with m.Case(CTMMFunct3ArithI.SLLI):
                            shamt = Signal(5)
                            m.d.comb += shamt.eq(imm_i[:5])
                            m.d.comb += [xr_wr_data.eq(rs1_val << shamt), xr_wr_en.eq(1)]
                        with m.Case(CTMMFunct3ArithI.SRLI):
                            shamt_r = Signal(5)
                            m.d.comb += shamt_r.eq(imm_i[:5])
                            with m.If(funct7[5]):
                                rs1_signed = Signal(signed(32))
                                m.d.comb += rs1_signed.eq(rs1_val)
                                m.d.comb += [xr_wr_data.eq(rs1_signed >> shamt_r), xr_wr_en.eq(1)]
                            with m.Else():
                                m.d.comb += [xr_wr_data.eq(rs1_val >> shamt_r), xr_wr_en.eq(1)]

                with m.Case(CTMMOpcode.ARITH):
                    with m.Switch(funct3):
                        with m.Case(CTMMFunct3Arith.ADD):
                            with m.If(funct7[5]):
                                m.d.comb += alu_result.eq(rs1_val - rs2_val)
                            with m.Else():
                                m.d.comb += alu_result.eq(rs1_val + rs2_val)
                            m.d.comb += [xr_wr_data.eq(alu_result[:32]), xr_wr_en.eq(1)]
                            m.d.comb += [
                                flags_in_view.N.eq(alu_result[31]),
                                flags_in_view.Z.eq(alu_result[:32] == 0),
                                flags_in_view.C.eq(alu_result[32]),
                                flags_wr_en.eq(1),
                            ]
                        with m.Case(CTMMFunct3Arith.SLL):
                            m.d.comb += [xr_wr_data.eq(rs1_val << rs2_val[:5]), xr_wr_en.eq(1)]
                        with m.Case(CTMMFunct3Arith.SLT):
                            rs1_s_r = Signal(signed(32))
                            rs2_s_r = Signal(signed(32))
                            m.d.comb += [rs1_s_r.eq(rs1_val), rs2_s_r.eq(rs2_val)]
                            m.d.comb += [xr_wr_data.eq(Mux(rs1_s_r < rs2_s_r, 1, 0)), xr_wr_en.eq(1)]
                        with m.Case(CTMMFunct3Arith.SLTU):
                            m.d.comb += [xr_wr_data.eq(Mux(rs1_val < rs2_val, 1, 0)), xr_wr_en.eq(1)]
                        with m.Case(CTMMFunct3Arith.XOR):
                            m.d.comb += [xr_wr_data.eq(rs1_val ^ rs2_val), xr_wr_en.eq(1)]
                        with m.Case(CTMMFunct3Arith.SRL):
                            with m.If(funct7[5]):
                                rs1_sr = Signal(signed(32))
                                m.d.comb += rs1_sr.eq(rs1_val)
                                m.d.comb += [xr_wr_data.eq(rs1_sr >> rs2_val[:5]), xr_wr_en.eq(1)]
                            with m.Else():
                                m.d.comb += [xr_wr_data.eq(rs1_val >> rs2_val[:5]), xr_wr_en.eq(1)]
                        with m.Case(CTMMFunct3Arith.OR):
                            m.d.comb += [xr_wr_data.eq(rs1_val | rs2_val), xr_wr_en.eq(1)]
                        with m.Case(CTMMFunct3Arith.AND):
                            m.d.comb += [xr_wr_data.eq(rs1_val & rs2_val), xr_wr_en.eq(1)]

                with m.Case(CTMMOpcode.FENCE):
                    pass

                with m.Case(CTMMOpcode.SYSTEM):
                    pass

        m.d.comb += [
            self.dmem_addr.eq(dmem_addr_computed),
            self.dmem_rd_en.eq(dmem_rd_en_sig),
            self.dmem_wr_data.eq(dmem_wr_data_sig),
            self.dmem_wr_en.eq(dmem_wr_en_sig),
        ]

        m.d.comb += [
            u_regs.xr_wr_addr.eq(rd),
            u_regs.xr_wr_data.eq(xr_wr_data),
            u_regs.xr_wr_en.eq(xr_wr_en),
            u_regs.flags_in.eq(flags_in),
            u_regs.flags_wr_en.eq(flags_wr_en),
            u_regs.clear_all.eq(clear_all),
        ]

        m.d.comb += [
            u_regs.cr_wr_addr.eq(
                Mux(u_tperm.tperm_busy, u_tperm.cr_wr_addr,
                    Mux(u_call.call_busy, u_call.cr_wr_addr,
                        Mux(u_return.busy, u_return.cr_wr_addr, 0)))
            ),
            u_regs.cr_wr_data.eq(
                Mux(u_tperm.tperm_busy, u_tperm.cr_wr_data,
                    Mux(u_call.call_busy, u_call.cr_wr_data,
                        Mux(u_return.busy, u_return.cr_wr_data, 0)))
            ),
            u_regs.cr_wr_en.eq(
                u_tperm.cr_wr_en | u_call.cr_wr_en | u_return.cr_wr_en
            ),
        ]

        with m.If(clear_all):
            m.d.sync += nia_reg.eq(0)
        with m.Elif(u_lambda.nia_set):
            m.d.sync += nia_reg.eq(u_lambda.nia_value)
        with m.Elif(u_return.nia_set):
            m.d.sync += nia_reg.eq(u_return.nia_value)
        with m.Elif(u_call.nia_set):
            m.d.sync += nia_reg.eq(u_call.nia_value)
        with m.Elif(jump_taken):
            m.d.sync += nia_reg.eq(jump_target)
        with m.Elif(branch_taken):
            m.d.sync += nia_reg.eq(branch_target)
        with m.Elif(exec_enable):
            m.d.sync += nia_reg.eq(nia_reg + 4)

        m.d.comb += [
            self.imem_addr.eq(nia_reg),
            self.nia.eq(nia_reg),
            self.flags.eq(u_regs.flags),
        ]

        boot_wr_en = [Signal(name=f"boot_cr{i}_wr_en") for i in range(16)]
        boot_wr_gt = [Signal(GT_LAYOUT, name=f"boot_cr{i}_wr_gt") for i in range(16)]

        with m.Switch(boot_state_reg):
            with m.Case(BootState.LOAD_NS):
                ns_gt = Signal(GT_LAYOUT)
                ns_gt_view = View(GT_LAYOUT, ns_gt)
                m.d.comb += [
                    ns_gt_view.index.eq(0),
                    ns_gt_view.version.eq(0),
                    ns_gt_view.gt_type.eq(GT_TYPE_INFORM),
                    ns_gt_view.perms.eq(0),
                ]
                m.d.comb += [boot_wr_en[15].eq(1), boot_wr_gt[15].eq(ns_gt)]
            with m.Case(BootState.INIT_THRD):
                thrd_gt = Signal(GT_LAYOUT)
                thrd_gt_view = View(GT_LAYOUT, thrd_gt)
                m.d.comb += [
                    thrd_gt_view.index.eq(3),
                    thrd_gt_view.version.eq(0),
                    thrd_gt_view.gt_type.eq(GT_TYPE_INFORM),
                    thrd_gt_view.perms.eq(0),
                ]
                m.d.comb += [boot_wr_en[8].eq(1), boot_wr_gt[8].eq(thrd_gt)]
            with m.Case(BootState.LOAD_NUC):
                cr6_gt = Signal(GT_LAYOUT)
                cr6_gt_view = View(GT_LAYOUT, cr6_gt)
                m.d.comb += [
                    cr6_gt_view.index.eq(2),
                    cr6_gt_view.version.eq(0),
                    cr6_gt_view.gt_type.eq(GT_TYPE_INFORM),
                    cr6_gt_view.perms.eq(PERM_MASK_E),
                ]
                m.d.comb += [boot_wr_en[6].eq(1), boot_wr_gt[6].eq(cr6_gt)]

                cr7_gt = Signal(GT_LAYOUT)
                cr7_gt_view = View(GT_LAYOUT, cr7_gt)
                m.d.comb += [
                    cr7_gt_view.index.eq(1),
                    cr7_gt_view.version.eq(0),
                    cr7_gt_view.gt_type.eq(GT_TYPE_INFORM),
                    cr7_gt_view.perms.eq(PERM_MASK_X),
                ]
                m.d.comb += [boot_wr_en[7].eq(1), boot_wr_gt[7].eq(cr7_gt)]

                cr5_gt = Signal(GT_LAYOUT)
                cr5_gt_view = View(GT_LAYOUT, cr5_gt)
                m.d.comb += [
                    cr5_gt_view.index.eq(4),
                    cr5_gt_view.version.eq(0),
                    cr5_gt_view.gt_type.eq(GT_TYPE_INFORM),
                    cr5_gt_view.perms.eq(PERM_MASK_L | PERM_MASK_S),
                ]
                m.d.comb += [boot_wr_en[5].eq(1), boot_wr_gt[5].eq(cr5_gt)]

        runtime_wr_en = [Signal(name=f"rt_cr{i}_wr_en") for i in range(16)]
        runtime_wr_gt = [Signal(GT_LAYOUT, name=f"rt_cr{i}_wr_gt") for i in range(16)]

        switch_change_active = Signal()
        m.d.comb += switch_change_active.eq(
            self.boot_complete & exec_enable & is_church_op & all_checks_pass &
            ((church_op == ChurchOpcode.SWITCH) | (church_op == ChurchOpcode.CHANGE))
        )

        switch_src_gt = Signal(GT_LAYOUT)
        m.d.comb += switch_src_gt.eq(cr_rd_data_gt)

        effective_target = Signal(3)
        m.d.comb += effective_target.eq(Mux(church_op == ChurchOpcode.CHANGE, 0, switch_target[:3]))

        with m.If(switch_change_active):
            for i in range(8):
                with m.If(effective_target == i):
                    m.d.comb += [runtime_wr_en[8 + i].eq(1), runtime_wr_gt[8 + i].eq(switch_src_gt)]

        for i in range(16):
            m.d.comb += [
                u_regs.cr_gt_wr_en[i].eq(boot_wr_en[i] | runtime_wr_en[i]),
                u_regs.cr_gt_wr_data[i].eq(Mux(boot_wr_en[i], boot_wr_gt[i], runtime_wr_gt[i])),
            ]

        m.d.comb += call_start_sig.eq(
            exec_enable & is_church_op & (church_op == ChurchOpcode.CALL) & all_checks_pass
        )
        m.d.comb += [
            u_call.call_start.eq(call_start_sig),
            u_call.cr_src.eq(cr_src),
            u_call.index.eq(cap_index),
            u_call.mask.eq(u_decoder.call_mask),
            u_call.cr_rd_data.eq(u_regs.cr_rd_data),
            u_call.cr15_namespace.eq(u_regs.cr15_namespace),
            u_call.mem_rd_data.eq(self.dmem_rd_data),
            u_call.mem_rd_valid.eq(1),
        ]

        m.d.comb += ret_start_sig.eq(
            exec_enable & is_church_op & (church_op == ChurchOpcode.RETURN) & all_checks_pass
        )
        m.d.comb += [
            u_return.return_start.eq(ret_start_sig),
            u_return.cr_src.eq(cr_src[:3]),
            u_return.cr_rd_data.eq(u_regs.cr_rd_data),
            u_return.cr15_namespace.eq(u_regs.cr15_namespace),
            u_return.mem_rd_data.eq(self.dmem_rd_data),
            u_return.mem_rd_valid.eq(1),
        ]

        m.d.comb += [
            u_lambda.lambda_start.eq(lambda_start_sig),
            u_lambda.cr_target.eq(cr_dst),
            u_lambda.cr_rd_data.eq(u_regs.cr_rd_data),
            u_lambda.saved_nia.eq(nia_reg + 4),
        ]

        m.d.comb += tperm_start_sig.eq(
            exec_enable & is_church_op & (church_op == ChurchOpcode.TPERM) & all_checks_pass
        )
        m.d.comb += [
            u_tperm.tperm_start.eq(tperm_start_sig),
            u_tperm.cr_target.eq(cr_dst),
            u_tperm.preset.eq(u_decoder.tperm_preset),
            u_tperm.cr_rd_data.eq(u_regs.cr_rd_data),
        ]

        save_start_sig = Signal()
        m.d.comb += save_start_sig.eq(
            exec_enable & is_church_op & (church_op == ChurchOpcode.SAVE) & all_checks_pass
        )
        m.d.comb += [
            u_save.save_start.eq(save_start_sig),
            u_save.cr_src.eq(cr_src),
            u_save.cr_dst.eq(cr_dst),
            u_save.index.eq(cap_index),
            u_save.cr_rd_data.eq(u_regs.cr_rd_data),
            u_save.cr15_namespace.eq(u_regs.cr15_namespace),
            u_save.mem_wr_done.eq(1),
        ]

        CR5_STACK_DEPTH = 256
        cr5_stack = Memory(width=32, depth=CR5_STACK_DEPTH, init=[])
        m.submodules.cr5_stack = cr5_stack
        cr5_stack_ptr = Signal(8, init=0)
        cr5_stack_empty = Signal()
        cr5_stack_full = Signal()
        cr5_stack_wr = cr5_stack.write_port()
        cr5_stack_rd = cr5_stack.read_port(transparent=True)

        m.d.comb += [
            cr5_stack_empty.eq(cr5_stack_ptr == 0),
            cr5_stack_full.eq(cr5_stack_ptr == CR5_STACK_DEPTH),
            cr5_stack_rd.addr.eq(Mux(cr5_stack_ptr > 0, cr5_stack_ptr - 1, 0)),
            u_return.saved_cr5_gt.eq(Mux(cr5_stack_empty, 0, cr5_stack_rd.data)),
            cr5_stack_wr.addr.eq(0),
            cr5_stack_wr.data.eq(0),
            cr5_stack_wr.en.eq(0),
        ]

        with m.If(u_call.call_complete & ~u_call.call_fault & ~cr5_stack_full):
            m.d.comb += [
                cr5_stack_wr.addr.eq(cr5_stack_ptr),
                cr5_stack_wr.data.eq(u_call.saved_cr5_gt),
                cr5_stack_wr.en.eq(1),
            ]
            m.d.sync += cr5_stack_ptr.eq(cr5_stack_ptr + 1)
        with m.Elif(u_return.complete & ~u_return.fault_valid & ~cr5_stack_empty):
            m.d.sync += cr5_stack_ptr.eq(cr5_stack_ptr - 1)

        with m.If(u_decoder.fault_valid):
            m.d.comb += [self.fault.eq(u_decoder.fault), self.fault_valid.eq(1)]
        with m.Elif(u_perm.fault_valid):
            m.d.comb += [self.fault.eq(u_perm.fault_type), self.fault_valid.eq(1)]
        with m.Elif(u_lambda.lambda_fault):
            m.d.comb += [self.fault.eq(u_lambda.fault_type), self.fault_valid.eq(1)]
        with m.Elif(u_tperm.tperm_fault):
            m.d.comb += [self.fault.eq(u_tperm.fault_type), self.fault_valid.eq(1)]
        with m.Elif(u_call.call_fault):
            m.d.comb += [self.fault.eq(u_call.fault_type), self.fault_valid.eq(1)]
        with m.Elif(u_return.fault_valid):
            m.d.comb += [self.fault.eq(u_return.fault_type), self.fault_valid.eq(1)]
        with m.Elif(u_save.save_fault):
            m.d.comb += [self.fault.eq(u_save.fault_type), self.fault_valid.eq(1)]
        with m.Else():
            m.d.comb += [self.fault.eq(FaultType.NONE), self.fault_valid.eq(0)]

        with m.If(u_gc.gc_busy):
            m.d.comb += [
                self.ns_addr.eq(u_gc.ns_addr),
                self.ns_rd_en.eq(u_gc.ns_rd_en),
                self.ns_wr_data.eq(u_gc.ns_wr_data),
                self.ns_wr_en.eq(u_gc.ns_wr_en),
            ]
        with m.Else():
            m.d.comb += [
                self.ns_addr.eq(0),
                self.ns_rd_en.eq(0),
                self.ns_wr_data.eq(0),
                self.ns_wr_en.eq(0),
            ]

        return m
