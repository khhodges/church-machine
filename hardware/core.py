from amaranth import *
from amaranth.lib.data import View

from .hw_types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT, COND_FLAGS_LAYOUT
from .registers import ChurchRegisters
from .decoder import ChurchDecoder
from .perm_check import ChurchPermCheck
from .gc_unit import ChurchGCUnit
from .lambda_unit import ChurchLambda
from .call import ChurchCall
from .ret import ChurchReturn
from .tperm import ChurchTperm
from .save import ChurchSave
from .load import ChurchLoad
from .mload import ChurchMLoad
from .change import ChurchChange
from .switch import ChurchSwitch
from .fused_unit import ChurchELoadCall, ChurchXLoadLambda
from .dread import ChurchDRead
from .dwrite import ChurchDWrite


class ChurchCore(Elaboratable):
    """Church Machine core — 10 Church opcodes + 2 Turing-domain opcodes.

    Clean 32-bit instruction format matching patent Section 14:
    opcode[5] | cond[4] | dst[4] | src[4] | imm[15].
    10 Church opcodes: LOAD, SAVE, CALL, RETURN, CHANGE, SWITCH, TPERM, LAMBDA,
    ELOADCALL (fused LOAD+TPERM(E)+CALL), XLOADLAMBDA (fused LOAD+TPERM(X)+LAMBDA).
    2 Turing opcodes:  DREAD (bounded data read), DWRITE (bounded data write).
    DREAD/DWRITE use CR-cached base+limit; no NS table re-lookup needed.
    MMIO access: top-level decodes dmem_addr[30]=1,dmem_addr[31]=0 → MMIO.
    Any other invalid opcode faults immediately.

    All features enabled: GC, CHANGE/SWITCH, fused ops, seal checks.
    """

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

        self.fault = Signal(5)   # widened: FaultType.STACK_OVERFLOW=0x10 needs 5 bits
        self.fault_valid = Signal()

        self.free_run_start = Signal()   # pulse high for 1 cycle to jump to free_run_nia
        self.free_run_nia   = Signal(32) # target byte address when free_run_start fires

        self.nia = Signal(32)
        self.flags = Signal(COND_FLAGS_LAYOUT)

    def elaborate(self, platform):
        m = Module()

        u_regs = ChurchRegisters()
        u_decoder = ChurchDecoder()
        u_perm = ChurchPermCheck()
        u_gc = ChurchGCUnit()
        u_lambda = ChurchLambda()
        u_call = ChurchCall()
        u_return = ChurchReturn()
        u_tperm = ChurchTperm()
        u_save = ChurchSave()
        u_load = ChurchLoad()
        u_change = ChurchChange()
        u_switch = ChurchSwitch()
        u_eloadcall = ChurchELoadCall()
        u_xloadlambda = ChurchXLoadLambda()

        m.submodules.u_registers = u_regs
        m.submodules.u_decoder = u_decoder
        m.submodules.u_perm_check = u_perm
        m.submodules.u_gc_unit = u_gc
        m.submodules.u_lambda = u_lambda
        m.submodules.u_call = u_call
        m.submodules.u_return = u_return
        m.submodules.u_tperm = u_tperm
        m.submodules.u_save = u_save
        m.submodules.u_load = u_load
        u_shared_mload = ChurchMLoad()
        m.submodules.u_shared_mload = u_shared_mload
        m.submodules.u_change = u_change
        m.submodules.u_switch = u_switch
        u_dread = ChurchDRead()
        u_dwrite = ChurchDWrite()

        m.submodules.u_eloadcall = u_eloadcall
        m.submodules.u_xloadlambda = u_xloadlambda
        m.submodules.u_dread = u_dread
        m.submodules.u_dwrite = u_dwrite

        nia_reg = Signal(32)

        lambda_active_reg = Signal()
        lambda_pc_reg = Signal(32)

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
                m.d.sync += boot_state_reg.eq(BootState.INIT_CLIST)
            with m.Case(BootState.INIT_CLIST):
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

        is_church_op  = u_decoder.is_church_op
        is_dread_op   = u_decoder.is_dread_op
        is_dwrite_op  = u_decoder.is_dwrite_op
        is_iadd_op    = u_decoder.is_iadd_op
        is_isub_op    = u_decoder.is_isub_op
        is_branch_op  = u_decoder.is_branch_op
        church_op = u_decoder.church_op
        cr_src = u_decoder.cr_src
        cr_dst = u_decoder.cr_dst
        cap_index = u_decoder.cap_index
        switch_target = u_decoder.switch_target
        exec_enable = u_decoder.exec_enable

        cond_exec_enable = Signal()
        m.d.comb += cond_exec_enable.eq(self.boot_complete & exec_enable)

        # 1-cycle busy registers for single-cycle Turing ops (prevent double-execution
        # due to the 1-cycle ROM fetch pipeline latency)
        iadd_busy_reg   = Signal()
        isub_busy_reg   = Signal()
        branch_busy_reg = Signal()

        any_unit_busy = Signal()
        busy_expr = (
            u_lambda.lambda_busy | u_tperm.tperm_busy | u_call.call_busy |
            u_return.busy | u_save.save_busy | u_load.load_busy |
            u_gc.gc_busy |
            u_change.change_busy | u_switch.switch_busy |
            u_eloadcall.busy | u_xloadlambda.busy |
            u_dread.busy | u_dwrite.busy |
            iadd_busy_reg | isub_busy_reg | branch_busy_reg
        )
        m.d.comb += any_unit_busy.eq(busy_expr)

        lambda_start_sig = Signal()
        m.d.comb += lambda_start_sig.eq(
            cond_exec_enable & is_church_op & (church_op == ChurchOpcode.LAMBDA) & ~any_unit_busy
        )

        tperm_start_sig = Signal()
        call_start_sig = Signal()
        ret_start_sig = Signal()

        cr_rd_addr_default = Mux(u_eloadcall.busy, u_eloadcall.cr_rd_addr,
                                 Mux(u_xloadlambda.busy, u_xloadlambda.cr_rd_addr,
                                     Mux(u_dread.busy, u_dread.cr_rd_addr,
                                         Mux(u_dwrite.busy, u_dwrite.cr_rd_addr,
                                             cr_src))))
        cr_rd_addr_inner = Mux(u_change.change_busy, u_change.cr_rd_addr,
                               Mux(u_switch.switch_busy, u_switch.cr_rd_addr,
                                   cr_rd_addr_default))
        m.d.comb += u_regs.cr_rd_addr.eq(
            Mux(u_shared_mload.sub_busy, u_shared_mload.cr_rd_addr,
                Mux(lambda_start_sig | u_lambda.lambda_busy, u_lambda.cr_rd_addr,
                    Mux(u_tperm.tperm_busy, u_tperm.cr_rd_addr,
                        Mux(u_call.call_busy, u_call.cr_rd_addr,
                            Mux(u_return.busy, u_return.cr_rd_addr,
                                Mux(u_save.save_busy, u_save.cr_rd_addr,
                                    cr_rd_addr_inner))))))
        )

        perm_gt_sig = Signal(GT_LAYOUT)
        m.d.comb += perm_gt_sig.eq(View(CAP_REG_LAYOUT, u_regs.cr_rd_data).word0_gt)

        required_perms = Signal(6)
        with m.Switch(church_op):
            with m.Case(ChurchOpcode.LOAD):
                m.d.comb += required_perms.eq(Mux(cr_src == CR_CLIST, 0, PERM_MASK_L))
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
            with m.Case(ChurchOpcode.ELOADCALL):
                m.d.comb += required_perms.eq(0)
            with m.Case(ChurchOpcode.XLOADLAMBDA):
                m.d.comb += required_perms.eq(0)
            with m.Default():
                m.d.comb += required_perms.eq(0)

        m.d.comb += [
            u_perm.gt_in.eq(perm_gt_sig),
            u_perm.required_perms.eq(required_perms),
            u_perm.check_valid.eq(cond_exec_enable & is_church_op),
            u_perm.check_domain_purity.eq(
                cond_exec_enable & is_church_op & (church_op == ChurchOpcode.TPERM)
            ),
        ]

        all_checks_pass = u_perm.all_checks_pass

        m.d.comb += [
            u_gc.gc_start.eq(self.gc_start),
            u_gc.gc_mark_en.eq(1),
            u_gc.gc_sweep_en.eq(1),
            u_gc.ns_start_index.eq(1),
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
            u_regs.flags_in.eq(0),
            u_regs.flags_wr_en.eq(0),
            u_regs.clear_all.eq(clear_all),
        ]

        # Forward-declare Turing-op signals (logic connected after dwrite section)
        iadd_start_sig  = Signal()
        isub_start_sig  = Signal()
        iadd_result     = Signal(33)
        isub_result     = Signal(33)
        iadd_flags_sig  = Signal(COND_FLAGS_LAYOUT)
        isub_flags_sig  = Signal(COND_FLAGS_LAYOUT)
        branch_taken    = Signal()
        branch_sx32     = Signal(32)

        with m.If(u_dread.dr_wr_en):
            m.d.comb += [
                u_regs.dr_wr_addr.eq(u_dread.dr_wr_addr),
                u_regs.dr_wr_data.eq(u_dread.dr_wr_data),
                u_regs.dr_wr_en.eq(1),
            ]
        with m.Elif(iadd_start_sig):
            m.d.comb += [
                u_regs.dr_wr_addr.eq(cr_dst),
                u_regs.dr_wr_data.eq(iadd_result[:32]),
                u_regs.dr_wr_en.eq(1),
                u_regs.flags_in.eq(iadd_flags_sig),
                u_regs.flags_wr_en.eq(1),
            ]
        with m.Elif(isub_start_sig):
            m.d.comb += [
                u_regs.dr_wr_addr.eq(cr_dst),
                u_regs.dr_wr_data.eq(isub_result[:32]),
                u_regs.dr_wr_en.eq(1),
                u_regs.flags_in.eq(isub_flags_sig),
                u_regs.flags_wr_en.eq(1),
            ]
        with m.Else():
            m.d.comb += [
                u_regs.dr_wr_addr.eq(0),
                u_regs.dr_wr_data.eq(0),
                u_regs.dr_wr_en.eq(0),
            ]

        # boot_cap_wr: full 128-bit CR write during boot initialization.
        # Used to set word1_location and word2_w2 (e.g. CR6/CR15) in one cycle.
        # Defaults to 0; driven from the boot state switch below.
        boot_cap_wr_en   = Signal()
        boot_cap_wr_addr = Signal(4)
        boot_cap_wr_data = Signal(CAP_REG_LAYOUT)

        cr_wr_addr_default = Mux(u_eloadcall.busy, u_eloadcall.cr_wr_addr,
                                 Mux(u_xloadlambda.busy, u_xloadlambda.cr_wr_addr, 0))
        cr_wr_data_default = Mux(u_eloadcall.busy, u_eloadcall.cr_wr_data,
                                 Mux(u_xloadlambda.busy, u_xloadlambda.cr_wr_data, 0))
        cr_wr_en_extra = u_eloadcall.cr_wr_en | u_xloadlambda.cr_wr_en
        cr_wr_addr_inner = Mux(u_change.change_busy, u_change.cr_wr_addr,
                               Mux(u_switch.switch_busy, u_switch.cr_wr_addr,
                                   cr_wr_addr_default))
        cr_wr_data_inner = Mux(u_change.change_busy, u_change.cr_wr_data,
                               Mux(u_switch.switch_busy, u_switch.cr_wr_data,
                                   cr_wr_data_default))
        cr_wr_en_extra = cr_wr_en_extra | u_change.cr_wr_en | u_switch.cr_wr_en
        m.d.comb += [
            u_regs.cr_wr_addr.eq(
                Mux(boot_cap_wr_en, boot_cap_wr_addr,
                    Mux(u_shared_mload.cr_wr_en, u_shared_mload.cr_wr_addr,
                        Mux(u_tperm.cr_wr_en, u_tperm.cr_wr_addr,
                            Mux(u_call.cr_wr_en, u_call.cr_wr_addr,
                                Mux(u_return.cr_wr_en, u_return.cr_wr_addr,
                                    cr_wr_addr_inner)))))
            ),
            u_regs.cr_wr_data.eq(
                Mux(boot_cap_wr_en, boot_cap_wr_data,
                    Mux(u_shared_mload.cr_wr_en, u_shared_mload.cr_wr_data,
                        Mux(u_tperm.cr_wr_en, u_tperm.cr_wr_data,
                            Mux(u_call.cr_wr_en, u_call.cr_wr_data,
                                Mux(u_return.cr_wr_en, u_return.cr_wr_data,
                                    cr_wr_data_inner)))))
            ),
            u_regs.cr_wr_en.eq(
                boot_cap_wr_en |
                u_shared_mload.cr_wr_en | u_tperm.cr_wr_en | u_call.cr_wr_en |
                u_return.cr_wr_en | cr_wr_en_extra
            ),
        ]

        with m.If(u_return.reboot_request):
            m.d.sync += [boot_state_reg.eq(BootState.FAULT_RST), nia_reg.eq(0)]
        with m.Elif(clear_all):
            m.d.sync += nia_reg.eq(0)
        with m.Elif(self.free_run_start):
            # Debug FSM jumps CPU to the NUC program entry point
            m.d.sync += nia_reg.eq(self.free_run_nia)
        with m.Elif(u_lambda.nia_set):
            m.d.sync += nia_reg.eq(u_lambda.nia_value)
        with m.Elif(u_xloadlambda.nia_set):
            m.d.sync += nia_reg.eq(u_xloadlambda.nia_value)
        with m.Elif(u_return.nia_set):
            m.d.sync += nia_reg.eq(u_return.nia_value)
        with m.Elif(u_call.nia_set):
            m.d.sync += nia_reg.eq(u_call.nia_value)
        with m.Elif(u_eloadcall.nia_set):
            m.d.sync += nia_reg.eq(u_eloadcall.nia_value)
        with m.Elif(branch_taken):
            # PC-relative branch: nia += sign_extend(imm) * 4
            # branch_sx32 is the 15-bit imm sign-extended to 32 bits (word offset).
            # Cat(C(0,2), branch_sx32) = branch_sx32 << 2 as byte offset (34-bit, truncated to 32).
            m.d.sync += nia_reg.eq(nia_reg + Cat(C(0, 2), branch_sx32))
        with m.Elif(self.boot_complete & u_decoder.instr_valid & ~any_unit_busy):
            # Advance PC for all instructions (including not-taken branches)
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
                # CR15 (namespace cap): full 128-bit write to include word1_location=0
                # (NS at dmem byte 0) and word2_w2=15 (limit: slots 0..15 accessible).
                # ns_gt: slot_id=0, gt_seq=0, GT_TYPE_INFORM, perms=0
                # word0_gt = (GT_TYPE_INFORM<<23) | 0 = 0x00800000
                m.d.comb += [
                    boot_cap_wr_en.eq(1),
                    boot_cap_wr_addr.eq(15),
                    boot_cap_wr_data.eq(Cat(
                        C(0x00800000, 32),  # word0_gt: GT_TYPE_INFORM, slot_id=0
                        C(0,          32),  # word1_location = 0 (NS at dmem start)
                        C(15,         32),  # word2_w2: limit_offset=15 (slots 0-15)
                        C(0,          32),  # word3_w3
                    )),
                ]
            with m.Case(BootState.INIT_THRD):
                thrd_gt = Signal(GT_LAYOUT)
                thrd_gt_view = View(GT_LAYOUT, thrd_gt)
                m.d.comb += [
                    thrd_gt_view.slot_id.eq(1),
                    thrd_gt_view.gt_seq.eq(0),
                    thrd_gt_view.gt_type.eq(GT_TYPE_INFORM),
                    thrd_gt_view.perms.eq(0),
                ]
                m.d.comb += [boot_wr_en[8].eq(1), boot_wr_gt[8].eq(thrd_gt)]
            with m.Case(BootState.INIT_CLIST):
                # CR6 (c-list cap): full 128-bit write to include word1_location=0x400
                # (DEMO_CLIST at dmem byte 0x400 = word 256) and word2_w2=63
                # (limit: indices 0..63 accessible).
                # cr6_gt: slot_id=2, GT_TYPE_INFORM, perms=PERM_MASK_E, gt_seq=0
                # word0_gt = (PERM_MASK_E<<25) | (GT_TYPE_INFORM<<23) | 2 = 0x40800002
                m.d.comb += [
                    boot_cap_wr_en.eq(1),
                    boot_cap_wr_addr.eq(6),
                    boot_cap_wr_data.eq(Cat(
                        C(0x40800002, 32),  # word0_gt: PERM_MASK_E, GT_TYPE_INFORM, slot=2
                        C(0x400,      32),  # word1_location = 0x400 (DEMO_CLIST base)
                        C(63,         32),  # word2_w2: limit_offset=63 (64 entries)
                        C(0,          32),  # word3_w3
                    )),
                ]
            with m.Case(BootState.LOAD_NUC):
                slot3_gt = Signal(GT_LAYOUT)
                slot3_gt_view = View(GT_LAYOUT, slot3_gt)
                m.d.comb += [
                    slot3_gt_view.slot_id.eq(2),
                    slot3_gt_view.gt_seq.eq(0),
                    slot3_gt_view.gt_type.eq(GT_TYPE_INFORM),
                    slot3_gt_view.perms.eq(PERM_MASK_E),
                ]

                cr7_gt = Signal(GT_LAYOUT)
                cr7_gt_view = View(GT_LAYOUT, cr7_gt)
                m.d.comb += [
                    cr7_gt_view.slot_id.eq(3),
                    cr7_gt_view.gt_seq.eq(0),
                    cr7_gt_view.gt_type.eq(GT_TYPE_INFORM),
                    cr7_gt_view.perms.eq(PERM_MASK_X),
                ]
                m.d.comb += [boot_wr_en[7].eq(1), boot_wr_gt[7].eq(cr7_gt)]

        runtime_wr_en = [Signal(name=f"rt_cr{i}_wr_en") for i in range(16)]
        runtime_wr_gt = [Signal(GT_LAYOUT, name=f"rt_cr{i}_wr_gt") for i in range(16)]

        switch_change_active = Signal()
        m.d.comb += switch_change_active.eq(
            self.boot_complete & cond_exec_enable & is_church_op & ~any_unit_busy &
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
            cond_exec_enable & is_church_op & (church_op == ChurchOpcode.CALL) & ~any_unit_busy
        )
        m.d.comb += [
            u_call.call_start.eq(call_start_sig),
            u_call.cr_src.eq(cr_src),
            u_call.index.eq(cap_index),
            u_call.mask.eq(u_decoder.call_mask),
            u_call.cr_rd_data.eq(u_regs.cr_rd_data),
            u_call.cr15_namespace.eq(u_regs.cr15_namespace),
            u_call.cr14_code.eq(u_regs.cr14_code),
            u_call.mem_rd_data.eq(self.dmem_rd_data),
            u_call.mem_rd_valid.eq(1),
            # Stack push inputs
            u_call.cr5_heap.eq(u_regs.cr5_heap),
            u_call.caller_pc.eq(nia_reg[2:17]),           # CALL word offset (nia_reg >> 2)
            u_call.thread_base.eq(View(CAP_REG_LAYOUT, u_regs.cr12_thread).word1_location),
            # THREAD_HDR: populated by CHANGE on thread restore, cached for CALL's stack validation
            u_call.thread_hdr.eq(u_change.thread_hdr_out),
            # Parallel register-file mask operations for domain-crossing cleanup
            u_regs.cr_b_clear_mask.eq(u_call.cr_b_clear_mask),
            u_regs.cr_null_mask.eq(u_call.cr_null_mask),
        ]

        m.d.comb += ret_start_sig.eq(
            cond_exec_enable & is_church_op & (church_op == ChurchOpcode.RETURN) & ~any_unit_busy
        )
        m.d.comb += [
            u_return.return_start.eq(ret_start_sig),
            u_return.cr_src.eq(cr_src[:3]),
            u_return.cr_rd_data.eq(u_regs.cr_rd_data),
            u_return.lambda_active.eq(lambda_active_reg),
            u_return.lambda_pc.eq(lambda_pc_reg),
        ]

        with m.If(clear_all):
            m.d.sync += [lambda_active_reg.eq(0), lambda_pc_reg.eq(0)]
        with m.Elif(u_return.lambda_clear):
            m.d.sync += lambda_active_reg.eq(0)
        with m.Elif(u_lambda.lambda_complete & ~u_lambda.lambda_fault):
            m.d.sync += [lambda_active_reg.eq(1), lambda_pc_reg.eq(u_lambda.saved_nia)]

        m.d.comb += [
            u_lambda.lambda_start.eq(lambda_start_sig),
            u_lambda.cr_target.eq(cr_dst),
            u_lambda.cr_rd_data.eq(u_regs.cr_rd_data),
            u_lambda.saved_nia.eq(nia_reg + 4),
        ]

        m.d.comb += tperm_start_sig.eq(
            cond_exec_enable & is_church_op & (church_op == ChurchOpcode.TPERM) & ~any_unit_busy
        )
        m.d.comb += [
            u_tperm.tperm_start.eq(tperm_start_sig),
            u_tperm.cr_target.eq(cr_dst),
            u_tperm.preset.eq(u_decoder.tperm_preset),
            u_tperm.cr_rd_data.eq(u_regs.cr_rd_data),
        ]

        save_start_sig = Signal()
        m.d.comb += save_start_sig.eq(
            cond_exec_enable & is_church_op & (church_op == ChurchOpcode.SAVE) & ~any_unit_busy
        )
        m.d.comb += [
            u_save.save_start.eq(save_start_sig),
            u_save.cr_src.eq(cr_src),
            u_save.cr_dst.eq(cr_dst),
            u_save.index.eq(cap_index),
            u_save.cr_rd_data.eq(u_regs.cr_rd_data),
            u_save.cr15_namespace.eq(u_regs.cr15_namespace),
            u_save.mem_wr_done.eq(1),
            u_save.mem_rd_data.eq(self.dmem_rd_data),
            u_save.mem_rd_valid.eq(1),
        ]

        dread_start_sig = Signal()
        m.d.comb += dread_start_sig.eq(
            cond_exec_enable & is_dread_op & ~any_unit_busy
        )
        m.d.comb += [
            u_dread.start.eq(dread_start_sig),
            u_dread.cr_src.eq(cr_src),
            u_dread.dr_dst.eq(cr_dst),
            u_dread.imm.eq(u_decoder.immediate),
            u_dread.cr_rd_data.eq(u_regs.cr_rd_data),
            u_dread.dmem_rd_data.eq(self.dmem_rd_data),
        ]

        dwrite_start_sig = Signal()
        m.d.comb += dwrite_start_sig.eq(
            cond_exec_enable & is_dwrite_op & ~any_unit_busy
        )
        m.d.comb += [
            u_dwrite.start.eq(dwrite_start_sig),
            u_dwrite.cr_src.eq(cr_src),
            u_dwrite.dr_src.eq(cr_dst),
            u_dwrite.imm.eq(u_decoder.immediate),
            u_dwrite.cr_rd_data.eq(u_regs.cr_rd_data),
            u_dwrite.dr_rd_data.eq(u_regs.dr_rd_data2),
        ]
        m.d.comb += u_regs.dr_rd_addr2.eq(
            Mux(u_dwrite.busy, u_dwrite.dr_rd_addr, 0)
        )

        # ── IADD / ISUB ──────────────────────────────────────────────────────
        # Immediate arithmetic on data registers.
        # DR[dst] = DR[src] + sign_extend(imm)  (IADD)
        # DR[dst] = DR[src] - sign_extend(imm)  (ISUB)
        # Flags: N = result[31], Z = (result==0), C = carry-out, V = 0.
        # 1-cycle busy after execution prevents double-fire due to ROM pipeline latency.
        # (Signals forward-declared above for use in DR write / nia chains.)

        m.d.comb += [
            iadd_start_sig.eq(cond_exec_enable & is_iadd_op & ~any_unit_busy),
            isub_start_sig.eq(cond_exec_enable & is_isub_op & ~any_unit_busy),
        ]

        # Latch busy for exactly 1 cycle after start (cleared when start is gone)
        m.d.sync += [
            iadd_busy_reg.eq(iadd_start_sig & ~iadd_busy_reg),
            isub_busy_reg.eq(isub_start_sig & ~isub_busy_reg),
        ]

        # Sign-extend 15-bit immediate to 32 bits for arithmetic
        arith_imm_sx = Signal(32)
        m.d.comb += arith_imm_sx.eq(
            Cat(u_decoder.immediate, u_decoder.immediate[14].replicate(17))
        )

        # Source DR read (port 1 — CHANGE uses this too but reads DR0 by default)
        m.d.comb += u_regs.dr_rd_addr1.eq(
            Mux(iadd_start_sig | isub_start_sig, cr_src, 0)
        )

        # 33-bit results (bit 32 = carry for IADD, borrow for ISUB)
        m.d.comb += [
            iadd_result.eq(u_regs.dr_rd_data1 + arith_imm_sx),
            isub_result.eq(u_regs.dr_rd_data1 - arith_imm_sx),
        ]

        iadd_flags_view = View(COND_FLAGS_LAYOUT, iadd_flags_sig)
        isub_flags_view = View(COND_FLAGS_LAYOUT, isub_flags_sig)
        m.d.comb += [
            iadd_flags_view.N.eq(iadd_result[31]),
            iadd_flags_view.Z.eq(iadd_result[:32] == 0),
            iadd_flags_view.C.eq(iadd_result[32]),
            iadd_flags_view.V.eq(0),
            isub_flags_view.N.eq(isub_result[31]),
            isub_flags_view.Z.eq(isub_result[:32] == 0),
            isub_flags_view.C.eq(isub_result[32]),
            isub_flags_view.V.eq(0),
        ]

        # ── BRANCH ───────────────────────────────────────────────────────────
        # Conditional PC-relative branch.
        # branch_target = nia_reg + sign_extend(imm) * 4
        # (imm is a signed word offset from the current instruction's address)
        # 1-cycle busy after taken branch prevents double-fire from ROM pipeline.
        # (Signals forward-declared above for use in nia chain.)

        m.d.comb += branch_taken.eq(
            self.boot_complete & exec_enable & is_branch_op & ~any_unit_busy
        )
        m.d.sync += branch_busy_reg.eq(branch_taken & ~branch_busy_reg)

        m.d.comb += branch_sx32.eq(
            Cat(u_decoder.immediate, u_decoder.immediate[14].replicate(17))
        )

        load_start_sig = Signal()
        m.d.comb += load_start_sig.eq(
            cond_exec_enable & is_church_op & (church_op == ChurchOpcode.LOAD) & ~any_unit_busy
        )
        m.d.comb += [
            u_load.load_start.eq(load_start_sig),
            u_load.cr_src.eq(cr_src),
            u_load.cr_dst.eq(cr_dst),
            u_load.index.eq(cap_index),
        ]

        change_start_sig = Signal()
        m.d.comb += change_start_sig.eq(
            cond_exec_enable & is_church_op & (church_op == ChurchOpcode.CHANGE) & ~any_unit_busy
        )
        m.d.comb += [
            u_change.change_start.eq(change_start_sig),
            u_change.cr_src.eq(cr_src),
            u_change.index.eq(cap_index),
            u_change.change_mask.eq(u_decoder.call_mask),
            u_change.cr_rd_data.eq(u_regs.cr_rd_data),
            u_change.cr12_thread.eq(u_regs.cr12_thread),
            u_change.cr15_namespace.eq(u_regs.cr15_namespace),
            u_change.mem_rd_data.eq(self.dmem_rd_data),
            u_change.mem_rd_valid.eq(1),
            u_change.mem_wr_done.eq(1),
            u_change.dr_rd_data.eq(u_regs.dr_rd_data1),
            u_change.nia.eq(nia_reg),
            u_change.flags.eq(u_regs.flags),
        ]

        switch_start_sig = Signal()
        m.d.comb += switch_start_sig.eq(
            cond_exec_enable & is_church_op & (church_op == ChurchOpcode.SWITCH) & ~any_unit_busy
        )
        m.d.comb += [
            u_switch.switch_start.eq(switch_start_sig),
            u_switch.cr_src.eq(cr_src[:3]),
            u_switch.target.eq(switch_target[:3]),
            u_switch.index.eq(cap_index),
            u_switch.cr_rd_data.eq(u_regs.cr_rd_data),
            u_switch.cr15_namespace.eq(u_regs.cr15_namespace),
            u_switch.mem_rd_data.eq(self.dmem_rd_data),
            u_switch.mem_rd_valid.eq(1),
        ]

        eloadcall_start_sig = Signal()
        m.d.comb += eloadcall_start_sig.eq(
            cond_exec_enable & is_church_op & (church_op == ChurchOpcode.ELOADCALL) & ~any_unit_busy
        )
        m.d.comb += [
            u_eloadcall.start.eq(eloadcall_start_sig),
            u_eloadcall.cr_src.eq(cr_src),
            u_eloadcall.cr_dst.eq(cr_dst),
            u_eloadcall.index.eq(cap_index),
            u_eloadcall.mask.eq(u_decoder.call_mask),
            u_eloadcall.cr_rd_data.eq(u_regs.cr_rd_data),
            u_eloadcall.cr15_namespace.eq(u_regs.cr15_namespace),
            u_eloadcall.mem_rd_data.eq(self.dmem_rd_data),
            u_eloadcall.mem_rd_valid.eq(1),
        ]

        xloadlambda_start_sig = Signal()
        m.d.comb += xloadlambda_start_sig.eq(
            cond_exec_enable & is_church_op & (church_op == ChurchOpcode.XLOADLAMBDA) & ~any_unit_busy
        )
        m.d.comb += [
            u_xloadlambda.start.eq(xloadlambda_start_sig),
            u_xloadlambda.cr_src.eq(cr_src),
            u_xloadlambda.cr_dst.eq(cr_dst),
            u_xloadlambda.index.eq(cap_index),
            u_xloadlambda.cr_rd_data.eq(u_regs.cr_rd_data),
            u_xloadlambda.cr15_namespace.eq(u_regs.cr15_namespace),
            u_xloadlambda.mem_rd_data.eq(self.dmem_rd_data),
            u_xloadlambda.mem_rd_valid.eq(1),
            u_xloadlambda.saved_nia.eq(nia_reg + 4),
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
        with m.Elif(u_eloadcall.complete & ~u_eloadcall.fault & ~cr5_stack_full):
            m.d.comb += [
                cr5_stack_wr.addr.eq(cr5_stack_ptr),
                cr5_stack_wr.data.eq(u_eloadcall.saved_cr5_gt),
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
        with m.Elif(u_load.load_fault):
            m.d.comb += [self.fault.eq(u_load.fault_type), self.fault_valid.eq(1)]
        with m.Elif(u_change.change_fault):
            m.d.comb += [self.fault.eq(u_change.fault_type), self.fault_valid.eq(1)]
        with m.Elif(u_switch.switch_fault):
            m.d.comb += [self.fault.eq(u_switch.fault_type), self.fault_valid.eq(1)]
        with m.Elif(u_eloadcall.fault):
            m.d.comb += [self.fault.eq(u_eloadcall.fault_type), self.fault_valid.eq(1)]
        with m.Elif(u_xloadlambda.fault):
            m.d.comb += [self.fault.eq(u_xloadlambda.fault_type), self.fault_valid.eq(1)]
        with m.Elif(u_dread.fault):
            m.d.comb += [self.fault.eq(u_dread.fault_type), self.fault_valid.eq(1)]
        with m.Elif(u_dwrite.fault):
            m.d.comb += [self.fault.eq(u_dwrite.fault_type), self.fault_valid.eq(1)]
        with m.Else():
            m.d.comb += [self.fault.eq(FaultType.NONE), self.fault_valid.eq(0)]

        m.d.comb += [
            u_shared_mload.cr_rd_data.eq(u_regs.cr_rd_data),
            u_shared_mload.cr15_namespace.eq(u_regs.cr15_namespace),
            u_shared_mload.mem_rd_data.eq(self.dmem_rd_data),
            u_shared_mload.mem_rd_valid.eq(1),
        ]

        with m.If(u_call.call_busy):
            m.d.comb += [
                u_shared_mload.sub_start.eq(u_call.mload_start),
                u_shared_mload.sub_cr_src.eq(u_call.mload_cr_src),
                u_shared_mload.sub_cr_dst.eq(u_call.mload_cr_dst),
                u_shared_mload.sub_index.eq(u_call.mload_index),
                u_shared_mload.sub_direct.eq(u_call.mload_direct),
                u_shared_mload.sub_direct_gt.eq(u_call.mload_direct_gt),
                u_shared_mload.sub_m_elevated.eq(u_call.mload_m_elevated),
            ]
        with m.Elif(u_return.busy):
            m.d.comb += [
                u_shared_mload.sub_start.eq(u_return.mload_start),
                u_shared_mload.sub_cr_src.eq(u_return.mload_cr_src),
                u_shared_mload.sub_cr_dst.eq(u_return.mload_cr_dst),
                u_shared_mload.sub_index.eq(u_return.mload_index),
                u_shared_mload.sub_direct.eq(u_return.mload_direct),
                u_shared_mload.sub_direct_gt.eq(u_return.mload_direct_gt),
                u_shared_mload.sub_m_elevated.eq(u_return.mload_m_elevated),
            ]
        with m.Elif(u_load.load_busy):
            m.d.comb += [
                u_shared_mload.sub_start.eq(u_load.mload_start),
                u_shared_mload.sub_cr_src.eq(u_load.mload_cr_src),
                u_shared_mload.sub_cr_dst.eq(u_load.mload_cr_dst),
                u_shared_mload.sub_index.eq(u_load.mload_index),
                u_shared_mload.sub_direct.eq(u_load.mload_direct),
                u_shared_mload.sub_direct_gt.eq(u_load.mload_direct_gt),
                u_shared_mload.sub_m_elevated.eq(u_load.mload_m_elevated),
            ]

        m.d.comb += [
            u_call.mload_done.eq(u_shared_mload.sub_done),
            u_call.mload_fault.eq(u_shared_mload.sub_fault),
            u_call.mload_fault_type.eq(u_shared_mload.sub_fault_type),

            u_return.mload_done.eq(u_shared_mload.sub_done),
            u_return.mload_fault.eq(u_shared_mload.sub_fault),
            u_return.mload_fault_type.eq(u_shared_mload.sub_fault_type),

            u_load.mload_busy.eq(u_shared_mload.sub_busy),
            u_load.mload_done.eq(u_shared_mload.sub_done),
            u_load.mload_fault.eq(u_shared_mload.sub_fault),
            u_load.mload_fault_type.eq(u_shared_mload.sub_fault_type),
        ]

        m.d.comb += [
            self.dmem_addr.eq(0),
            self.dmem_rd_en.eq(0),
            self.dmem_wr_data.eq(0),
            self.dmem_wr_en.eq(0),
        ]

        with m.If(u_shared_mload.mem_rd_en | u_shared_mload.mem_wr_en):
            m.d.comb += [
                self.dmem_addr.eq(u_shared_mload.mem_addr),
                self.dmem_rd_en.eq(u_shared_mload.mem_rd_en),
                self.dmem_wr_data.eq(u_shared_mload.mem_wr_data),
                self.dmem_wr_en.eq(u_shared_mload.mem_wr_en),
            ]
        with m.Elif(u_call.mem_rd_en):
            # CALL FETCH_LUMP / STACK_READ_SP: data memory read
            m.d.comb += [
                self.dmem_addr.eq(u_call.mem_rd_addr),
                self.dmem_rd_en.eq(1),
            ]
        with m.Elif(u_call.mem_wr_en):
            # CALL stack push: write E-GT word, LAMBDA frame word, or updated SP
            m.d.comb += [
                self.dmem_addr.eq(u_call.mem_wr_addr),
                self.dmem_wr_data.eq(u_call.mem_wr_data),
                self.dmem_wr_en.eq(1),
            ]
        with m.Elif(u_save.mem_wr_en):
            m.d.comb += [
                self.dmem_addr.eq(u_save.mem_wr_addr),
                self.dmem_wr_data.eq(u_save.mem_wr_data),
                self.dmem_wr_en.eq(1),
            ]
        with m.Elif(u_save.mem_rd_en):
            m.d.comb += [
                self.dmem_addr.eq(u_save.mem_rd_addr),
                self.dmem_rd_en.eq(1),
            ]
        with m.Elif(u_dread.dmem_rd_en):
            m.d.comb += [
                self.dmem_addr.eq(u_dread.dmem_addr),
                self.dmem_rd_en.eq(1),
            ]
        with m.Elif(u_dwrite.dmem_wr_en):
            m.d.comb += [
                self.dmem_addr.eq(u_dwrite.dmem_addr),
                self.dmem_wr_data.eq(u_dwrite.dmem_wr_data),
                self.dmem_wr_en.eq(1),
            ]

        m.d.comb += [
            u_gc.valid_key_access.eq(u_shared_mload.gbit_reset_done),
            u_gc.access_index.eq(0),
        ]

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
