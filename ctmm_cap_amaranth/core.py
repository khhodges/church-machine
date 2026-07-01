from amaranth import *
from amaranth.lib.data import View

from .types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT, COND_FLAGS_LAYOUT, SEALS_LAYOUT
from hardware.integrity32 import integrity32_amaranth, integrity32
from hardware.hw_types import IRQ_REASON_LAZY_RESOLVE, SCHEDULER_IRQ_NS_SLOT
from .registers import CMCapRegisters
from .decoder import CMCapDecoder
from .perm_check import CMCapPermCheck
from .gc_unit import CMCapGCUnit
from .lambda_unit import CMCapLambda
from .call import CMCapCall
from .ret import CMCapReturn
from .tperm import CMCapTperm
from .save import CMCapSave


class CMCapCore(Elaboratable):
    def __init__(self):
        self.imem_addr = Signal(32)
        self.imem_data = Signal(32)
        self.imem_valid = Signal()

        # M-window ports
        # cr15_m_set:              trigger M-set (copy CR15→XR11-XR14, set M=1)
        # cr15_m_writeback_trigger: act like call_complete/return_complete for M-window FSM
        # cr15_m_flag:             current M-flag state (output, combinatorial)
        # dbg_m_xr11..14:         combinatorial read of the M-window XRs (for testbench)
        self.cr15_m_set               = Signal()
        self.cr15_m_writeback_trigger = Signal()
        self.cr15_m_flag              = Signal()
        self.dbg_m_xr11               = Signal(32)
        self.dbg_m_xr12               = Signal(32)
        self.dbg_m_xr13               = Signal(32)
        self.dbg_m_xr14               = Signal(32)
        self.dbg_m_xr15               = Signal(32)

        # Direct cap-register write port (testbench only — pre-load a cap register)
        self.dbg_cap_wr_en   = Signal()
        self.dbg_cap_wr_addr = Signal(4)
        self.dbg_cap_wr_data = Signal(CAP_REG_LAYOUT)

        # CHANGE M-flag restore (test-access; in hardware routed from u_change outputs)
        self.m_flag_restore_en        = Signal()
        self.m_flag_restore_val       = Signal()

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

        # ELOADCALL lazy-resolve IRQ dispatch outputs.
        # irq_valid is asserted for one cycle when an ELOADCALL fires after perm check passes.
        # irq_reason = IRQ_REASON_LAZY_RESOLVE; irq_ns_slot = SCHEDULER_IRQ_NS_SLOT (8).
        # irq_dr1 = c-list row (5 bits, rs2 field); irq_method_index = funct7 field (7 bits).
        self.irq_valid        = Signal()
        self.irq_reason       = Signal(4)
        self.irq_ns_slot      = Signal(8)
        self.irq_dr1          = Signal(5)
        self.irq_method_index = Signal(7)

        # XLOADLAMBDA lambda-body-loader dispatch outputs.
        # xloadlambda_valid is asserted for one cycle when XLOADLAMBDA fires after perm check.
        # xloadlambda_index = cap_index (lambda body offset) from the instruction.
        self.xloadlambda_valid = Signal()
        self.xloadlambda_index = Signal(12)

    def elaborate(self, platform):
        m = Module()

        u_regs = CMCapRegisters()
        u_decoder = CMCapDecoder()
        u_perm = CMCapPermCheck()
        u_gc = CMCapGCUnit()
        u_lambda = CMCapLambda()
        u_call = CMCapCall()
        u_return = CMCapReturn()
        u_tperm = CMCapTperm()
        u_save = CMCapSave()
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
        mwin_busy   = Signal()
        m.d.comb += exec_enable.eq(self.boot_complete & self.imem_valid & ~mwin_busy)

        # Declared here (before NIA chain) so the NIA Elif branch can reference them.
        # Combinatorial assignments are filled in later alongside the XLOADLAMBDA dispatch.
        xloadlambda_fire = Signal()
        xloadlambda_nia  = Signal(32)

        lambda_start_sig = Signal()
        m.d.comb += lambda_start_sig.eq(
            exec_enable & is_church_op & (church_op == ChurchOpcode.LAMBDA)
        )

        # ELOADCALL: E-perm check on CR_CLIST (CR6); fires lazy-resolve IRQ to Scheduler.
        # XLOADLAMBDA: X-perm check on CR_CLOOMC (CR14); fires lambda-body-loader dispatch.
        eloadcall_start_sig   = Signal()
        xloadlambda_start_sig = Signal()
        m.d.comb += eloadcall_start_sig.eq(
            exec_enable & is_church_op & (church_op == ChurchOpcode.ELOADCALL)
        )
        m.d.comb += xloadlambda_start_sig.eq(
            exec_enable & is_church_op & (church_op == ChurchOpcode.XLOADLAMBDA)
        )

        tperm_start_sig = Signal()
        call_start_sig = Signal()
        ret_start_sig = Signal()

        # cr_rd_addr mux: ELOADCALL always checks CR_CLIST; XLOADLAMBDA always checks
        # CR_CLOOMC, regardless of what cr_src the instruction encodes.
        m.d.comb += u_regs.cr_rd_addr.eq(
            Mux(lambda_start_sig | u_lambda.lambda_busy, u_lambda.cr_rd_addr,
                Mux(u_tperm.tperm_busy, u_tperm.cr_rd_addr,
                    Mux(u_call.call_busy, u_call.cr_rd_addr,
                        Mux(u_return.busy, u_return.cr_rd_addr,
                            Mux(u_save.save_busy, u_save.cr_rd_addr,
                                Mux(eloadcall_start_sig, CR_CLIST,
                                    Mux(xloadlambda_start_sig, CR_CLOOMC,
                                        cr_src)))))))
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
                # Abstract GTs bypass E-perm: the call FSM dispatches to M_FETCH_NS.
                perm_gt_view = View(GT_LAYOUT, perm_gt_sig)
                with m.If(perm_gt_view.gt_type == GT_TYPE_ABSTRACT):
                    m.d.comb += required_perms.eq(0)
                with m.Else():
                    m.d.comb += required_perms.eq(PERM_MASK_E)
            with m.Case(ChurchOpcode.SWITCH):
                m.d.comb += required_perms.eq(PERM_MASK_L)
            with m.Case(ChurchOpcode.CHANGE):
                m.d.comb += required_perms.eq(PERM_MASK_L)
            with m.Case(ChurchOpcode.LAMBDA):
                m.d.comb += required_perms.eq(PERM_MASK_X)
            with m.Case(ChurchOpcode.ELOADCALL):
                # E-perm on CR_CLIST (CR6): authority to execute an entry in the c-list.
                # cr_rd_addr mux routes to CR_CLIST for this opcode.
                m.d.comb += required_perms.eq(PERM_MASK_E)
            with m.Case(ChurchOpcode.XLOADLAMBDA):
                # X-perm on CR_CLOOMC (CR14): authority to load and jump to a lambda body.
                # cr_rd_addr mux routes to CR_CLOOMC for this opcode.
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

        # Forward-declare IRQ fire signals here so the NIA stall path (below) can reference them.
        eloadcall_fire = Signal()
        m.d.comb += eloadcall_fire.eq(
            exec_enable & is_church_op & (church_op == ChurchOpcode.ELOADCALL) & all_checks_pass
        )
        xloadlambda_fire = Signal()
        m.d.comb += xloadlambda_fire.eq(
            exec_enable & is_church_op & (church_op == ChurchOpcode.XLOADLAMBDA) & all_checks_pass
        )

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
                with m.Case(CMOpcode.LUI):
                    m.d.comb += [xr_wr_data.eq(imm_u), xr_wr_en.eq(1)]

                with m.Case(CMOpcode.AUIPC):
                    m.d.comb += [xr_wr_data.eq(nia_reg + imm_u), xr_wr_en.eq(1)]

                with m.Case(CMOpcode.JAL):
                    m.d.comb += [
                        xr_wr_data.eq(nia_reg + 4),
                        xr_wr_en.eq(1),
                        jump_taken.eq(1),
                        jump_target.eq(nia_reg + imm_j),
                    ]

                with m.Case(CMOpcode.JALR):
                    m.d.comb += [
                        xr_wr_data.eq(nia_reg + 4),
                        xr_wr_en.eq(1),
                        jump_taken.eq(1),
                        jump_target.eq((rs1_val + imm_i) & ~1),
                    ]

                with m.Case(CMOpcode.BRANCH):
                    m.d.comb += branch_target.eq(nia_reg + imm_b)
                    rs1_s = Signal(signed(32))
                    rs2_s = Signal(signed(32))
                    m.d.comb += [rs1_s.eq(rs1_val), rs2_s.eq(rs2_val)]
                    with m.Switch(funct3):
                        with m.Case(CMFunct3Branch.BEQ):
                            m.d.comb += branch_taken.eq(rs1_val == rs2_val)
                        with m.Case(CMFunct3Branch.BNE):
                            m.d.comb += branch_taken.eq(rs1_val != rs2_val)
                        with m.Case(CMFunct3Branch.BLT):
                            m.d.comb += branch_taken.eq(rs1_s < rs2_s)
                        with m.Case(CMFunct3Branch.BGE):
                            m.d.comb += branch_taken.eq(rs1_s >= rs2_s)
                        with m.Case(CMFunct3Branch.BLTU):
                            m.d.comb += branch_taken.eq(rs1_val < rs2_val)
                        with m.Case(CMFunct3Branch.BGEU):
                            m.d.comb += branch_taken.eq(rs1_val >= rs2_val)

                with m.Case(CMOpcode.LOAD):
                    m.d.comb += [
                        dmem_addr_computed.eq(rs1_val + imm_i),
                        dmem_rd_en_sig.eq(1),
                    ]
                    with m.Switch(funct3):
                        with m.Case(CMFunct3Load.LW):
                            m.d.comb += [xr_wr_data.eq(self.dmem_rd_data), xr_wr_en.eq(1)]
                        with m.Case(CMFunct3Load.LH):
                            half_val = Signal(signed(16))
                            sign_ext_h = Signal(signed(32))
                            m.d.comb += half_val.eq(self.dmem_rd_data[:16])
                            m.d.comb += sign_ext_h.eq(half_val)
                            m.d.comb += [xr_wr_data.eq(sign_ext_h), xr_wr_en.eq(1)]
                        with m.Case(CMFunct3Load.LB):
                            byte_val = Signal(signed(8))
                            sign_ext_b = Signal(signed(32))
                            m.d.comb += byte_val.eq(self.dmem_rd_data[:8])
                            m.d.comb += sign_ext_b.eq(byte_val)
                            m.d.comb += [xr_wr_data.eq(sign_ext_b), xr_wr_en.eq(1)]
                        with m.Case(CMFunct3Load.LHU):
                            m.d.comb += [xr_wr_data.eq(self.dmem_rd_data[:16]), xr_wr_en.eq(1)]
                        with m.Case(CMFunct3Load.LBU):
                            m.d.comb += [xr_wr_data.eq(self.dmem_rd_data[:8]), xr_wr_en.eq(1)]

                with m.Case(CMOpcode.STORE):
                    m.d.comb += [
                        dmem_addr_computed.eq(rs1_val + imm_s),
                        dmem_wr_en_sig.eq(1),
                    ]
                    with m.Switch(funct3):
                        with m.Case(CMFunct3Store.SW):
                            m.d.comb += dmem_wr_data_sig.eq(rs2_val)
                        with m.Case(CMFunct3Store.SH):
                            m.d.comb += dmem_wr_data_sig.eq(rs2_val[:16])
                        with m.Case(CMFunct3Store.SB):
                            m.d.comb += dmem_wr_data_sig.eq(rs2_val[:8])

                with m.Case(CMOpcode.ARITHI):
                    imm_ext = Signal(32)
                    m.d.comb += imm_ext.eq(imm_i)
                    with m.Switch(funct3):
                        with m.Case(CMFunct3ArithI.ADDI):
                            m.d.comb += alu_result.eq(rs1_val + imm_ext)
                            m.d.comb += [xr_wr_data.eq(alu_result[:32]), xr_wr_en.eq(1)]
                            m.d.comb += [
                                flags_in_view.N.eq(alu_result[31]),
                                flags_in_view.Z.eq(alu_result[:32] == 0),
                                flags_in_view.C.eq(alu_result[32]),
                                flags_wr_en.eq(1),
                            ]
                        with m.Case(CMFunct3ArithI.SLTI):
                            rs1_s_i = Signal(signed(32))
                            imm_s_i = Signal(signed(32))
                            m.d.comb += [rs1_s_i.eq(rs1_val), imm_s_i.eq(imm_ext)]
                            m.d.comb += [xr_wr_data.eq(Mux(rs1_s_i < imm_s_i, 1, 0)), xr_wr_en.eq(1)]
                        with m.Case(CMFunct3ArithI.SLTIU):
                            m.d.comb += [xr_wr_data.eq(Mux(rs1_val < imm_ext, 1, 0)), xr_wr_en.eq(1)]
                        with m.Case(CMFunct3ArithI.XORI):
                            m.d.comb += [xr_wr_data.eq(rs1_val ^ imm_ext), xr_wr_en.eq(1)]
                        with m.Case(CMFunct3ArithI.ORI):
                            m.d.comb += [xr_wr_data.eq(rs1_val | imm_ext), xr_wr_en.eq(1)]
                        with m.Case(CMFunct3ArithI.ANDI):
                            m.d.comb += [xr_wr_data.eq(rs1_val & imm_ext), xr_wr_en.eq(1)]
                        with m.Case(CMFunct3ArithI.SLLI):
                            shamt = Signal(5)
                            m.d.comb += shamt.eq(imm_i[:5])
                            m.d.comb += [xr_wr_data.eq(rs1_val << shamt), xr_wr_en.eq(1)]
                        with m.Case(CMFunct3ArithI.SRLI):
                            shamt_r = Signal(5)
                            m.d.comb += shamt_r.eq(imm_i[:5])
                            with m.If(funct7[5]):
                                rs1_signed = Signal(signed(32))
                                m.d.comb += rs1_signed.eq(rs1_val)
                                m.d.comb += [xr_wr_data.eq(rs1_signed >> shamt_r), xr_wr_en.eq(1)]
                            with m.Else():
                                m.d.comb += [xr_wr_data.eq(rs1_val >> shamt_r), xr_wr_en.eq(1)]

                with m.Case(CMOpcode.ARITH):
                    with m.Switch(funct3):
                        with m.Case(CMFunct3Arith.ADD):
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
                        with m.Case(CMFunct3Arith.SLL):
                            m.d.comb += [xr_wr_data.eq(rs1_val << rs2_val[:5]), xr_wr_en.eq(1)]
                        with m.Case(CMFunct3Arith.SLT):
                            rs1_s_r = Signal(signed(32))
                            rs2_s_r = Signal(signed(32))
                            m.d.comb += [rs1_s_r.eq(rs1_val), rs2_s_r.eq(rs2_val)]
                            m.d.comb += [xr_wr_data.eq(Mux(rs1_s_r < rs2_s_r, 1, 0)), xr_wr_en.eq(1)]
                        with m.Case(CMFunct3Arith.SLTU):
                            m.d.comb += [xr_wr_data.eq(Mux(rs1_val < rs2_val, 1, 0)), xr_wr_en.eq(1)]
                        with m.Case(CMFunct3Arith.XOR):
                            m.d.comb += [xr_wr_data.eq(rs1_val ^ rs2_val), xr_wr_en.eq(1)]
                        with m.Case(CMFunct3Arith.SRL):
                            with m.If(funct7[5]):
                                rs1_sr = Signal(signed(32))
                                m.d.comb += rs1_sr.eq(rs1_val)
                                m.d.comb += [xr_wr_data.eq(rs1_sr >> rs2_val[:5]), xr_wr_en.eq(1)]
                            with m.Else():
                                m.d.comb += [xr_wr_data.eq(rs1_val >> rs2_val[:5]), xr_wr_en.eq(1)]
                        with m.Case(CMFunct3Arith.OR):
                            m.d.comb += [xr_wr_data.eq(rs1_val | rs2_val), xr_wr_en.eq(1)]
                        with m.Case(CMFunct3Arith.AND):
                            m.d.comb += [xr_wr_data.eq(rs1_val & rs2_val), xr_wr_en.eq(1)]

                with m.Case(CMOpcode.FENCE):
                    pass

                with m.Case(CMOpcode.SYSTEM):
                    pass

        m.d.comb += [
            self.dmem_addr.eq(dmem_addr_computed),
            self.dmem_rd_en.eq(dmem_rd_en_sig),
            self.dmem_wr_data.eq(dmem_wr_data_sig),
            self.dmem_wr_en.eq(dmem_wr_en_sig),
        ]

        # TPERM completes multiple cycles after dispatch; its Z result is delivered
        # via tperm_z_result when tperm_complete fires.  We merge it into the
        # flags path here using a Mux so only one driver exists for each signal.
        tperm_flags = Signal(COND_FLAGS_LAYOUT)
        tperm_flags_view = View(COND_FLAGS_LAYOUT, tperm_flags)
        m.d.comb += tperm_flags_view.Z.eq(u_tperm.tperm_z_result)

        m.d.comb += [
            u_regs.xr_wr_addr.eq(rd),
            u_regs.xr_wr_data.eq(xr_wr_data),
            u_regs.xr_wr_en.eq(xr_wr_en),
            u_regs.flags_in.eq(Mux(u_tperm.tperm_complete, tperm_flags, flags_in)),
            u_regs.flags_wr_en.eq(flags_wr_en | u_tperm.tperm_complete),
            u_regs.clear_all.eq(clear_all),
        ]

        # M-window FSM CR-write signals (wired below in the FSM; declared here for scope)
        mwin_cr_wr_en   = Signal()
        mwin_cr_wr_data = Signal(CAP_REG_LAYOUT)
        mwin_m_clear_en = Signal()
        mwin_fault_sig  = Signal()
        mwin_fault_type = Signal(4)

        # Unconditional defaults — ensures no latch inference in synthesis.
        # FSM states selectively override these via m.d.comb += within each state.
        m.d.comb += [
            mwin_cr_wr_en.eq(0),
            mwin_cr_wr_data.eq(0),
            mwin_m_clear_en.eq(0),
            mwin_fault_sig.eq(0),
            mwin_fault_type.eq(0),
        ]

        m.d.comb += [
            u_regs.cr_wr_addr.eq(
                Mux(mwin_cr_wr_en, CR_NAMESPACE,
                    Mux(u_tperm.tperm_busy, u_tperm.cr_wr_addr,
                        Mux(u_call.call_busy, u_call.cr_wr_addr,
                            Mux(u_return.busy, u_return.cr_wr_addr,
                                Mux(self.dbg_cap_wr_en, self.dbg_cap_wr_addr, 0)))))
            ),
            u_regs.cr_wr_data.eq(
                Mux(mwin_cr_wr_en, mwin_cr_wr_data,
                    Mux(u_tperm.tperm_busy, u_tperm.cr_wr_data,
                        Mux(u_call.call_busy, u_call.cr_wr_data,
                            Mux(u_return.busy, u_return.cr_wr_data,
                                Mux(self.dbg_cap_wr_en, self.dbg_cap_wr_data, 0)))))
            ),
            u_regs.cr_wr_en.eq(
                mwin_cr_wr_en | u_tperm.cr_wr_en | u_call.cr_wr_en | u_return.cr_wr_en
                | self.dbg_cap_wr_en
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
        with m.Elif(xloadlambda_fire):
            m.d.sync += nia_reg.eq(xloadlambda_nia)
        with m.Elif(jump_taken):
            m.d.sync += nia_reg.eq(jump_target)
        with m.Elif(branch_taken):
            m.d.sync += nia_reg.eq(branch_target)
        with m.Elif(exec_enable & ~eloadcall_fire & ~xloadlambda_fire):
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
                    ns_gt_view.dom.eq(0),   # Turing, no perms (M-only, transient)
                    ns_gt_view.perm.eq(0),
                ]
                m.d.comb += [boot_wr_en[15].eq(1), boot_wr_gt[15].eq(ns_gt)]
            with m.Case(BootState.INIT_THRD):
                thrd_gt = Signal(GT_LAYOUT)
                thrd_gt_view = View(GT_LAYOUT, thrd_gt)
                m.d.comb += [
                    thrd_gt_view.index.eq(3),
                    thrd_gt_view.version.eq(0),
                    thrd_gt_view.gt_type.eq(GT_TYPE_INFORM),
                    thrd_gt_view.dom.eq(0),   # Turing, no perms (M-only, transient)
                    thrd_gt_view.perm.eq(0),
                ]
                m.d.comb += [boot_wr_en[8].eq(1), boot_wr_gt[8].eq(thrd_gt)]
            with m.Case(BootState.LOAD_NUC):
                cr6_gt = Signal(GT_LAYOUT)
                cr6_gt_view = View(GT_LAYOUT, cr6_gt)
                m.d.comb += [
                    cr6_gt_view.index.eq(2),
                    cr6_gt_view.version.eq(0),
                    cr6_gt_view.gt_type.eq(GT_TYPE_INFORM),
                    cr6_gt_view.dom.eq(1),     # Church domain
                    cr6_gt_view.perm.eq(0b100),  # E = perm[2] in Church domain
                ]
                m.d.comb += [boot_wr_en[6].eq(1), boot_wr_gt[6].eq(cr6_gt)]

                cr7_gt = Signal(GT_LAYOUT)
                cr7_gt_view = View(GT_LAYOUT, cr7_gt)
                m.d.comb += [
                    cr7_gt_view.index.eq(1),
                    cr7_gt_view.version.eq(0),
                    cr7_gt_view.gt_type.eq(GT_TYPE_INFORM),
                    cr7_gt_view.dom.eq(0),     # Turing domain
                    cr7_gt_view.perm.eq(0b100),  # X = perm[2] in Turing domain
                ]
                m.d.comb += [boot_wr_en[7].eq(1), boot_wr_gt[7].eq(cr7_gt)]

                cr5_gt = Signal(GT_LAYOUT)
                cr5_gt_view = View(GT_LAYOUT, cr5_gt)
                m.d.comb += [
                    cr5_gt_view.index.eq(4),
                    cr5_gt_view.version.eq(0),
                    cr5_gt_view.gt_type.eq(GT_TYPE_INFORM),
                    cr5_gt_view.dom.eq(1),     # Church domain
                    cr5_gt_view.perm.eq(0b011),  # L+S: L=perm[0], S=perm[1] in Church domain
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
            u_tperm.cr_src.eq(cr_src),
            u_tperm.preset.eq(u_decoder.tperm_preset),
            u_tperm.cr_rd_data.eq(u_regs.cr_rd_data),
            # TODO: drive from STO < sp_max when call-stack depth tracking is added.
            # Until then, FRAME always returns Z=0 (no return frame visible to hardware).
            u_tperm.stack_has_frame.eq(0),
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

        # -----------------------------------------------------------------------
        # ELOADCALL dispatch — lazy-resolve IRQ to Scheduler (NS slot SCHEDULER_IRQ_NS_SLOT).
        # Fires for one cycle whenever ELOADCALL passes the E-perm check on CR_CLIST.
        # DR0 = IRQ_REASON_LAZY_RESOLVE; DR1 = c-list row; method_index is advisory.
        # (eloadcall_fire Signal and m.d.comb assignment are forward-declared above the NIA block.)
        # -----------------------------------------------------------------------
        m.d.comb += [
            self.irq_valid.eq(eloadcall_fire),
            self.irq_reason.eq(IRQ_REASON_LAZY_RESOLVE),
            self.irq_ns_slot.eq(SCHEDULER_IRQ_NS_SLOT),
            self.irq_dr1.eq(u_decoder.eloadcall_row),
            self.irq_method_index.eq(u_decoder.eloadcall_method_index),
        ]

        # -----------------------------------------------------------------------
        # XLOADLAMBDA dispatch — lambda body loader.
        # Fires for one cycle whenever XLOADLAMBDA passes the X-perm check on CR_CLOOMC.
        # xloadlambda_index carries the lambda body offset from the instruction cap_index field.
        # (xloadlambda_fire Signal and m.d.comb assignment are forward-declared above the NIA block.)
        # -----------------------------------------------------------------------
        m.d.comb += [
            self.xloadlambda_valid.eq(xloadlambda_fire),
            self.xloadlambda_index.eq(u_decoder.cap_index),
        ]

        # XLOADLAMBDA NIA redirect — CR14.word1_location + cap_index.
        # u_regs.cr_rd_data is already muxed to CR_CLOOMC (CR14) when xloadlambda fires,
        # so this is a purely combinatorial address computation with no extra read cycle.
        m.d.comb += xloadlambda_nia.eq(
            View(CAP_REG_LAYOUT, u_regs.cr_rd_data).word1_location[:32]
            + u_decoder.cap_index
        )

        # -----------------------------------------------------------------------
        # M-window FSM
        # Triggered when (call_normal_complete | return_complete | cr15_m_writeback_trigger)
        # AND cr15_m_flag=1.
        # Reads the latched XR11-XR14 (combinatorial) and validates the GT in XR11.
        # If valid → write XR11-XR14 to CR15 + clear M.
        # If invalid → clear M + raise INVALID_OP fault.
        # CHANGE does NOT trigger this FSM — M is preserved across CHANGE.
        # -----------------------------------------------------------------------
        mwin_xr11_lat = Signal(32)
        mwin_xr12_lat = Signal(32)
        mwin_xr13_lat = Signal(32)
        mwin_xr14_lat = Signal(32)
        mwin_xr15_lat = Signal(32)

        m_trigger = Signal()
        m.d.comb += m_trigger.eq(
            u_call.call_normal_complete | u_return.complete | self.cr15_m_writeback_trigger
        )

        # XR11 gt_type lives at bits [1:0] in the ctmm_cap_amaranth layout
        xr11_gt_type = u_regs.m_xr11[:2]
        xr11_valid   = Signal()
        m.d.comb += xr11_valid.eq(xr11_gt_type != GT_TYPE_NULL)

        # Integrity check on the latched shadow — XR14 must equal integrity32(XR12, XR13).
        mwin_integrity_computed = Signal(32)
        integrity32_amaranth(m, mwin_xr12_lat, mwin_xr13_lat, mwin_integrity_computed)
        mwin_integrity_ok = Signal()
        m.d.comb += mwin_integrity_ok.eq(mwin_integrity_computed == mwin_xr14_lat)

        # Version revocation check — GT.version (XR11[31:25]) must match seals.version (XR15[31:25]).
        # XR15 carries the NS entry word3_seals (SEALS_LAYOUT: seal[24:0] | version[31:25]).
        # A mismatch means the GT was revoked by GC since the M-window was set.
        mwin_gt_version    = Signal(7)
        mwin_seal_version  = Signal(7)
        mwin_version_ok    = Signal()
        m.d.comb += [
            mwin_gt_version.eq(View(GT_LAYOUT, mwin_xr11_lat).version),
            mwin_seal_version.eq(View(SEALS_LAYOUT, mwin_xr15_lat).version),
            mwin_version_ok.eq(mwin_gt_version == mwin_seal_version),
        ]

        # gt_seq revocation check — mirrors hardware/core.py mwin_gtseq_ok.
        # XR11[22:16] holds GT.gt_seq in the hardware GT_LAYOUT (hardware/layouts.py).
        # XR13[27:21] holds NS_auth.gt_seq in WORD2_LAYOUT (hardware/layouts.py).
        # Both fields are zero in the standard simulation GT encoding when the upper
        # index bits are zero; a mismatch at these raw bit positions signals a stale GT.
        mwin_gt_gtseq  = Signal(7)
        mwin_ns_gtseq  = Signal(7)
        mwin_gtseq_ok  = Signal()
        m.d.comb += [
            mwin_gt_gtseq.eq(mwin_xr11_lat[16:23]),
            mwin_ns_gtseq.eq(mwin_xr13_lat[21:28]),
            mwin_gtseq_ok.eq(mwin_gt_gtseq == mwin_ns_gtseq),
        ]

        # Seal check — XR15[24:0] must equal fnv32(XR12, XR13) & 0x1FFFFFF.
        # The FNV seal is the lower 25 bits of the one-round FNV-1a hash of the
        # NS entry location (XR12) and limit/authority (XR13).  A mismatch means
        # the seals word was replaced with a stale or replayed version since M-set.
        mwin_seal_computed = Signal(32)
        mwin_seal_masked   = Signal(25)
        mwin_seal_ok       = Signal()
        m.d.comb += [
            mwin_seal_computed.eq(
                ((FNV_OFFSET_32 ^ mwin_xr12_lat) * FNV_PRIME_32) ^ mwin_xr13_lat
            ),
            mwin_seal_masked.eq(mwin_seal_computed[:25]),
            mwin_seal_ok.eq(mwin_seal_masked == View(SEALS_LAYOUT, mwin_xr15_lat).seal),
        ]

        with m.FSM(name="mwin"):
            with m.State("IDLE"):
                m.d.comb += mwin_busy.eq(0)
                with m.If(m_trigger & u_regs.cr15_m_flag):
                    m.d.sync += [
                        mwin_xr11_lat.eq(u_regs.m_xr11),
                        mwin_xr12_lat.eq(u_regs.m_xr12),
                        mwin_xr13_lat.eq(u_regs.m_xr13),
                        mwin_xr14_lat.eq(u_regs.m_xr14),
                        mwin_xr15_lat.eq(u_regs.m_xr15),
                    ]
                    with m.If(xr11_valid):
                        m.next = "WRITEBACK"
                    with m.Else():
                        m.next = "FAULT"

            with m.State("WRITEBACK"):
                m.d.comb += mwin_busy.eq(1)
                # Full validation: all four checks must pass; any failure → INVALID_OP + M-clear.
                #   integrity32(XR12,XR13)==XR14       (integrity_ok)
                #   GT.version==seals.version           (version_ok — revocation via XR11[31:25]/XR15[31:25])
                #   XR11[22:16]==XR13[27:21]            (gtseq_ok  — revocation via hardware gt_seq fields)
                #   fnv32(XR12,XR13)&0x1FFFFFF==XR15[24:0]  (seal_ok — full seal word validation)
                with m.If(mwin_integrity_ok & mwin_version_ok & mwin_gtseq_ok & mwin_seal_ok):
                    mwin_wr_view = View(CAP_REG_LAYOUT, mwin_cr_wr_data)
                    m.d.comb += [
                        mwin_wr_view.word0_gt.eq(mwin_xr11_lat),
                        mwin_wr_view.word1_location.eq(mwin_xr12_lat),
                        mwin_wr_view.word2_limit.eq(mwin_xr13_lat),
                        mwin_wr_view.word3_seals.eq(mwin_xr15_lat),  # restore full 5-word shadow
                        mwin_cr_wr_en.eq(1),
                        mwin_m_clear_en.eq(1),
                    ]
                with m.Else():
                    m.d.comb += [
                        mwin_fault_sig.eq(1),
                        mwin_fault_type.eq(FaultType.INVALID_OP),
                        mwin_m_clear_en.eq(1),
                    ]
                m.next = "IDLE"

            with m.State("FAULT"):
                m.d.comb += mwin_busy.eq(1)
                m.d.comb += [
                    mwin_fault_sig.eq(1),
                    mwin_fault_type.eq(FaultType.INVALID_OP),
                    mwin_m_clear_en.eq(1),
                ]
                m.next = "IDLE"

        # Wire M-set, M-clear, and CHANGE M-flag restore to u_regs
        # M-set fires on Abstract-GT CALL (mgt_set_trigger) or test port (cr15_m_set).
        # For the test-port path, m_set_dr values are sourced from CR15 + integrity32 below.
        m.d.comb += [
            u_regs.m_set_en.eq(self.cr15_m_set | u_call.mgt_set_trigger),
            u_regs.m_clear_en.eq(mwin_m_clear_en),
            # m_flag_restore: in hardware driven by u_change outputs;
            # exposed as a test port here for direct verification.
            u_regs.m_flag_restore_en.eq(self.m_flag_restore_en),
            u_regs.m_flag_restore_val.eq(self.m_flag_restore_val),
        ]

        # M-window shadow data sources (Mux: mgt_set_trigger > cr15_m_set).
        # CALL path (mgt_set_trigger): DR11-DR15 sourced from fetched NS entry — this
        # is the authoritative path for a full 5-word shadow (GT + location + limit +
        # integrity + seals).
        # Test-port path (cr15_m_set): DR11-DR14 sourced from current CR15 fields +
        # computed integrity32; DR15=0 intentionally (seals not available via test port).
        # NOTE: Because DR15=0, seals.version=0; the writeback version check
        #   (GT.version == seals.version) will only pass for GT.version=0.
        #   cr15_m_set is a debug/injection port and must only be used with
        #   version-0 GTs.  Production code must go through the CALL path.
        # Writeback validates only DR11-DR14; DR15/XR15 is advisory only.
        cr15_ns_mset_view = View(CAP_REG_LAYOUT, u_regs.cr15_namespace)
        cr15_m_set_integrity = Signal(32)
        integrity32_amaranth(
            m,
            cr15_ns_mset_view.word1_location,
            cr15_ns_mset_view.word2_limit,
            cr15_m_set_integrity,
        )
        m.d.comb += [
            u_regs.m_set_dr11.eq(
                Mux(u_call.mgt_set_trigger, u_call.mgt_gt_word,
                    cr15_ns_mset_view.word0_gt.as_value())
            ),
            u_regs.m_set_dr12.eq(
                Mux(u_call.mgt_set_trigger, u_call.mgt_ns_location,
                    cr15_ns_mset_view.word1_location)
            ),
            u_regs.m_set_dr13.eq(
                Mux(u_call.mgt_set_trigger, u_call.mgt_ns_authority,
                    cr15_ns_mset_view.word2_limit)
            ),
            u_regs.m_set_dr14.eq(
                Mux(u_call.mgt_set_trigger, u_call.mgt_ns_integrity,
                    cr15_m_set_integrity)
            ),
            u_regs.m_set_dr15.eq(
                Mux(u_call.mgt_set_trigger, u_call.mgt_ns_seals,
                    0)  # cr15_m_set path: XR15 not populated from test port (Task #440 step 3)
            ),
        ]

        # Expose M-window observability signals
        m.d.comb += [
            self.cr15_m_flag.eq(u_regs.cr15_m_flag),
            self.dbg_m_xr11.eq(u_regs.m_xr11),
            self.dbg_m_xr12.eq(u_regs.m_xr12),
            self.dbg_m_xr13.eq(u_regs.m_xr13),
            self.dbg_m_xr14.eq(u_regs.m_xr14),
            self.dbg_m_xr15.eq(u_regs.m_xr15),
        ]

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
        with m.Elif(mwin_fault_sig):
            m.d.comb += [self.fault.eq(mwin_fault_type), self.fault_valid.eq(1)]
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
