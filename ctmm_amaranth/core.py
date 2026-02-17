from amaranth import *
from amaranth.lib.data import View

from .types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT, COND_FLAGS_LAYOUT
from .registers import CTMMRegisters
from .decoder import CTMMDecoder
from .perm_check import CTMMPermCheck
from .gc_unit import CTMMGCUnit
from .call import CTMMCall
from .ret import CTMMReturn
from .lambda_unit import CTMMLambda


class CTMMCore(Elaboratable):
    def __init__(self):
        self.imem_addr = Signal(32)
        self.imem_data = Signal(32)
        self.imem_valid = Signal()

        self.ns_addr = Signal(32)
        self.ns_rd_en = Signal()
        self.ns_rd_data = Signal(64 * 3)
        self.ns_wr_data = Signal(64 * 3)
        self.ns_wr_en = Signal()

        self.clist_addr = Signal(32)
        self.clist_rd_en = Signal()
        self.clist_rd_data = Signal(GT_LAYOUT)
        self.clist_wr_data = Signal(GT_LAYOUT)
        self.clist_wr_en = Signal()

        self.dmem_addr = Signal(32)
        self.dmem_rd_en = Signal()
        self.dmem_rd_data = Signal(64)
        self.dmem_wr_data = Signal(64)
        self.dmem_wr_en = Signal()

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

        u_regs = CTMMRegisters()
        u_decoder = CTMMDecoder()
        u_perm = CTMMPermCheck()
        u_gc = CTMMGCUnit()
        u_lambda = CTMMLambda()
        u_call = CTMMCall()
        u_return = CTMMReturn()
        m.submodules.u_registers = u_regs
        m.submodules.u_decoder = u_decoder
        m.submodules.u_perm_check = u_perm
        m.submodules.u_gc_unit = u_gc
        m.submodules.u_lambda = u_lambda
        m.submodules.u_call = u_call
        m.submodules.u_return = u_return

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
            u_decoder.flags.eq(u_regs.flags),
        ]

        exec_enable = u_decoder.exec_enable
        is_church_op = u_decoder.is_church_op
        is_turing_op = u_decoder.is_turing_op
        church_op = u_decoder.church_op
        cr_src = u_decoder.cr_src
        cr_dst = u_decoder.cr_dst
        clist_index = u_decoder.clist_index
        imm_mode = u_decoder.imm_mode
        switch_target = u_decoder.switch_target
        dr_src1 = u_decoder.dr_src1
        dr_src2 = u_decoder.dr_src2
        dr_dst = u_decoder.dr_dst
        immediate = u_decoder.immediate
        ldi_immediate = u_decoder.ldi_immediate
        branch_offset = u_decoder.branch_offset

        lambda_start_sig = Signal()
        m.d.comb += lambda_start_sig.eq(
            exec_enable & is_church_op & (church_op == ChurchOpcode.LAMBDA)
        )

        m.d.comb += u_regs.cr_rd_addr.eq(
            Mux(lambda_start_sig, u_lambda.cr_rd_addr,
                Cat(cr_src, Const(0, 1)))
        )

        cr_rd_gt = View(GT_LAYOUT, Signal(GT_LAYOUT))
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
            u_perm.access_index.eq(Cat(clist_index, Const(0, 22))),
            u_perm.limit.eq(0),
            u_perm.check_bounds.eq(1),
            u_perm.calculated_mac.eq(0),
            u_perm.stored_mac.eq(0),
            u_perm.check_mac.eq(0),
            u_perm.check_domain_purity.eq(exec_enable & is_church_op & (church_op == ChurchOpcode.TPERM)),
        ]

        all_checks_pass = u_perm.all_checks_pass

        m.d.comb += [
            u_gc.gc_start.eq(self.gc_start),
            u_gc.gc_mark_en.eq(1),
            u_gc.gc_sweep_en.eq(1),
            u_gc.ns_rd_data.eq(self.clist_rd_data),
            u_gc.ns_start_addr.eq(0),
            u_gc.ns_end_addr.eq(0x1000),
            u_gc.access_addr.eq(self.clist_addr),
            u_gc.valid_key_access.eq(all_checks_pass & is_church_op & (church_op == ChurchOpcode.LOAD)),
            u_gc.is_namespace_access.eq(u_perm.is_namespace_access),
        ]

        m.d.comb += [
            self.gc_busy.eq(u_gc.gc_busy),
            self.gc_garbage_count.eq(u_gc.garbage_count),
        ]

        cr_rd_data_gt = Signal(GT_LAYOUT)
        m.d.comb += cr_rd_data_gt.eq(View(CAP_REG_LAYOUT, u_regs.cr_rd_data).word0_gt)

        clist_addr_computed = Signal(32)
        gt_offset = View(GT_LAYOUT, cr_rd_data_gt).offset
        m.d.comb += clist_addr_computed.eq(Cat(clist_index, gt_offset[:22]))

        m.d.comb += [
            self.clist_addr.eq(Mux(u_gc.gc_busy, u_gc.ns_addr, clist_addr_computed)),
            self.clist_rd_en.eq(Mux(u_gc.gc_busy, u_gc.ns_rd_en,
                exec_enable & is_church_op &
                ((church_op == ChurchOpcode.LOAD) |
                 (imm_mode & ((church_op == ChurchOpcode.SWITCH) | (church_op == ChurchOpcode.CHANGE)))))),
            self.clist_wr_data.eq(Mux(u_gc.gc_busy, u_gc.ns_wr_data, cr_rd_data_gt)),
            self.clist_wr_en.eq(Mux(u_gc.gc_busy, u_gc.ns_wr_en,
                exec_enable & is_church_op & (church_op == ChurchOpcode.SAVE) & all_checks_pass)),
        ]

        m.d.comb += [
            u_regs.cr_wr_addr.eq(Cat(cr_dst, Const(0, 1))),
            u_regs.cr_wr_data.eq(0),
            u_regs.cr_wr_en.eq(exec_enable & is_church_op & (church_op == ChurchOpcode.LOAD) & all_checks_pass),
        ]

        m.d.comb += [
            u_regs.dr_rd_addr1.eq(dr_src1),
            u_regs.dr_rd_addr2.eq(dr_src2),
            u_regs.dr_wr_addr.eq(dr_dst),
        ]

        dr_wr_data = Signal(64)
        dr_wr_en = Signal()
        flags_in = Signal(COND_FLAGS_LAYOUT)
        flags_wr_en = Signal()

        alu_result = Signal(64)
        op2 = Signal(64)
        m.d.comb += op2.eq(Mux(imm_mode, Cat(immediate, Const(0, 50)), u_regs.dr_rd_data2))

        flags_in_view = View(COND_FLAGS_LAYOUT, flags_in)

        with m.If(exec_enable & is_turing_op):
            with m.Switch(u_decoder.turing_op):
                with m.Case(TuringOpcode.MOV):
                    m.d.comb += [dr_wr_data.eq(op2), dr_wr_en.eq(1)]
                with m.Case(TuringOpcode.ADD):
                    m.d.comb += alu_result.eq(u_regs.dr_rd_data1 + op2)
                    m.d.comb += [dr_wr_data.eq(alu_result), dr_wr_en.eq(1)]
                    m.d.comb += [flags_in_view.Z.eq(alu_result == 0), flags_in_view.N.eq(alu_result[63]), flags_wr_en.eq(1)]
                with m.Case(TuringOpcode.SUB):
                    m.d.comb += alu_result.eq(u_regs.dr_rd_data1 - op2)
                    m.d.comb += [dr_wr_data.eq(alu_result), dr_wr_en.eq(1)]
                    m.d.comb += [flags_in_view.Z.eq(alu_result == 0), flags_in_view.N.eq(alu_result[63]), flags_wr_en.eq(1)]
                with m.Case(TuringOpcode.MUL):
                    m.d.comb += alu_result.eq(u_regs.dr_rd_data1 * op2)
                    m.d.comb += [dr_wr_data.eq(alu_result), dr_wr_en.eq(1)]
                    m.d.comb += [flags_in_view.Z.eq(alu_result == 0), flags_in_view.N.eq(alu_result[63]), flags_wr_en.eq(1)]
                with m.Case(TuringOpcode.AND):
                    m.d.comb += alu_result.eq(u_regs.dr_rd_data1 & op2)
                    m.d.comb += [dr_wr_data.eq(alu_result), dr_wr_en.eq(1)]
                    m.d.comb += [flags_in_view.Z.eq(alu_result == 0), flags_in_view.N.eq(alu_result[63]), flags_wr_en.eq(1)]
                with m.Case(TuringOpcode.ORR):
                    m.d.comb += alu_result.eq(u_regs.dr_rd_data1 | op2)
                    m.d.comb += [dr_wr_data.eq(alu_result), dr_wr_en.eq(1)]
                    m.d.comb += [flags_in_view.Z.eq(alu_result == 0), flags_in_view.N.eq(alu_result[63]), flags_wr_en.eq(1)]
                with m.Case(TuringOpcode.EOR):
                    m.d.comb += alu_result.eq(u_regs.dr_rd_data1 ^ op2)
                    m.d.comb += [dr_wr_data.eq(alu_result), dr_wr_en.eq(1)]
                    m.d.comb += [flags_in_view.Z.eq(alu_result == 0), flags_in_view.N.eq(alu_result[63]), flags_wr_en.eq(1)]
                with m.Case(TuringOpcode.LSL):
                    shift_amt = Signal(6)
                    m.d.comb += shift_amt.eq(op2[:6])
                    m.d.comb += alu_result.eq(u_regs.dr_rd_data1 << shift_amt)
                    m.d.comb += [dr_wr_data.eq(alu_result), dr_wr_en.eq(1)]
                    m.d.comb += [flags_in_view.Z.eq(alu_result == 0), flags_in_view.N.eq(alu_result[63]), flags_wr_en.eq(1)]
                with m.Case(TuringOpcode.LSR):
                    shift_amt_r = Signal(6)
                    m.d.comb += shift_amt_r.eq(op2[:6])
                    m.d.comb += alu_result.eq(u_regs.dr_rd_data1 >> shift_amt_r)
                    m.d.comb += [dr_wr_data.eq(alu_result), dr_wr_en.eq(1)]
                    m.d.comb += [flags_in_view.Z.eq(alu_result == 0), flags_in_view.N.eq(alu_result[63]), flags_wr_en.eq(1)]
                with m.Case(TuringOpcode.ASR):
                    asr_amt = Signal(6)
                    m.d.comb += asr_amt.eq(op2[:6])
                    asr_shifted = Signal(64)
                    m.d.comb += asr_shifted.eq(u_regs.dr_rd_data1 >> asr_amt)
                    asr_sign_ext = Signal(64)
                    asr_inv_amt = Signal(7)
                    m.d.comb += asr_inv_amt.eq(64 - Cat(asr_amt, Const(0, 1)))
                    m.d.comb += asr_sign_ext.eq(Mux(u_regs.dr_rd_data1[63],
                        asr_shifted | (Const(0xFFFFFFFF_FFFFFFFF, 64) << asr_inv_amt[:6]),
                        asr_shifted))
                    m.d.comb += alu_result.eq(asr_sign_ext)
                    m.d.comb += [dr_wr_data.eq(alu_result), dr_wr_en.eq(1)]
                    m.d.comb += [flags_in_view.Z.eq(alu_result == 0), flags_in_view.N.eq(alu_result[63]), flags_wr_en.eq(1)]
                with m.Case(TuringOpcode.CMP):
                    cmp_result = Signal(64)
                    m.d.comb += cmp_result.eq(u_regs.dr_rd_data1 - op2)
                    m.d.comb += [flags_in_view.Z.eq(cmp_result == 0), flags_in_view.N.eq(cmp_result[63]), flags_wr_en.eq(1)]
                with m.Case(TuringOpcode.TST):
                    tst_result = Signal(64)
                    m.d.comb += tst_result.eq(u_regs.dr_rd_data1 & op2)
                    m.d.comb += [flags_in_view.Z.eq(tst_result == 0), flags_in_view.N.eq(tst_result[63]), flags_wr_en.eq(1)]
                with m.Case(TuringOpcode.B):
                    m.d.comb += [
                        nia_next.eq(nia_reg + Cat(branch_offset, Const(0, 14))),
                        nia_wr_en.eq(1),
                    ]
                with m.Case(TuringOpcode.BL):
                    m.d.comb += [
                        dr_wr_data.eq(nia_reg + 4),
                        dr_wr_en.eq(1),
                        nia_next.eq(nia_reg + Cat(branch_offset, Const(0, 14))),
                        nia_wr_en.eq(1),
                    ]
                with m.Case(TuringOpcode.LDI):
                    m.d.comb += [
                        dr_wr_data.eq(Cat(ldi_immediate, Const(0, 42))),
                        dr_wr_en.eq(1),
                    ]

        m.d.comb += [
            u_regs.dr_wr_data.eq(dr_wr_data),
            u_regs.dr_wr_en.eq(dr_wr_en),
            u_regs.flags_in.eq(flags_in),
            u_regs.flags_wr_en.eq(flags_wr_en),
            u_regs.clear_all.eq(clear_all),
        ]

        with m.If(clear_all):
            m.d.sync += nia_reg.eq(0)
        with m.Elif(u_lambda.nia_set):
            m.d.sync += nia_reg.eq(u_lambda.nia_value)
        with m.Elif(u_return.nia_set):
            m.d.sync += nia_reg.eq(u_return.nia_value[:32])
        with m.Elif(u_call.nia_set):
            m.d.sync += nia_reg.eq(u_call.nia_value[:32])
        with m.Elif(nia_wr_en):
            m.d.sync += nia_reg.eq(nia_next)
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
                    ns_gt_view.offset.eq(0),
                    ns_gt_view.spare.eq(0),
                    ns_gt_view.gt_type.eq(GT_TYPE_INFORM),
                    ns_gt_view.g_bit.eq(0),
                    ns_gt_view.perms.eq(0),
                ]
                m.d.comb += [boot_wr_en[15].eq(1), boot_wr_gt[15].eq(ns_gt)]
            with m.Case(BootState.INIT_THRD):
                thrd_gt = Signal(GT_LAYOUT)
                thrd_gt_view = View(GT_LAYOUT, thrd_gt)
                m.d.comb += [
                    thrd_gt_view.offset.eq(3),
                    thrd_gt_view.spare.eq(0),
                    thrd_gt_view.gt_type.eq(GT_TYPE_INFORM),
                    thrd_gt_view.g_bit.eq(0),
                    thrd_gt_view.perms.eq(0),
                ]
                m.d.comb += [boot_wr_en[8].eq(1), boot_wr_gt[8].eq(thrd_gt)]
            with m.Case(BootState.LOAD_NUC):
                cr6_gt = Signal(GT_LAYOUT)
                cr6_gt_view = View(GT_LAYOUT, cr6_gt)
                m.d.comb += [
                    cr6_gt_view.offset.eq(2),
                    cr6_gt_view.spare.eq(0),
                    cr6_gt_view.gt_type.eq(GT_TYPE_INFORM),
                    cr6_gt_view.g_bit.eq(0),
                    cr6_gt_view.perms.eq(PERM_MASK_E),
                ]
                m.d.comb += [boot_wr_en[6].eq(1), boot_wr_gt[6].eq(cr6_gt)]

                cr7_gt = Signal(GT_LAYOUT)
                cr7_gt_view = View(GT_LAYOUT, cr7_gt)
                m.d.comb += [
                    cr7_gt_view.offset.eq(1),
                    cr7_gt_view.spare.eq(0),
                    cr7_gt_view.gt_type.eq(GT_TYPE_INFORM),
                    cr7_gt_view.g_bit.eq(0),
                    cr7_gt_view.perms.eq(PERM_MASK_X),
                ]
                m.d.comb += [boot_wr_en[7].eq(1), boot_wr_gt[7].eq(cr7_gt)]

                cr5_gt = Signal(GT_LAYOUT)
                cr5_gt_view = View(GT_LAYOUT, cr5_gt)
                m.d.comb += [
                    cr5_gt_view.offset.eq(4),
                    cr5_gt_view.spare.eq(0),
                    cr5_gt_view.gt_type.eq(GT_TYPE_INFORM),
                    cr5_gt_view.g_bit.eq(0),
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
        m.d.comb += switch_src_gt.eq(Mux(imm_mode, self.clist_rd_data, cr_rd_data_gt))

        effective_target = Signal(3)
        m.d.comb += effective_target.eq(Mux(church_op == ChurchOpcode.CHANGE, 0, switch_target))

        with m.If(switch_change_active):
            for i in range(8):
                with m.If(effective_target == i):
                    m.d.comb += [runtime_wr_en[8 + i].eq(1), runtime_wr_gt[8 + i].eq(switch_src_gt)]

        for i in range(16):
            m.d.comb += [
                u_regs.cr_gt_wr_en[i].eq(boot_wr_en[i] | runtime_wr_en[i]),
                u_regs.cr_gt_wr_data[i].eq(Mux(boot_wr_en[i], boot_wr_gt[i], runtime_wr_gt[i])),
            ]

        with m.If(u_decoder.fault_valid):
            m.d.comb += [self.fault.eq(u_decoder.fault), self.fault_valid.eq(1)]
        with m.Elif(u_perm.fault_valid):
            m.d.comb += [self.fault.eq(u_perm.fault_type), self.fault_valid.eq(1)]
        with m.Elif(u_lambda.lambda_fault):
            m.d.comb += [self.fault.eq(u_lambda.fault_type), self.fault_valid.eq(1)]
        with m.Else():
            m.d.comb += [self.fault.eq(FaultType.NONE), self.fault_valid.eq(0)]

        m.d.comb += [
            self.dmem_addr.eq(u_regs.dr_rd_data1[:32]),
            self.dmem_rd_en.eq(0),
            self.dmem_wr_data.eq(u_regs.dr_rd_data2),
            self.dmem_wr_en.eq(0),
        ]

        m.d.comb += [
            self.ns_addr.eq(View(GT_LAYOUT, cr_rd_data_gt).offset),
            self.ns_rd_en.eq(0),
            self.ns_wr_en.eq(0),
        ]

        call_start_sig = Signal()
        m.d.comb += call_start_sig.eq(
            exec_enable & is_church_op & (church_op == ChurchOpcode.CALL) & all_checks_pass
        )

        m.d.comb += [
            u_call.call_start.eq(call_start_sig),
            u_call.cr_src.eq(Cat(cr_src, Const(0, 1))),
            u_call.index.eq(clist_index[:8]),
            u_call.mask.eq(u_decoder.call_mask),
            u_call.cr_rd_data.eq(u_regs.cr_rd_data),
            u_call.cr15_namespace.eq(u_regs.cr15_namespace),
            u_call.mem_rd_data.eq(self.dmem_rd_data),
            u_call.mem_rd_valid.eq(1),
        ]

        ret_start_sig = Signal()
        m.d.comb += ret_start_sig.eq(
            exec_enable & is_church_op & (church_op == ChurchOpcode.RETURN) & all_checks_pass
        )

        m.d.comb += [
            u_return.return_start.eq(ret_start_sig),
            u_return.cr_src.eq(cr_src),
            u_return.cr_rd_data.eq(u_regs.cr_rd_data),
            u_return.cr15_namespace.eq(u_regs.cr15_namespace),
            u_return.mem_rd_data.eq(self.dmem_rd_data),
            u_return.mem_rd_valid.eq(1),
        ]

        m.d.comb += [
            u_lambda.lambda_start.eq(lambda_start_sig),
            u_lambda.cr_target.eq(Cat(cr_dst, Const(0, 1))),
            u_lambda.cr_rd_data.eq(u_regs.cr_rd_data),
            u_lambda.saved_nia.eq(nia_reg + 4),
        ]

        CR5_STACK_DEPTH = 256
        cr5_stack = Memory(shape=64, depth=CR5_STACK_DEPTH, init=[])
        m.submodules.cr5_stack = cr5_stack
        cr5_stack_ptr = Signal(8, init=0)
        cr5_stack_empty = Signal()
        cr5_stack_full = Signal()
        cr5_stack_wr = cr5_stack.write_port()
        cr5_stack_rd = cr5_stack.read_port(transparent_for=[cr5_stack_wr])

        m.d.comb += [
            cr5_stack_empty.eq(cr5_stack_ptr == 0),
            cr5_stack_full.eq(cr5_stack_ptr == CR5_STACK_DEPTH),
            cr5_stack_rd.addr.eq(Mux(cr5_stack_ptr > 0, cr5_stack_ptr - 1, 0)),
            u_return.saved_cr5_gt.eq(Mux(cr5_stack_empty, 0, cr5_stack_rd.data)),
            cr5_stack_wr.addr.eq(0),
            cr5_stack_wr.data.eq(0),
            cr5_stack_wr.en.eq(0),
        ]

        with m.If(u_call.complete & ~u_call.fault & ~cr5_stack_full):
            m.d.comb += [
                cr5_stack_wr.addr.eq(cr5_stack_ptr),
                cr5_stack_wr.data.eq(u_call.saved_cr5_gt),
                cr5_stack_wr.en.eq(1),
            ]
            m.d.sync += cr5_stack_ptr.eq(cr5_stack_ptr + 1)
        with m.Elif(u_return.complete & ~u_return.fault_valid & ~cr5_stack_empty):
            m.d.sync += cr5_stack_ptr.eq(cr5_stack_ptr - 1)

        return m
