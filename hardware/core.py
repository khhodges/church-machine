from amaranth import *
from amaranth.lib.memory import Memory as LibMemory
from amaranth.lib.data import View

from .hw_types import *
from .layouts import GT_LAYOUT, CAP_REG_LAYOUT, WORD2_LAYOUT, COND_FLAGS_LAYOUT, LUMP_HEADER_LAYOUT, SEALS_LAYOUT
from .integrity32 import integrity32_amaranth
from .boot_rom import NUC_LUMP_BASE, NUC_PROGRAM_CW, DEMO_CLIST_NAMED_SLOTS
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
from .irq_dispatch import ChurchIRQDispatch
from .pet_name_mem import PetNameMemory
from .dread import ChurchDRead
from .dwrite import ChurchDWrite
from .cload import ChurchCLoad
from .outform import ChurchOutform
from .outform_iot import ChurchOutformIoT
from .church_outform import ChurchOutformFSM


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
    When iot_profile=True: GC, Lambda, Change, Switch, ELoadCall, XLoadLambda
    are excluded; excluded opcodes emit FAULT_OPCODE.  Outform uses the lean
    tunnel-hunting ChurchOutformIoT instead of ChurchOutform.
    """

    def __init__(self, iot_profile=False):
        self.iot_profile = iot_profile
        self.imem_addr = Signal(32)
        self.imem_data = Signal(32)
        self.imem_valid = Signal()

        self.dmem_addr = Signal(32)
        self.dmem_rd_en = Signal()
        self.dmem_rd_data = Signal(32)
        self.dmem_rd_valid = Signal()
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
        self.halt_valid = Signal()   # pulses when a zero instruction word is fetched post-boot

        # GT fault telemetry — latched when fault_valid fires; held until FAULT_RST.
        # Exposed via APB3 registers +0x18..+0x24 for CALLHOME GT diagnostics.
        # fault_gt / fault_cr14 reserved: sub-unit wiring added in a future pass.
        self.fault_gt    = Signal(32)  # GT word0 of the cap that faulted (APB3 +0x18)
        self.fault_instr = Signal(32)  # instruction word at fault NIA     (APB3 +0x1C)
        self.fault_cr14  = Signal(32)  # CR14 word0 at fault time          (APB3 +0x20)
        self.fault_stage = Signal(4)   # 0=Fetch 1=Decode 2=Perm 3=Lambda 4=TPERM 5=Call 6=Return 7=DataRW  (APB3 +0x24)

        self.free_run_start = Signal()   # pulse high for 1 cycle to jump to free_run_nia
        self.free_run_nia   = Signal(32) # target byte address when free_run_start fires

        self.nia = Signal(32)
        self.flags = Signal(COND_FLAGS_LAYOUT)

        self.outform_tx_valid = Signal()
        self.outform_tx_data  = Signal(8)
        self.outform_tx_ack   = Signal()   # from tang_nano: UART accepted the byte
        self.outform_rx_valid = Signal()
        self.outform_rx_data  = Signal(8)
        self.outform_result_gt = Signal(32)
        self.outform_busy     = Signal()   # to tang_nano: route UART to outform

        # Test injection: allows sim tests to fire the outform without CPU.
        # Set outform_start_in=1 for one cycle to bypass the mLoad path.
        self.outform_start_in      = Signal()
        self.outform_slot_id_in    = Signal(16)
        self.outform_clist_addr_in = Signal(32)
        self.outform_gt_raw_in     = Signal(32)

        # ── Simulation-only debug ports ──────────────────────────────────────
        # These ports MUST be tied to 0 at the synthesis integration boundary
        # (e.g., in ti60_f225.py).  They are never driven in production hardware;
        # Amaranth synthesizes undriven inputs as constant 0, so they add no
        # logic overhead, but the intent should be explicit.
        #
        # dbg_cr_wr_en/addr/data — direct CR write, absolute lowest priority in
        #   the CR write mux.  Lets test harnesses set arbitrary cap-register
        #   content without booting through instruction sequences.
        self.dbg_cr_wr_en   = Signal()
        self.dbg_cr_wr_addr = Signal(4)
        self.dbg_cr_wr_data = Signal(CAP_REG_LAYOUT)

        # dbg_outform_done_inject / dbg_outform_result_gt — fake a completed
        #   Mode 2 outform download in test harnesses without driving the full
        #   UART/IoT protocol.  Hold inject=1 for the WAIT_OUTFORM + PROMOTE_WRITE
        #   cycles (2 cycles) so result_gt_in is stable during PROMOTE_WRITE.
        #   Gate: injected done is ANDed with outform_mode2_active internally.
        self.dbg_outform_done_inject    = Signal()
        self.dbg_outform_result_gt      = Signal(32)

        # Hardware IRQ dispatch (Task #1523, non-IoT only).
        # Driven high for one cycle by the platform timer peripheral when its
        # compare register fires.  All other trigger conditions (LAZY_LOAD,
        # LAZY_RESOLVE) are detected internally; this is the only external port.
        self.timer_alarm = Signal()

        # outform_fsm_busy — combinatorial read of ChurchOutformFSM.busy.
        #   Useful for integration tests to observe intercept FSM state without
        #   relying on the download engine's outform_busy (which lags by 1 cycle).
        self.outform_fsm_busy = Signal()   # Mode 2 intercept FSM busy (test/debug)

        # M-window (CR15 namespace M-flag latch + DR11-DR13 shadow) — Task #432
        # cr15_m_set: pulse to load DR11-DR14 from CR15 + integrity32 and set M-flag (test)
        # cr15_m_writeback_trigger: pulse to validate DR11/integrity and write back to CR15
        # cr15_m_flag: current M-flag state (combinatorial read)
        # dbg_m_dr11..15: combinatorial reads of DR11-DR15 for test inspection
        self.cr15_m_set               = Signal()
        self.cr15_m_writeback_trigger = Signal()
        self.cr15_m_flag              = Signal()
        self.dbg_m_dr11               = Signal(32)
        self.dbg_m_dr12               = Signal(32)
        self.dbg_m_dr13               = Signal(32)
        self.dbg_m_dr14               = Signal(32)
        self.dbg_m_dr15               = Signal(32)

    def elaborate(self, platform):
        m = Module()

        u_regs = ChurchRegisters()
        u_decoder = ChurchDecoder(iot_profile=self.iot_profile)
        u_perm = ChurchPermCheck()
        u_call = ChurchCall()
        u_return = ChurchReturn()
        u_tperm = ChurchTperm()
        u_save = ChurchSave()
        u_load = ChurchLoad()

        m.submodules.u_registers = u_regs
        m.submodules.u_decoder = u_decoder
        m.submodules.u_perm_check = u_perm
        m.submodules.u_call = u_call
        m.submodules.u_return = u_return
        m.submodules.u_tperm = u_tperm
        m.submodules.u_save = u_save
        m.submodules.u_load = u_load
        u_shared_mload = ChurchMLoad()
        m.submodules.u_shared_mload = u_shared_mload
        u_dread = ChurchDRead()
        u_dwrite = ChurchDWrite()
        u_cload = ChurchCLoad()

        if self.iot_profile:
            u_outform = ChurchOutformIoT()
        else:
            u_outform = ChurchOutform()

        if not self.iot_profile:
            u_gc = ChurchGCUnit()
            u_lambda = ChurchLambda()
            u_change = ChurchChange()
            u_switch = ChurchSwitch()
            u_eloadcall = ChurchELoadCall()
            u_xloadlambda = ChurchXLoadLambda()
            u_irq_dispatch = ChurchIRQDispatch()
            # Pre-mark named boot c-list slots from the authoritative set in
            # boot_rom.DEMO_CLIST_NAMED_SLOTS.  Freed or anonymous slots (e.g.
            # idx 4, formerly Startup.Config) are NOT in the set; a NULL GT
            # there stays a hard NULL_CAP fault.  The DWRITE MMIO path
            # (IO_PORT_PET_NAME_WR) lets the assembler/firmware annotate
            # additional named slots at run time.
            u_pet_name_mem = PetNameMemory(init_named=list(DEMO_CLIST_NAMED_SLOTS))
            m.submodules.u_gc_unit = u_gc
            m.submodules.u_lambda = u_lambda
            m.submodules.u_change = u_change
            m.submodules.u_switch = u_switch
            m.submodules.u_eloadcall = u_eloadcall
            m.submodules.u_xloadlambda = u_xloadlambda
            m.submodules.u_irq_dispatch = u_irq_dispatch
            m.submodules.u_pet_name_mem = u_pet_name_mem

        m.submodules.u_dread = u_dread
        m.submodules.u_dwrite = u_dwrite
        m.submodules.u_cload = u_cload
        m.submodules.u_outform = u_outform

        u_outform_fsm = ChurchOutformFSM()
        m.submodules.u_outform_fsm = u_outform_fsm

        nia_reg = Signal(32)

        # Code fence registers — protect against runaway branches escaping the current
        # CALL context.  Set from the CALL unit on call_complete; cleared to (0, 0) on
        # reboot or whenever the execution context leaves the guarded code region via
        # LAMBDA / ELOADCALL / XLOADLAMBDA (where code bounds are unknown).
        # Fence is inactive when code_lo_reg == code_hi_reg == 0.
        #
        # fence_pending_reg is set on cross-domain RETURN and cleared when cload writes
        # CR14 with the restored caller code cap.  While set, it contributes to
        # any_unit_busy, preventing instruction fetch/decode during the transitional
        # window, thereby eliminating the unfenced gap between RETURN and cload.
        code_lo_reg     = Signal(32, init=0)
        code_hi_reg     = Signal(32, init=0)
        fence_pending_reg = Signal(init=0)

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
        is_shl_op     = u_decoder.is_shl_op
        is_shr_op     = u_decoder.is_shr_op
        is_bfext_op   = u_decoder.is_bfext_op
        is_bfins_op   = u_decoder.is_bfins_op
        is_mcmp_op    = u_decoder.is_mcmp_op
        church_op = u_decoder.church_op
        cr_src = u_decoder.cr_src
        cr_dst = u_decoder.cr_dst
        cap_index = u_decoder.cap_index
        switch_target = u_decoder.switch_target
        exec_enable = u_decoder.exec_enable

        cond_exec_enable = Signal()
        fetch_bounds_fault = Signal()   # combinatorial; gates cond_exec_enable and drives fault
        # fetch_bounds_fault is assigned below (after any_unit_busy is defined).
        # Including ~fetch_bounds_fault here ensures that NO instruction can start in the
        # same cycle that a BOUNDS fault is asserted — decode side effects are suppressed.
        m.d.comb += cond_exec_enable.eq(self.boot_complete & exec_enable & ~fetch_bounds_fault)

        # 1-cycle busy registers for single-cycle Turing ops (prevent double-execution
        # due to the 1-cycle ROM fetch pipeline latency)
        iadd_busy_reg   = Signal()
        isub_busy_reg   = Signal()
        branch_busy_reg = Signal()
        shl_busy_reg    = Signal()
        shr_busy_reg    = Signal()
        bfext_busy_reg  = Signal()
        bfins_busy_reg  = Signal()
        mcmp_busy_reg   = Signal()

        any_unit_busy = Signal()
        cross_domain_ret = Signal()
        cload_pending   = Signal()

        # Early declarations for M-window FSM — CR15 M-flag latch + DR11-DR13 shadow
        mwin_busy              = Signal()
        mwin_cr_wr_en          = Signal()
        mwin_cr_wr_data        = Signal(CAP_REG_LAYOUT)
        mwin_m_set_en          = Signal()
        mwin_m_clear_en        = Signal()
        mwin_fault_valid       = Signal()

        # Early declarations for Mint FSM signals used throughout elaborate()
        mint_busy              = Signal()
        mint_clist_wr_en       = Signal()
        mint_clist_addr_d      = Signal(32)  # byte addr of clist slot being written
        mint_e_gt_d            = Signal(32)  # computed E-GT word written to caller clist
        mint_slot_id_reg       = Signal(16)  # latched from mLoad when outform fires
        mint_clist_addr_reg    = Signal(32)  # latched from mLoad when outform fires
        mint_lump_size_reg     = Signal(15)  # latched lump size (words)
        mint_dmem_rd_en        = Signal()    # Mint DMEM read request
        mint_dmem_addr         = Signal(32)  # Mint DMEM read address
        mint_ns_wr_en          = Signal()    # Mint NS write enable
        mint_ns_addr           = Signal(32)  # Mint NS write address
        mint_ns_wr_data        = Signal(32)  # Mint NS write data
        mint_clist_wr_data_d   = Signal(32)  # clist write data (cc copy or E-GT)

        busy_expr = (
            u_tperm.tperm_busy | u_call.call_busy |
            u_return.busy | u_save.save_busy | u_load.load_busy |
            u_dread.busy | u_dwrite.busy |
            iadd_busy_reg | isub_busy_reg | branch_busy_reg |
            shl_busy_reg | shr_busy_reg | bfext_busy_reg | bfins_busy_reg | mcmp_busy_reg |
            u_cload.cload_busy | cload_pending |
            fence_pending_reg |
            u_outform.outform_busy |
            mint_busy |
            mwin_busy |
            u_outform_fsm.busy
        )
        if not self.iot_profile:
            busy_expr = busy_expr | (
                u_lambda.lambda_busy | u_gc.gc_busy |
                u_change.change_busy | u_switch.switch_busy |
                u_eloadcall.busy | u_xloadlambda.busy |
                u_irq_dispatch.busy
            )
        m.d.comb += any_unit_busy.eq(busy_expr)

        # Halt detection: zero instruction word fetched after boot, while no unit is busy.
        # Matches the simulator's halted-on-zero-word behaviour.
        m.d.comb += self.halt_valid.eq(
            self.boot_complete & self.imem_valid & (self.imem_data == 0) & ~any_unit_busy
        )

        lambda_start_sig = Signal()
        nested_lambda_fault = Signal()
        if not self.iot_profile:
            m.d.comb += nested_lambda_fault.eq(
                cond_exec_enable & is_church_op & (church_op == ChurchOpcode.LAMBDA) & ~any_unit_busy
                & lambda_active_reg & (cr_dst != CR_CLIST)
            )
            m.d.comb += lambda_start_sig.eq(
                cond_exec_enable & is_church_op & (church_op == ChurchOpcode.LAMBDA) & ~any_unit_busy
                & ~(lambda_active_reg & (cr_dst != CR_CLIST))
            )

        tperm_start_sig = Signal()
        call_start_sig = Signal()
        ret_start_sig = Signal()

        if not self.iot_profile:
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
        else:
            cr_rd_addr_default = Mux(u_dread.busy, u_dread.cr_rd_addr,
                                     Mux(u_dwrite.busy, u_dwrite.cr_rd_addr,
                                         cr_src))
            m.d.comb += u_regs.cr_rd_addr.eq(
                Mux(u_shared_mload.sub_busy, u_shared_mload.cr_rd_addr,
                    Mux(u_tperm.tperm_busy, u_tperm.cr_rd_addr,
                        Mux(u_call.call_busy, u_call.cr_rd_addr,
                            Mux(u_return.busy, u_return.cr_rd_addr,
                                Mux(u_save.save_busy, u_save.cr_rd_addr,
                                    cr_rd_addr_default)))))
            )

        perm_gt_sig = Signal(GT_LAYOUT)
        m.d.comb += perm_gt_sig.eq(View(CAP_REG_LAYOUT, u_regs.cr_rd_data).word0_gt)

        required_perms = Signal(6)
        with m.Switch(church_op):
            with m.Case(ChurchOpcode.LOAD):
                m.d.comb += required_perms.eq(Mux(cr_src == CR_CLIST, 0, PERM_MASK_L))
            with m.Case(ChurchOpcode.SAVE):
                m.d.comb += required_perms.eq(0)
            with m.Case(ChurchOpcode.CALL):
                # Abstract GTs bypass E-perm: the call FSM dispatches to M_FETCH_NS.
                # Outform GTs bypass E-perm: the ChurchOutformFSM intercepts first
                # to lazily install the lump, then promotes to Inform before the CALL.
                hw_perm_gt_view = View(GT_LAYOUT, perm_gt_sig)
                with m.If((hw_perm_gt_view.gt_type == GT_TYPE_ABSTRACT) |
                          (hw_perm_gt_view.gt_type == GT_TYPE_OUTFORM)):
                    m.d.comb += required_perms.eq(0)
                with m.Else():
                    m.d.comb += required_perms.eq(PERM_MASK_E)
            if not self.iot_profile:
                with m.Case(ChurchOpcode.SWITCH):
                    m.d.comb += required_perms.eq(PERM_MASK_L)
                with m.Case(ChurchOpcode.CHANGE):
                    # Permission check is done inside ChurchChange (change.py):
                    # CR12/CR13 require S-perm + location match; CR14/CR15 require L-perm.
                    # M-elevation during boot bypasses both checks.
                    m.d.comb += required_perms.eq(0)
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

        if not self.iot_profile:
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
        else:
            m.d.comb += [
                self.gc_busy.eq(0),
                self.gc_garbage_count.eq(0),
            ]

        cr_rd_data_gt = Signal(GT_LAYOUT)
        m.d.comb += cr_rd_data_gt.eq(View(CAP_REG_LAYOUT, u_regs.cr_rd_data).word0_gt)

        m.d.comb += [
            self.clist_addr.eq(0),
            self.clist_rd_en.eq(0),
            self.clist_wr_data.eq(cr_rd_data_gt),
            self.clist_wr_en.eq(0),
        ]
        with m.If(mint_clist_wr_en):
            m.d.comb += [
                self.clist_addr.eq(mint_clist_addr_d),
                self.clist_wr_data.eq(mint_clist_wr_data_d),
                self.clist_wr_en.eq(1),
            ]

        m.d.comb += [
            u_regs.flags_in.eq(0),
            u_regs.flags_wr_en.eq(0),
            u_regs.clear_all.eq(clear_all),
        ]

        # Forward-declare Turing-op signals (logic connected after dwrite section)
        iadd_start_sig  = Signal()
        isub_start_sig  = Signal()
        shl_start_sig   = Signal()
        shr_start_sig   = Signal()
        bfext_start_sig = Signal()
        bfins_start_sig = Signal()
        mcmp_start_sig  = Signal()
        iadd_result     = Signal(33)
        isub_result     = Signal(33)
        shl_result      = Signal(32)
        shr_result      = Signal(32)
        bfext_result    = Signal(32)
        bfins_result    = Signal(32)
        mcmp_result     = Signal(33)
        iadd_flags_sig  = Signal(COND_FLAGS_LAYOUT)
        isub_flags_sig  = Signal(COND_FLAGS_LAYOUT)
        shl_flags_sig   = Signal(COND_FLAGS_LAYOUT)
        shr_flags_sig   = Signal(COND_FLAGS_LAYOUT)
        bfext_flags_sig = Signal(COND_FLAGS_LAYOUT)
        bfins_flags_sig = Signal(COND_FLAGS_LAYOUT)
        mcmp_flags_sig  = Signal(COND_FLAGS_LAYOUT)
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
        with m.Elif(shl_start_sig):
            m.d.comb += [
                u_regs.dr_wr_addr.eq(cr_dst),
                u_regs.dr_wr_data.eq(shl_result),
                u_regs.dr_wr_en.eq(1),
                u_regs.flags_in.eq(shl_flags_sig),
                u_regs.flags_wr_en.eq(1),
            ]
        with m.Elif(shr_start_sig):
            m.d.comb += [
                u_regs.dr_wr_addr.eq(cr_dst),
                u_regs.dr_wr_data.eq(shr_result),
                u_regs.dr_wr_en.eq(1),
                u_regs.flags_in.eq(shr_flags_sig),
                u_regs.flags_wr_en.eq(1),
            ]
        with m.Elif(bfext_start_sig):
            m.d.comb += [
                u_regs.dr_wr_addr.eq(cr_dst),
                u_regs.dr_wr_data.eq(bfext_result),
                u_regs.dr_wr_en.eq(1),
                u_regs.flags_in.eq(bfext_flags_sig),
                u_regs.flags_wr_en.eq(1),
            ]
        with m.Elif(bfins_start_sig):
            m.d.comb += [
                u_regs.dr_wr_addr.eq(cr_dst),
                u_regs.dr_wr_data.eq(bfins_result),
                u_regs.dr_wr_en.eq(1),
                u_regs.flags_in.eq(bfins_flags_sig),
                u_regs.flags_wr_en.eq(1),
            ]
        with m.Elif(mcmp_start_sig):
            # MCMP: flags-only compare, no DR write
            m.d.comb += [
                u_regs.dr_wr_addr.eq(0),
                u_regs.dr_wr_data.eq(0),
                u_regs.dr_wr_en.eq(0),
                u_regs.flags_in.eq(mcmp_flags_sig),
                u_regs.flags_wr_en.eq(1),
            ]
        with m.Elif(u_tperm.tperm_complete):
            # TPERM complete: update N/Z from tperm_z_result; C and V always 0.
            # A.10: TPERM flag invariants — N = !Z, C = 0, V = 0.
            tperm_flags_sig = Signal(COND_FLAGS_LAYOUT)
            tperm_flags_view = View(COND_FLAGS_LAYOUT, tperm_flags_sig)
            m.d.comb += [
                tperm_flags_view.Z.eq(u_tperm.tperm_z_result),
                tperm_flags_view.N.eq(~u_tperm.tperm_z_result),
                tperm_flags_view.C.eq(0),
                tperm_flags_view.V.eq(0),
                u_regs.flags_in.eq(tperm_flags_sig),
                u_regs.flags_wr_en.eq(1),
            ]
        with m.Else():
            m.d.comb += [
                u_regs.dr_wr_addr.eq(0),
                u_regs.dr_wr_data.eq(0),
                u_regs.dr_wr_en.eq(0),
            ]

        # IRQ dispatch DR writes — last-write-wins: override the chain above
        # for the one cycle that u_irq_dispatch fires each write pulse.
        if not self.iot_profile:
            with m.If(u_irq_dispatch.dr_wr_en):
                m.d.comb += [
                    u_regs.dr_wr_addr.eq(u_irq_dispatch.dr_wr_addr),
                    u_regs.dr_wr_data.eq(u_irq_dispatch.dr_wr_data),
                    u_regs.dr_wr_en.eq(1),
                ]
            with m.If(u_irq_dispatch.dr1_wr_en):
                m.d.comb += [
                    u_regs.dr_wr_addr.eq(1),
                    u_regs.dr_wr_data.eq(u_irq_dispatch.dr1_wr_data),
                    u_regs.dr_wr_en.eq(1),
                ]

        # boot_cap_wr: full 96-bit CR write during boot initialization.
        # Used to set word1_location and word2_w2 (e.g. CR6/CR15) in one cycle.
        # Defaults to 0; driven from the boot state switch below.
        boot_cap_wr_en   = Signal()
        boot_cap_wr_addr = Signal(4)
        boot_cap_wr_data = Signal(CAP_REG_LAYOUT)

        if not self.iot_profile:
            cr_wr_addr_default = Mux(u_eloadcall.busy, u_eloadcall.cr_wr_addr,
                                     Mux(u_xloadlambda.busy, u_xloadlambda.cr_wr_addr, 0))
            cr_wr_data_default = Mux(u_eloadcall.busy, u_eloadcall.cr_wr_data,
                                     Mux(u_xloadlambda.busy, u_xloadlambda.cr_wr_data, 0))
            cr_wr_en_extra = u_eloadcall.cr_wr_en | u_xloadlambda.cr_wr_en
            cr_wr_addr_inner = Mux(u_cload.cr_wr_en, u_cload.cr_wr_addr,
                                   Mux(u_change.change_busy, u_change.cr_wr_addr,
                                       Mux(u_switch.switch_busy, u_switch.cr_wr_addr,
                                           cr_wr_addr_default)))
            cr_wr_data_inner = Mux(u_cload.cr_wr_en, u_cload.cr_wr_data,
                                   Mux(u_change.change_busy, u_change.cr_wr_data,
                                       Mux(u_switch.switch_busy, u_switch.cr_wr_data,
                                           cr_wr_data_default)))
            cr_wr_en_extra = cr_wr_en_extra | u_cload.cr_wr_en | u_change.cr_wr_en | u_switch.cr_wr_en
        else:
            cr_wr_addr_inner = Mux(u_cload.cr_wr_en, u_cload.cr_wr_addr, 0)
            cr_wr_data_inner = Mux(u_cload.cr_wr_en, u_cload.cr_wr_data, 0)
            cr_wr_en_extra = u_cload.cr_wr_en
        # ChurchOutformFSM (Mode 2 CALL intercept) adds a CR promote write.
        # Wrap cr_wr_addr_inner/cr_wr_data_inner to give it lowest priority
        # (it only fires during PROMOTE_WRITE, when all other units are idle).
        cr_wr_addr_inner = Mux(u_outform_fsm.cr_wr_en, u_outform_fsm.cr_wr_addr, cr_wr_addr_inner)
        cr_wr_data_inner = Mux(u_outform_fsm.cr_wr_en, u_outform_fsm.cr_wr_data, cr_wr_data_inner)
        cr_wr_en_extra = cr_wr_en_extra | u_outform_fsm.cr_wr_en
        # Debug CR write port — absolute lowest priority (simulation/test use only).
        cr_wr_addr_inner = Mux(self.dbg_cr_wr_en, self.dbg_cr_wr_addr, cr_wr_addr_inner)
        cr_wr_data_inner = Mux(self.dbg_cr_wr_en, self.dbg_cr_wr_data, cr_wr_data_inner)
        cr_wr_en_extra = cr_wr_en_extra | self.dbg_cr_wr_en
        m.d.comb += [
            u_regs.cr_wr_addr.eq(
                Mux(mwin_cr_wr_en, CR_NAMESPACE,
                    Mux(boot_cap_wr_en, boot_cap_wr_addr,
                        Mux(u_shared_mload.cr_wr_en, u_shared_mload.cr_wr_addr,
                            Mux(u_tperm.cr_wr_en, u_tperm.cr_wr_addr,
                                Mux(u_call.cr_wr_en, u_call.cr_wr_addr,
                                    Mux(u_return.cr_wr_en, u_return.cr_wr_addr,
                                        cr_wr_addr_inner))))))
            ),
            u_regs.cr_wr_data.eq(
                Mux(mwin_cr_wr_en, mwin_cr_wr_data,
                    Mux(boot_cap_wr_en, boot_cap_wr_data,
                        Mux(u_shared_mload.cr_wr_en, u_shared_mload.cr_wr_data,
                            Mux(u_tperm.cr_wr_en, u_tperm.cr_wr_data,
                                Mux(u_call.cr_wr_en, u_call.cr_wr_data,
                                    Mux(u_return.cr_wr_en, u_return.cr_wr_data,
                                        cr_wr_data_inner))))))
            ),
            u_regs.cr_wr_en.eq(
                mwin_cr_wr_en | boot_cap_wr_en |
                u_shared_mload.cr_wr_en | u_tperm.cr_wr_en | u_call.cr_wr_en |
                u_return.cr_wr_en | cr_wr_en_extra
            ),
            # M-window set/clear connect to u_regs controls
            u_regs.m_set_en.eq(mwin_m_set_en),
            u_regs.m_clear_en.eq(mwin_m_clear_en),
            # Expose M-flag and shadow DR reads
            self.cr15_m_flag.eq(u_regs.cr15_m_flag),
            self.dbg_m_dr11.eq(u_regs.m_dr11),
            self.dbg_m_dr12.eq(u_regs.m_dr12),
            self.dbg_m_dr13.eq(u_regs.m_dr13),
            self.dbg_m_dr14.eq(u_regs.m_dr14),
            self.dbg_m_dr15.eq(u_regs.m_dr15),
        ]

        # CHANGE restore signals only exist on the full profile (not IoT)
        if not self.iot_profile:
            m.d.comb += [
                u_regs.m_flag_restore_en.eq(u_change.m_flag_restore_en),
                u_regs.m_flag_restore_val.eq(u_change.m_flag_restore_val),
            ]

        # M-window shadow data sources — mgt_set_trigger (from Abstract-GT CALL) takes
        # priority over cr15_m_set (test/microcode injection port).
        # For the cr15_m_set path we compute integrity32 here so the WRITEBACK check
        # succeeds without the test needing to pre-calculate it.
        cr15_ns_view_mset = View(CAP_REG_LAYOUT, u_regs.cr15_namespace)
        cr15_m_set_integrity = Signal(32)
        integrity32_amaranth(
            m,
            cr15_ns_view_mset.word1_location,
            cr15_ns_view_mset.word2_w2,
            cr15_m_set_integrity,
        )
        m.d.comb += [
            u_regs.m_set_dr11.eq(
                Mux(u_call.mgt_set_trigger, u_call.mgt_gt_word,
                    cr15_ns_view_mset.word0_gt.as_value())
            ),
            u_regs.m_set_dr12.eq(
                Mux(u_call.mgt_set_trigger, u_call.mgt_ns_location,
                    cr15_ns_view_mset.word1_location)
            ),
            u_regs.m_set_dr13.eq(
                Mux(u_call.mgt_set_trigger, u_call.mgt_ns_authority,
                    cr15_ns_view_mset.word2_w2)
            ),
            u_regs.m_set_dr14.eq(
                Mux(u_call.mgt_set_trigger, u_call.mgt_ns_integrity,
                    cr15_m_set_integrity)
            ),
            u_regs.m_set_dr15.eq(
                Mux(u_call.mgt_set_trigger, u_call.mgt_ns_seals,
                    0)   # cr15_m_set path: seals word not available; DR15=0
            ),
        ]

        with m.If(u_return.reboot_request | (self.fault_valid & self.boot_complete)):
            m.d.sync += [boot_state_reg.eq(BootState.FAULT_RST), nia_reg.eq(0)]
        with m.Elif(clear_all):
            m.d.sync += nia_reg.eq(0)
        with m.Elif(self.free_run_start):
            m.d.sync += nia_reg.eq(self.free_run_nia)
        if not self.iot_profile:
            with m.Elif(u_lambda.nia_set):
                m.d.sync += nia_reg.eq(u_lambda.nia_value)
            with m.Elif(u_xloadlambda.nia_set):
                m.d.sync += nia_reg.eq(u_xloadlambda.nia_value)
        with m.Elif(u_return.nia_set):
            m.d.sync += nia_reg.eq(u_return.nia_value)
        with m.Elif(u_call.nia_set):
            m.d.sync += nia_reg.eq(u_call.nia_value)
        if not self.iot_profile:
            with m.Elif(u_eloadcall.nia_set):
                m.d.sync += nia_reg.eq(u_eloadcall.nia_value)
            with m.Elif(u_irq_dispatch.nia_set):
                m.d.sync += nia_reg.eq(u_irq_dispatch.nia_value)
        with m.Elif(branch_taken & ~fetch_bounds_fault):
            # PC-relative branch: nia += sign_extend(imm) * 4.
            # Gated by ~fetch_bounds_fault: if the *current* nia is already out-of-range
            # the BOUNDS fault is raised instead; nia must not advance further.
            m.d.sync += nia_reg.eq(nia_reg + Cat(C(0, 2), branch_sx32))
        with m.Elif(
            self.boot_complete & u_decoder.instr_valid & ~any_unit_busy
            & ~fetch_bounds_fault & ~u_outform_fsm.intercept_start
        ):
            # Advance PC for all instructions (including not-taken branches).
            # ~fetch_bounds_fault ensures nia never advances on a BOUNDS-fault cycle.
            # ~u_outform_fsm.intercept_start holds the PC at the CALL instruction
            # when a Mode 2 Outform intercept fires; the CALL is replayed once the
            # FSM promotes the source CR and releases busy.
            m.d.sync += nia_reg.eq(nia_reg + 4)

        # Code fence management — separate priority chain from nia update.
        #
        # Priority (highest first):
        #   1. Reboot / global reset: clear fence + cancel any pending transition.
        #   2. Cross-domain RETURN: set fence_pending to stall fetch until cload restores
        #      CR14.  The callee's fence is KEPT (not cleared) so that the BOUNDS check
        #      cannot fire during the stall (any_unit_busy already blocks decode, but
        #      keeping the old fence avoids an inactive-fence window entirely).
        #   3. Lambda-fast RETURN (~cross_domain_ret): no cload follows, fence goes
        #      inactive immediately (caller's context had no fence at lambda entry).
        #   4. cload writes CR14: fence_pending cleared, new fence established from the
        #      restored caller code cap.  This is the exclusive path to re-activate the
        #      fence after a cross-domain RETURN.
        #   5. LAMBDA / ELOADCALL / XLOADLAMBDA: entering unknown code, fence suspended.
        #   6. CALL completing: establish callee fence from CALL unit outputs.
        with m.If(u_return.reboot_request | clear_all):
            # Reboot or global reset — wipe everything immediately.
            m.d.sync += [
                code_lo_reg.eq(0),
                code_hi_reg.eq(0),
                fence_pending_reg.eq(0),
            ]
        with m.Elif(u_return.complete & cross_domain_ret):
            # Cross-domain RETURN: stall instruction execution until cload restores CR14.
            # Old fence (callee's bounds) is intentionally kept; fetch is blocked by
            # fence_pending_reg contribution to any_unit_busy, so no false BOUNDS fault.
            m.d.sync += fence_pending_reg.eq(1)
        with m.Elif(u_return.complete & ~cross_domain_ret):
            # Lambda-fast RETURN: no cload follows — fence goes inactive.
            m.d.sync += [code_lo_reg.eq(0), code_hi_reg.eq(0)]
        with m.Elif(u_cload.cr_wr_en & (u_cload.cr_wr_addr == CR_CLOOMC)):
            # cload (triggered by cross-domain RETURN) restores the caller's code cap
            # into CR14.  Re-establish the fence and release the stall.
            cr14_cload_view = View(CAP_REG_LAYOUT, u_cload.cr_wr_data)
            cr14_cload_w2   = View(WORD2_LAYOUT,   cr14_cload_view.word2_w2)
            m.d.sync += [
                fence_pending_reg.eq(0),
                code_lo_reg.eq(cr14_cload_view.word1_location),
                code_hi_reg.eq(
                    cr14_cload_view.word1_location +
                    ((cr14_cload_w2.limit_offset + 1) << 2)   # limit_offset inclusive (cw-1)
                ),
            ]
        if not self.iot_profile:
            with m.Elif(u_lambda.nia_set | u_eloadcall.nia_set | u_xloadlambda.nia_set | u_irq_dispatch.nia_set):
                m.d.sync += [code_lo_reg.eq(0), code_hi_reg.eq(0)]
        with m.Elif(u_call.call_normal_complete):
            # Normal CALL completed — establish callee fence from CALL unit byte-address outputs.
            # Abstract-GT CALL (M_FETCH_DONE) does not update the code fence.
            m.d.sync += [
                code_lo_reg.eq(u_call.code_lo_out),
                code_hi_reg.eq(u_call.code_hi_out),
            ]

        m.d.comb += [
            self.imem_addr.eq(nia_reg),
            self.nia.eq(nia_reg),
            self.flags.eq(u_regs.flags),
        ]

        boot_wr_en = [Signal(name=f"boot_cap{i}_wr_en") for i in range(16)]
        boot_wr_gt = [Signal(GT_LAYOUT, name=f"boot_cap{i}_wr_gt") for i in range(16)]

        with m.Switch(boot_state_reg):
            with m.Case(BootState.LOAD_NS):
                # CR15 (namespace cap): full 96-bit write to include word1_location=0
                # (NS at dmem byte 0) and word2_w2=18 (limit: slots 0..18 accessible).
                # ns_gt: slot_id=0, gt_seq=0, GT_TYPE_INFORM, perms=0
                # word0_gt = (GT_TYPE_INFORM<<25) | 0 = 0x02000000 ★v2.0
                # Slots 16=SlideRule, 17=(empty), 18=Constants
                m.d.comb += [
                    boot_cap_wr_en.eq(1),
                    boot_cap_wr_addr.eq(15),
                    boot_cap_wr_data.eq(Cat(
                        C(0x02000000, 32),  # word0_gt: GT_TYPE_INFORM, slot_id=0 ★v2.0
                        C(0,          32),  # word1_location = 0 (NS at dmem start)
                        C(18,         32),  # word2_w2: limit_offset=18 (slots 0-18)
                    )),
                ]
            with m.Case(BootState.INIT_THRD):
                thrd_gt = Signal(GT_LAYOUT)
                thrd_gt_view = View(GT_LAYOUT, thrd_gt)
                m.d.comb += [
                    thrd_gt_view.slot_id.eq(1),
                    thrd_gt_view.gt_seq.eq(0),
                    thrd_gt_view.gt_type.eq(GT_TYPE_INFORM),
                    thrd_gt_view.dom.eq(0),   # Turing, no perms (M-only, transient)
                    thrd_gt_view.perm.eq(0),
                ]
                m.d.comb += [boot_wr_en[8].eq(1), boot_wr_gt[8].eq(thrd_gt)]
            with m.Case(BootState.INIT_CLIST):
                # CR6 (c-list cap): full 96-bit write to include word1_location=0x400
                # (DEMO_CLIST at dmem byte 0x400 = word 256) and word2_w2=63
                # (limit: indices 0..63 accessible).
                # cr6_gt: slot_id=2, GT_TYPE_INFORM, E-perm (Church dom=1, perm=0b100), gt_seq=0
                # v2.0 GT word layout: b_flag[31] | perm[30:28] | dom[27] | gt_type[26:25] | gt_seq[24:16] | slot[15:0]
                # word0_gt = (0b100<<28)|(1<<27)|(GT_TYPE_INFORM<<25)|2 = 0x4A000002 ★v2.0
                m.d.comb += [
                    boot_cap_wr_en.eq(1),
                    boot_cap_wr_addr.eq(6),
                    boot_cap_wr_data.eq(Cat(
                        C(0x4A000002, 32),  # word0_gt: Church E-perm (dom=1,perm=0b100), GT_TYPE_INFORM, slot=2 ★v2.0
                        C(0x400,      32),  # word1_location = 0x400 (DEMO_CLIST base)
                        C(63,         32),  # word2_w2: limit_offset=63 (64 entries)
                    )),
                ]
            with m.Case(BootState.LOAD_NUC):
                # CR14 (code cap): boot code domain — slot 3, Turing X-perm.
                # Slot 3 is the hardware-privileged boot code domain; no user-visible
                # NS table entry. After the BOOT_PROGRAM CALL, CR14 is reloaded by
                # cload with the Application LUMP's code capability.
                cr14_gt = Signal(GT_LAYOUT)
                cr14_gt_view = View(GT_LAYOUT, cr14_gt)
                m.d.comb += [
                    cr14_gt_view.slot_id.eq(3),
                    cr14_gt_view.gt_seq.eq(0),
                    cr14_gt_view.gt_type.eq(GT_TYPE_INFORM),
                    cr14_gt_view.dom.eq(0),        # Turing domain
                    cr14_gt_view.perm.eq(0b100),   # X = perm[2] in Turing domain
                ]
                m.d.comb += [boot_wr_en[14].eq(1), boot_wr_gt[14].eq(cr14_gt)]

                # Boot fence: BOOT_PROGRAM occupies IMEM byte addresses [0, NUC_LUMP_BASE).
                # NUC_LUMP_BASE is derived from len(BOOT_PROGRAM) in boot_rom.py —
                # never a hardcoded magic number. Fence is cleared by LAMBDA mid-boot
                # and re-established for the NUC_PROGRAM domain by CALL/cload.
                m.d.sync += [
                    code_lo_reg.eq(0),
                    code_hi_reg.eq(NUC_LUMP_BASE),
                ]

        runtime_wr_en = [Signal(name=f"rt_cap{i}_wr_en") for i in range(16)]
        runtime_wr_gt = [Signal(GT_LAYOUT, name=f"rt_cap{i}_wr_gt") for i in range(16)]

        if not self.iot_profile:
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

        # Detect Outform GT (type=0b10) in the source register at CALL decode time.
        # When present, the ChurchOutformFSM intercepts before the CALL unit starts
        # to lazily install the absent lump, then promotes the GT to Inform type.
        _call_src_gt_view = View(GT_LAYOUT, perm_gt_sig)
        _call_src_is_outform = Signal(name="call_src_is_outform")
        m.d.comb += _call_src_is_outform.eq(
            _call_src_gt_view.gt_type == GT_TYPE_OUTFORM
        )

        # Suppress call_start while the source CR holds an Outform GT.
        # After ChurchOutformFSM promotes it to Inform, the CALL retries normally.
        m.d.comb += call_start_sig.eq(
            cond_exec_enable & is_church_op & (church_op == ChurchOpcode.CALL) &
            ~any_unit_busy & ~_call_src_is_outform
        )

        # Trigger the ChurchOutformFSM when a CALL sees an Outform source GT.
        m.d.comb += [
            u_outform_fsm.intercept_start.eq(
                cond_exec_enable & is_church_op & (church_op == ChurchOpcode.CALL) &
                ~any_unit_busy & _call_src_is_outform
            ),
            u_outform_fsm.src_cr.eq(cr_src),
            u_outform_fsm.src_cr_data.eq(u_regs.cr_rd_data),
        ]

        m.d.comb += [
            u_call.call_start.eq(call_start_sig),
            u_call.cr_src.eq(cr_src),
            u_call.index.eq(0),               # CALL uses call_imm for method-table dispatch; c-list index always 0
            u_call.call_imm.eq(u_decoder.call_imm),
            u_call.mask.eq(u_decoder.call_mask),
            u_call.cr_rd_data.eq(u_regs.cr_rd_data),
            u_call.cr15_namespace.eq(u_regs.cr15_namespace),
            u_call.cr14_code.eq(u_regs.cr14_code),
            u_call.mem_rd_data.eq(self.dmem_rd_data),
            u_call.mem_rd_valid.eq(self.dmem_rd_valid),
            # Stack push inputs
            u_call.cr5_heap.eq(u_regs.cr5_heap),
            u_call.caller_pc.eq(nia_reg[2:17]),           # CALL word offset (nia_reg >> 2)
            u_call.cr12_thread.eq(u_regs.cr12_thread),
            u_call.thread_base.eq(View(CAP_REG_LAYOUT, u_regs.cr12_thread).word1_location),
            # THREAD_HDR: populated by CHANGE on thread restore, cached for CALL's stack validation
            u_call.thread_hdr.eq(u_change.thread_hdr_out if not self.iot_profile else 0),
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
            u_return.cr5_heap.eq(u_regs.cr5_heap),
            u_return.cr12_thread.eq(u_regs.cr12_thread),
            u_return.mem_rd_data.eq(self.dmem_rd_data),
            u_return.mem_rd_valid.eq(self.dmem_rd_valid),
        ]

        with m.If(ret_start_sig):
            m.d.sync += cross_domain_ret.eq(~lambda_active_reg)

        with m.If(u_return.complete & ~u_return.fault_valid & ~u_return.reboot_request & cross_domain_ret):
            m.d.sync += cload_pending.eq(1)
        with m.Elif(cload_pending):
            m.d.sync += cload_pending.eq(0)

        m.d.comb += [
            u_cload.cload_start.eq(cload_pending),
            u_cload.e_gt.eq(u_return.cload_e_gt),
            u_cload.cr15_namespace.eq(u_regs.cr15_namespace),
            u_cload.mem_rd_data.eq(self.dmem_rd_data),
            u_cload.mem_rd_valid.eq(self.dmem_rd_valid),
        ]

        if not self.iot_profile:
            with m.If(clear_all):
                m.d.sync += [lambda_active_reg.eq(0), lambda_pc_reg.eq(0)]
            with m.Elif(u_return.lambda_clear):
                m.d.sync += lambda_active_reg.eq(0)
            with m.Elif(u_call.call_normal_complete & ~u_call.call_fault):
                m.d.sync += lambda_active_reg.eq(0)
            with m.Elif(u_lambda.lambda_complete & ~u_lambda.lambda_fault):
                m.d.sync += [lambda_active_reg.eq(1), lambda_pc_reg.eq(u_lambda.saved_nia)]

            m.d.comb += [
                u_lambda.lambda_start.eq(lambda_start_sig),
                u_lambda.cr_target.eq(cr_dst),
                u_lambda.cr_rd_data.eq(u_regs.cr_rd_data),
                u_lambda.saved_nia.eq(nia_reg + 4),
            ]
        else:
            with m.If(clear_all):
                m.d.sync += [lambda_active_reg.eq(0), lambda_pc_reg.eq(0)]

        m.d.comb += tperm_start_sig.eq(
            cond_exec_enable & is_church_op & (church_op == ChurchOpcode.TPERM) & ~any_unit_busy
        )
        m.d.comb += [
            u_tperm.tperm_start.eq(tperm_start_sig),
            u_tperm.cr_target.eq(cr_dst),
            u_tperm.cr_src.eq(cr_src),
            u_tperm.preset.eq(u_decoder.tperm_preset),
            u_tperm.cr_rd_data.eq(u_regs.cr_rd_data),
            # FRAME preset: Z=1 if a real return frame exists (STO < sp_max).
            # STO is held in thread memory (Heap[0]); a cached register is needed
            # to drive this without a memory read cycle.  Tied to 0 until the
            # thread-scheduler exposes a cached sto_reg signal here.
            # TODO: wire to sto_cached < sp_max when core gains an STO cache.
            u_tperm.stack_has_frame.eq(0),
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
            u_save.mem_rd_valid.eq(self.dmem_rd_valid),
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
            # DR read port for indexed-mode DRx: feed from register port 1
            u_dread.dr_rd_data.eq(u_regs.dr_rd_data1),
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
            # Port 1: source data DR[dr_src] — still via register port 2
            u_dwrite.dr_rd_data.eq(u_regs.dr_rd_data2),
            # Port 2 (DRx for indexed mode): read via register port 1
            u_dwrite.dr_rd_data2.eq(u_regs.dr_rd_data1),
        ]
        # dr_rd_addr2: dwrite source data and BFINS use port 2
        m.d.comb += u_regs.dr_rd_addr2.eq(
            Mux(u_dwrite.busy, u_dwrite.dr_rd_addr,
                Mux(bfins_start_sig, cr_dst, 0))
        )
        # dr_rd_addr1: dread DRx, dwrite DRx, IADD/ISUB/SHL/SHR/BFEXT/BFINS/MCMP/CHANGE
        # (dread/dwrite busy is mutually exclusive with the arithmetic ops via any_unit_busy)

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

        # Source DR read port 1 — shared by DREAD/DWRITE (indexed DRx), IADD/ISUB,
        # SHL/SHR/BFEXT/BFINS/MCMP.  dread/dwrite busy is mutually exclusive with
        # all arithmetic ops (any_unit_busy prevents their simultaneous dispatch).
        m.d.comb += u_regs.dr_rd_addr1.eq(
            Mux(u_dread.busy, u_dread.dr_rd_addr,
                Mux(u_dwrite.busy, u_dwrite.dr_rd_addr2,
                    Mux(iadd_start_sig | isub_start_sig |
                        shl_start_sig | shr_start_sig |
                        bfext_start_sig | bfins_start_sig | mcmp_start_sig,
                        cr_src, 0)))
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

        # ── SHL / SHR ────────────────────────────────────────────────────────
        # Shift on data registers.
        # DR[dst] = DR[src] << imm[4:0]              (SHL — shift left)
        # DR[dst] = DR[src] >> imm[4:0]  LSR          (SHR imm[5]=0 — logical shift right, zero-fill)
        # DR[dst] = DR[src] >>> imm[4:0] ASR          (SHR imm[5]=1 — arithmetic shift right, sign-extend)
        # Flags: N = result[31], Z = (result==0), C = last bit shifted out, V = 0.
        # Shift amount: imm[4:0] (0-31).  SHR mode:   imm[5]=0 LSR, imm[5]=1 ASR.

        m.d.comb += [
            shl_start_sig.eq(cond_exec_enable & is_shl_op & ~any_unit_busy),
            shr_start_sig.eq(cond_exec_enable & is_shr_op & ~any_unit_busy),
        ]
        m.d.sync += [
            shl_busy_reg.eq(shl_start_sig & ~shl_busy_reg),
            shr_busy_reg.eq(shr_start_sig & ~shr_busy_reg),
        ]

        shift_amt = Signal(5)
        m.d.comb += shift_amt.eq(u_decoder.immediate[0:5])

        # SHL result (logical left shift — always zero-fills from the right)
        m.d.comb += shl_result.eq(u_regs.dr_rd_data1 << shift_amt)

        # SHR: choose between LSR (zero-fill) and ASR (sign-extend) based on imm[5]
        asr_mode = Signal()
        m.d.comb += asr_mode.eq(u_decoder.immediate[5])

        # Sign-extend source to 64 bits for arithmetic shift right
        shr_src_sx = Signal(64)
        m.d.comb += shr_src_sx.eq(Cat(u_regs.dr_rd_data1, u_regs.dr_rd_data1[31].replicate(32)))
        lsr_result = Signal(32)
        asr_result = Signal(32)
        m.d.comb += [
            lsr_result.eq(u_regs.dr_rd_data1 >> shift_amt),
            asr_result.eq((shr_src_sx >> shift_amt)[:32]),
            shr_result.eq(Mux(asr_mode, asr_result, lsr_result)),
        ]

        # C flag = last bit shifted out, gated on shift_amt > 0
        # SHR: last bit out = source[shift_amt - 1]  → (source >> (shift_amt-1))[0]
        # SHL: last bit out = source[32 - shift_amt] → (source >> (32-shift_amt))[0]
        shr_c_bit = Signal()
        shl_c_bit = Signal()
        shr_c_shift = Signal(5)
        shl_c_shift = Signal(6)
        m.d.comb += [
            shr_c_shift.eq((shift_amt - 1)[:5]),
            shl_c_shift.eq((32 - shift_amt)[:6]),
            shr_c_bit.eq(Mux(shift_amt == 0, 0,
                             (u_regs.dr_rd_data1 >> shr_c_shift)[0])),
            shl_c_bit.eq(Mux(shift_amt == 0, 0,
                             (u_regs.dr_rd_data1 >> shl_c_shift)[0])),
        ]

        shl_flags_view = View(COND_FLAGS_LAYOUT, shl_flags_sig)
        shr_flags_view = View(COND_FLAGS_LAYOUT, shr_flags_sig)
        m.d.comb += [
            shl_flags_view.N.eq(shl_result[31]),
            shl_flags_view.Z.eq(shl_result == 0),
            shl_flags_view.C.eq(shl_c_bit),
            shl_flags_view.V.eq(0),
            shr_flags_view.N.eq(shr_result[31]),
            shr_flags_view.Z.eq(shr_result == 0),
            shr_flags_view.C.eq(shr_c_bit),
            shr_flags_view.V.eq(0),
        ]

        # ── BFEXT ────────────────────────────────────────────────────────────
        # Bit-field extract.
        # DR[dst] = (DR[src] >> offset) & ((1 << width) - 1)
        # imm[4:0]  = offset (0-31)
        # imm[9:5]  = width  (1-32, encoded as 0-31 where 0 means 32)
        # Flags: N = result[31], Z = (result==0), C = 0, V = 0.

        m.d.comb += bfext_start_sig.eq(cond_exec_enable & is_bfext_op & ~any_unit_busy)
        m.d.sync += bfext_busy_reg.eq(bfext_start_sig & ~bfext_busy_reg)

        bf_offset = Signal(5)
        bf_width  = Signal(5)
        bf_mask   = Signal(32)
        m.d.comb += [
            bf_offset.eq(u_decoder.immediate[0:5]),
            bf_width.eq(u_decoder.immediate[5:10]),
            bf_mask.eq((1 << bf_width) - 1),
            bfext_result.eq((u_regs.dr_rd_data1 >> bf_offset) & bf_mask),
        ]

        bfext_flags_view = View(COND_FLAGS_LAYOUT, bfext_flags_sig)
        m.d.comb += [
            bfext_flags_view.N.eq(bfext_result[31]),
            bfext_flags_view.Z.eq(bfext_result == 0),
            bfext_flags_view.C.eq(0),
            bfext_flags_view.V.eq(0),
        ]

        # ── BFINS ────────────────────────────────────────────────────────────
        # Bit-field insert.
        # DR[dst] = (DR[dst] & ~mask_shifted) | ((DR[src] & mask) << offset)
        # imm[4:0]  = offset (0-31)
        # imm[9:5]  = width  (encoded same as BFEXT)
        # dr_rd_data1 = DR[cr_src] (value to insert, read on port 1)
        # dr_rd_data2 = DR[cr_dst] (existing destination, read on port 2)
        # Flags: N = result[31], Z = (result==0), C = 0, V = 0.

        m.d.comb += bfins_start_sig.eq(cond_exec_enable & is_bfins_op & ~any_unit_busy)
        m.d.sync += bfins_busy_reg.eq(bfins_start_sig & ~bfins_busy_reg)

        bfins_mask_shifted = Signal(32)
        m.d.comb += [
            bfins_mask_shifted.eq(bf_mask << bf_offset),
            bfins_result.eq(
                (u_regs.dr_rd_data2 & ~bfins_mask_shifted) |
                ((u_regs.dr_rd_data1 & bf_mask) << bf_offset)
            ),
        ]

        bfins_flags_view = View(COND_FLAGS_LAYOUT, bfins_flags_sig)
        m.d.comb += [
            bfins_flags_view.N.eq(bfins_result[31]),
            bfins_flags_view.Z.eq(bfins_result == 0),
            bfins_flags_view.C.eq(0),
            bfins_flags_view.V.eq(0),
        ]

        # ── MCMP ─────────────────────────────────────────────────────────────
        # Compare (flags-only subtract, no register write).
        # flags = flags_of(DR[src] - sign_extend(imm))
        # Equivalent to ISUB but discards the result.
        # Flags: N = result[31], Z = (result==0), C = borrow-out, V = 0.

        m.d.comb += mcmp_start_sig.eq(cond_exec_enable & is_mcmp_op & ~any_unit_busy)
        m.d.sync += mcmp_busy_reg.eq(mcmp_start_sig & ~mcmp_busy_reg)

        m.d.comb += mcmp_result.eq(u_regs.dr_rd_data1 - arith_imm_sx)

        mcmp_flags_view = View(COND_FLAGS_LAYOUT, mcmp_flags_sig)
        m.d.comb += [
            mcmp_flags_view.N.eq(mcmp_result[31]),
            mcmp_flags_view.Z.eq(mcmp_result[:32] == 0),
            mcmp_flags_view.C.eq(mcmp_result[32]),
            mcmp_flags_view.V.eq(0),
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

        if not self.iot_profile:
            change_start_sig = Signal()
            m.d.comb += change_start_sig.eq(
                cond_exec_enable & is_church_op & (church_op == ChurchOpcode.CHANGE) & ~any_unit_busy
            )
            m.d.comb += [
                u_change.change_start.eq(change_start_sig),
                u_change.cr_src.eq(cr_src),
                u_change.cr_dst.eq(cr_dst),
                u_change.m_elevated.eq(boot_state_reg != BootState.COMPLETE),
                u_change.index.eq(cap_index),
                u_change.change_mask.eq(u_decoder.call_mask),
                u_change.cr_rd_data.eq(u_regs.cr_rd_data),
                u_change.cr12_thread.eq(u_regs.cr12_thread),
                u_change.cr15_namespace.eq(u_regs.cr15_namespace),
                u_change.mem_rd_data.eq(self.dmem_rd_data),
                u_change.mem_rd_valid.eq(self.dmem_rd_valid),
                u_change.mem_wr_done.eq(1),
                u_change.dr_rd_data.eq(u_regs.dr_rd_data1),
                u_change.nia.eq(nia_reg),
                u_change.flags.eq(u_regs.flags),
                # M-flag save/restore (Task #432): pass current M-flag in; get restore
                # enable/val out (wired below alongside other u_regs controls).
                u_change.cr15_m_flag_in.eq(u_regs.cr15_m_flag),
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
                u_switch.mem_rd_valid.eq(self.dmem_rd_valid),
            ]

            eloadcall_start_sig = Signal()
            m.d.comb += eloadcall_start_sig.eq(
                cond_exec_enable & is_church_op & (church_op == ChurchOpcode.ELOADCALL) & ~any_unit_busy
            )
            m.d.comb += [
                u_eloadcall.start.eq(eloadcall_start_sig),
                u_eloadcall.cr_src.eq(cr_src),
                u_eloadcall.cr_dst.eq(cr_dst),
                u_eloadcall.index.eq(u_decoder.eloadcall_clist_row),
                u_eloadcall.mask.eq(u_decoder.call_mask),
                u_eloadcall.call_imm.eq(u_decoder.eloadcall_method_index),  # method-table slot (1-based)
                u_eloadcall.cr_rd_data.eq(u_regs.cr_rd_data),
                u_eloadcall.cr15_namespace.eq(u_regs.cr15_namespace),
                u_eloadcall.mem_rd_data.eq(self.dmem_rd_data),
                u_eloadcall.mem_rd_valid.eq(self.dmem_rd_valid),
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
                u_xloadlambda.mem_rd_valid.eq(self.dmem_rd_valid),
            ]

            # ── PetNameMemory wiring (Task #1526) ────────────────────────────
            # Read port: ELoadCall and XLoadLambda are mutually exclusive, so
            # mux their pet_name_rd_addr; both receive the same rd_data result.
            m.d.comb += [
                u_pet_name_mem.rd_addr.eq(
                    Mux(u_eloadcall.busy,
                        u_eloadcall.pet_name_rd_addr,
                        u_xloadlambda.pet_name_rd_addr)
                ),
                u_eloadcall.pet_name_rd_data.eq(u_pet_name_mem.rd_data),
                u_xloadlambda.pet_name_rd_data.eq(u_pet_name_mem.rd_data),
            ]

            # ── ChurchIRQDispatch wiring (Task #1523) ────────────────────────
            from .hw_types import IRQ_REASON_TIMER, IRQ_REASON_LAZY_LOAD, IRQ_REASON_LAZY_RESOLVE

            irq_dispatch_start  = Signal()
            irq_dispatch_reason = Signal(2)
            irq_dispatch_slot   = Signal(16)

            # Priority: TIMER > LAZY_LOAD > LAZY_RESOLVE.
            # All three are mutually exclusive in practice (one per instruction
            # boundary), but the priority chain makes it deterministic.
            m.d.comb += [
                irq_dispatch_reason.eq(
                    Mux(self.timer_alarm,        IRQ_REASON_TIMER,
                    Mux(u_call.lazy_load_irq,    IRQ_REASON_LAZY_LOAD,
                                                 IRQ_REASON_LAZY_RESOLVE))
                ),
                irq_dispatch_slot.eq(
                    Mux(self.timer_alarm,        0,
                    Mux(u_call.lazy_load_irq,    u_call.lazy_load_ns_slot,
                    Mux(u_eloadcall.lazy_resolve_irq, u_eloadcall.lazy_resolve_slot,
                                                 u_xloadlambda.lazy_resolve_slot)))
                ),
                irq_dispatch_start.eq(
                    (self.timer_alarm | u_call.lazy_load_irq |
                     u_eloadcall.lazy_resolve_irq | u_xloadlambda.lazy_resolve_irq)
                    & ~u_irq_dispatch.busy
                ),
                u_irq_dispatch.start.eq(irq_dispatch_start),
                u_irq_dispatch.irq_reason.eq(irq_dispatch_reason),
                u_irq_dispatch.irq_slot.eq(irq_dispatch_slot),
                u_irq_dispatch.cr15_namespace.eq(u_regs.cr15_namespace),
                u_irq_dispatch.mem_rd_data.eq(self.dmem_rd_data),
                u_irq_dispatch.mem_rd_valid.eq(self.dmem_rd_valid),
            ]
            m.d.comb += [  # re-open bracket to match trailing close below
                u_xloadlambda.saved_nia.eq(nia_reg + 4),
            ]

        # ── outform wiring ───────────────────────────────────────────────────
        # Three sources can trigger the outform download engine:
        #   1. u_shared_mload.outform_start_out — mLoad intercepted Outform GT in c-list
        #   2. self.outform_start_in            — test injection (bypasses CPU path)
        #   3. u_outform_fsm.outform_start_out  — Mode 2: CALL source CR is Outform GT
        _outform_start = Signal()
        m.d.comb += _outform_start.eq(
            u_shared_mload.outform_start_out |
            self.outform_start_in |
            u_outform_fsm.outform_start_out
        )

        # Track whether Mode 2 (ChurchOutformFSM) triggered the current download.
        # This gates done/fault routing so each consumer only sees its own events.
        outform_mode2_active = Signal(name="outform_mode2_active")
        with m.If(u_outform_fsm.outform_start_out):
            m.d.sync += outform_mode2_active.eq(1)
        with m.Elif(u_outform.outform_done | u_outform.outform_fault):
            m.d.sync += outform_mode2_active.eq(0)

        m.d.comb += [
            u_outform.outform_start.eq(_outform_start),
            u_outform.gt_raw.eq(
                Mux(self.outform_start_in, self.outform_gt_raw_in,
                    Mux(u_outform_fsm.outform_start_out, u_outform_fsm.outform_gt_raw_out,
                        u_shared_mload.outform_gt_raw))
            ),
            u_outform.slot_id.eq(
                Mux(self.outform_start_in, self.outform_slot_id_in,
                    Mux(u_outform_fsm.outform_start_out, u_outform_fsm.outform_slot_id_out,
                        u_shared_mload.outform_slot_id))
            ),
            u_outform.rx_valid.eq(self.outform_rx_valid),
            u_outform.rx_data.eq(self.outform_rx_data),
            self.outform_tx_valid.eq(u_outform.tx_valid),
            self.outform_tx_data.eq(u_outform.tx_data),
            self.outform_result_gt.eq(u_outform.result_gt),
            self.outform_busy.eq(u_outform.outform_busy),
            self.outform_fsm_busy.eq(u_outform_fsm.busy),
            u_outform.tx_ack.eq(self.outform_tx_ack),
            # Route done/fault to mLoad (Mode 1) or to the intercept FSM (Mode 2)
            u_shared_mload.outform_done_in.eq(u_outform.outform_done & ~outform_mode2_active),
            u_shared_mload.outform_fault_in.eq(u_outform.outform_fault & ~outform_mode2_active),
            u_shared_mload.outform_fault_type_in.eq(u_outform.outform_fault_type),
            u_outform_fsm.outform_done_in.eq(
                (u_outform.outform_done | self.dbg_outform_done_inject) & outform_mode2_active
            ),
            u_outform_fsm.outform_fault_in.eq(u_outform.outform_fault & outform_mode2_active),
            u_outform_fsm.outform_fault_type_in.eq(u_outform.outform_fault_type),
            u_outform_fsm.result_gt_in.eq(
                Mux(self.dbg_outform_done_inject, self.dbg_outform_result_gt, u_outform.result_gt)
            ),
        ]

        # Latch Mint context (slot_id + clist_addr) whenever any source fires
        # outform_start. This applies to both IoT and non-IoT profiles; the Mint
        # FSM in each profile reads mint_slot_id_reg / mint_clist_addr_reg.
        with m.If(_outform_start):
            m.d.sync += [
                mint_slot_id_reg.eq(
                    Mux(self.outform_start_in, self.outform_slot_id_in,
                        Mux(u_outform_fsm.outform_start_out, u_outform_fsm.outform_slot_id_out,
                            u_shared_mload.outform_slot_id))
                ),
                # For Mode 2 (ChurchOutformFSM), clist_addr is a dummy (0).
                # The Mint WRITE_CLIST step writes an E-GT to clist[0].  This
                # is architecturally safe: slot_id=0 is permanently reserved for
                # the NULL GT type (gt_type=0b00), and no valid capref ever has
                # slot_id=0.  Writing to clist[0] therefore never clobbers a live
                # capability.  The promoted GT keeps the Outform GT's original
                # slot_id (non-zero), so this dummy clist write is fully isolated
                # from the CR promotion performed by ChurchOutformFSM.
                mint_clist_addr_reg.eq(
                    Mux(self.outform_start_in, self.outform_clist_addr_in,
                        Mux(u_outform_fsm.outform_start_out, u_outform_fsm.outform_clist_addr_out,
                            u_shared_mload.outform_clist_addr))
                ),
            ]

        if self.iot_profile:
            # ── Watermark allocator ───────────────────────────────────────────
            # NS(192 words) + clist(64 words) = 256 words; free space starts at 256.
            WATERMARK_INIT = 256
            DMEM_WORDS     = 2048
            watermark_reg   = Signal(32, init=WATERMARK_INIT)
            alloc_sz_w      = Signal(32)
            alloc_mask_w    = Signal(32)
            alloc_aligned_w = Signal(32)
            alloc_new_wm_w  = Signal(33)

            m.d.comb += alloc_sz_w.eq(C(1, 32) << u_outform.alloc_n)
            m.d.comb += alloc_mask_w.eq(alloc_sz_w - 1)
            m.d.comb += alloc_aligned_w.eq(
                (watermark_reg + alloc_mask_w) & ~alloc_mask_w
            )
            m.d.comb += alloc_new_wm_w.eq(
                Cat(alloc_aligned_w, C(0, 1)) + Cat(alloc_sz_w, C(0, 1))
            )
            alloc_fits  = Signal()
            alloc_n_ok  = Signal()
            m.d.comb += alloc_fits.eq(alloc_new_wm_w <= DMEM_WORDS)
            # Enforce alloc_n in [6, 14] (lump sizes 64..16384 words)
            m.d.comb += alloc_n_ok.eq(
                (u_outform.alloc_n >= 6) & (u_outform.alloc_n <= 14)
            )

            m.d.comb += [
                u_outform.alloc_done.eq(
                    u_outform.alloc_req & alloc_fits & alloc_n_ok
                ),
                u_outform.alloc_fault.eq(
                    u_outform.alloc_req & (~alloc_fits | ~alloc_n_ok)
                ),
                u_outform.alloc_base.eq(alloc_aligned_w << 2),
            ]
            with m.If(u_outform.alloc_req & alloc_fits & alloc_n_ok):
                m.d.sync += watermark_reg.eq(alloc_new_wm_w[:32])

            # ── Mint FSM ──────────────────────────────────────────────────────
            # Validates the newly downloaded lump, writes the NS entry (3 words),
            # copies the cc lump-tail GTs into the clist BRAM, then patches the
            # caller's c-list slot with the fresh E-GT.
            mint_base_reg      = Signal(32)
            mint_cw_reg        = Signal(13)
            mint_cc_reg        = Signal(8)
            mint_scan_idx_reg  = Signal(14)
            mint_copy_idx_reg  = Signal(8)   # loop counter for cc-word copy
            mint_copy_data_reg = Signal(32)  # holds DMEM word between read→write cycles
            mint_hdr_reg       = Signal(32)
            # Registered (lump_size − cc_count) — precomputed in MINT_WRITE_NS3 so
            # the MINT_COPY_CLIST_RD cc_off expression stays binary (2-operand) and
            # Yosys alumacc cannot merge it into a multi-term $macc cell.
            mint_cc_base_reg   = Signal(15)

            # NS entry byte address: CR15.base + slot_id << 4 (16-byte stride)
            cr15_mint_view     = View(CAP_REG_LAYOUT, u_regs.cr15_namespace)
            mint_ns_entry_base = Signal(32)
            m.d.comb += mint_ns_entry_base.eq(
                cr15_mint_view.word1_location + (mint_slot_id_reg << 4)
            )

            # c-list BRAM base for the new slot (after NS area):
            #   NS_WORDS = 192 (16 slots × 12 words); c-list starts at byte 768.
            #   Slot s gets 64 words = 256 bytes.
            #   Base = (192 + slot_id * 64) * 4 = 768 + (slot_id << 8)
            #        = (3 + slot_id) << 8   (since 768 = 3 << 8)
            # Use Cat to shift — avoids a second $add that alumacc could merge into
            # a 3-term $macc with the downstream address addition.
            mint_clist_slot_base  = Signal(32)
            mint_slot_id_p3       = Signal(17)  # slot_id + 3  (at most 65538)
            m.d.comb += mint_slot_id_p3.eq(mint_slot_id_reg + 3)
            m.d.comb += mint_clist_slot_base.eq(Cat(Const(0, 8), mint_slot_id_p3))

            # E-GT:  b=0 | perm[2:0]=0b100(bit30) | dom=1(bit27) | typ=Inform(01<<25) | gt_seq=1(<<16) | slot_id ★v2.0
            # v2.0 GT layout: dom=1 (Church), perm[2]=E → 0x4A000000 | (GT_TYPE_INFORM<<25) | (1<<16) | slot
            m.d.comb += mint_e_gt_d.eq(
                (1 << 30) | (1 << GT_DOM_BIT) | (GT_TYPE_INFORM << 25) | (1 << 16) | mint_slot_id_reg
            )
            # W2: f_flag=0 | g_bit=0 | gt_seq=1(<<21) | limit_offset = lump_size-1 ★v2.0
            mint_w2 = Signal(32)
            m.d.comb += mint_w2.eq((1 << 21) | (mint_lump_size_reg - 1)[:21])

            # integrity32(W0=mint_base_reg, W1=mint_w2) — replaces 90-stage CRC chain
            mint_integrity = Signal(32)
            integrity32_amaranth(m, mint_base_reg, mint_w2, mint_integrity)

            mint_done_comb  = Signal()
            mint_fault_comb = Signal()

            with m.FSM(name="mint") as mint_fsm:

                with m.State("MINT_IDLE"):
                    with m.If(u_outform.mint_call):
                        m.d.sync += mint_base_reg.eq(u_outform.mint_base)
                        m.next = "MINT_READ_HDR"

                with m.State("MINT_READ_HDR"):
                    m.d.comb += [
                        mint_dmem_rd_en.eq(1),
                        mint_dmem_addr.eq(mint_base_reg),
                    ]
                    m.next = "MINT_READ_HDR_WAIT"

                with m.State("MINT_READ_HDR_WAIT"):
                    m.d.sync += mint_hdr_reg.eq(self.dmem_rd_data)
                    m.next = "MINT_CHECK_HDR"

                with m.State("MINT_CHECK_HDR"):
                    hdr_v = View(LUMP_HEADER_LAYOUT, mint_hdr_reg)
                    lsz_c = Signal(15)
                    m.d.comb += lsz_c.eq(1 << (hdr_v.n_minus_6 + 6))
                    with m.If(hdr_v.magic != 0x1F):
                        m.next = "MINT_FAULT"
                    with m.Elif(hdr_v.n_minus_6 > 8):
                        m.next = "MINT_FAULT"
                    # Explicit cc bounds: cc must leave room for header + at least one code word
                    with m.Elif(hdr_v.cc > (lsz_c - 2)):
                        m.next = "MINT_FAULT"
                    # cw must fit in the remaining space (after header and cc tail)
                    with m.Elif(hdr_v.cw > (lsz_c - hdr_v.cc - 2)):
                        m.next = "MINT_FAULT"
                    with m.Else():
                        m.d.sync += [
                            mint_lump_size_reg.eq(lsz_c),
                            mint_cw_reg.eq(hdr_v.cw),
                            mint_cc_reg.eq(hdr_v.cc),
                            mint_scan_idx_reg.eq(hdr_v.cw + 1),
                        ]
                        m.next = "MINT_SCAN_FS"

                with m.State("MINT_SCAN_FS"):
                    scan_end_c = Signal(15)
                    m.d.comb += scan_end_c.eq(mint_lump_size_reg - mint_cc_reg - 1)
                    with m.If(mint_scan_idx_reg > scan_end_c):
                        m.d.sync += mint_copy_idx_reg.eq(0)
                        m.next = "MINT_WRITE_NS0"
                    with m.Else():
                        m.d.comb += [
                            mint_dmem_rd_en.eq(1),
                            mint_dmem_addr.eq(
                                mint_base_reg + (mint_scan_idx_reg << 2)
                            ),
                        ]
                        with m.If(self.dmem_rd_data != 0):
                            m.next = "MINT_FAULT"
                        with m.Else():
                            m.d.sync += mint_scan_idx_reg.eq(mint_scan_idx_reg + 1)

                with m.State("MINT_WRITE_NS0"):
                    m.d.comb += [
                        mint_ns_wr_en.eq(1),
                        mint_ns_addr.eq(mint_ns_entry_base),
                        mint_ns_wr_data.eq(mint_base_reg),
                    ]
                    m.next = "MINT_WRITE_NS1"

                with m.State("MINT_WRITE_NS1"):
                    m.d.comb += [
                        mint_ns_wr_en.eq(1),
                        mint_ns_addr.eq(mint_ns_entry_base + 4),
                        mint_ns_wr_data.eq(mint_w2),
                    ]
                    m.next = "MINT_WRITE_NS2"

                with m.State("MINT_WRITE_NS2"):
                    m.d.comb += [
                        mint_ns_wr_en.eq(1),
                        mint_ns_addr.eq(mint_ns_entry_base + 8),
                        mint_ns_wr_data.eq(mint_integrity),
                    ]
                    m.next = "MINT_WRITE_NS3"

                with m.State("MINT_WRITE_NS3"):
                    m.d.comb += [
                        mint_ns_wr_en.eq(1),
                        mint_ns_addr.eq(mint_ns_entry_base + 12),
                        mint_ns_wr_data.eq(0),
                    ]
                    # Precompute (lump_size − cc) into a register so the
                    # copy-loop offset expression stays binary (2-operand) and
                    # alumacc cannot merge it into a multi-term $macc.
                    m.d.sync += mint_cc_base_reg.eq(mint_lump_size_reg - mint_cc_reg)
                    m.next = "MINT_COPY_CLIST_RD"

                # ── Copy cc words from lump tail into clist BRAM ──────────────
                # Read from DMEM at alloc_base + (lump_size - cc + i) * 4,
                # write to clist bus at (NS_CLIST_WORD_BASE + slot_id*64 + i) * 4.
                with m.State("MINT_COPY_CLIST_RD"):
                    with m.If(mint_copy_idx_reg >= mint_cc_reg):
                        m.next = "MINT_WRITE_CLIST"
                    with m.Else():
                        # cc_off = (lump_size - cc) + i.  Use registered base so
                        # alumacc sees only a binary add (not a 3-term chain).
                        cc_off = Signal(15)
                        m.d.comb += cc_off.eq(mint_cc_base_reg + mint_copy_idx_reg)
                        m.d.comb += [
                            mint_dmem_rd_en.eq(1),
                            mint_dmem_addr.eq(
                                mint_base_reg + (cc_off << 2)
                            ),
                        ]
                        m.next = "MINT_COPY_CLIST_RD_WAIT"

                with m.State("MINT_COPY_CLIST_RD_WAIT"):
                    m.d.sync += mint_copy_data_reg.eq(self.dmem_rd_data)
                    m.next = "MINT_COPY_CLIST_WR"

                with m.State("MINT_COPY_CLIST_WR"):
                    m.d.comb += [
                        mint_clist_wr_en.eq(1),
                        mint_clist_addr_d.eq(
                            mint_clist_slot_base
                            + (mint_copy_idx_reg << 2)
                        ),
                        mint_clist_wr_data_d.eq(mint_copy_data_reg),
                    ]
                    m.d.sync += mint_copy_idx_reg.eq(mint_copy_idx_reg + 1)
                    m.next = "MINT_COPY_CLIST_RD"

                # ── Write E-GT to caller's clist slot ─────────────────────────
                with m.State("MINT_WRITE_CLIST"):
                    m.d.comb += [
                        mint_clist_wr_en.eq(1),
                        mint_clist_addr_d.eq(mint_clist_addr_reg),
                        mint_clist_wr_data_d.eq(mint_e_gt_d),
                    ]
                    m.next = "MINT_DONE"

                with m.State("MINT_DONE"):
                    m.d.comb += [
                        mint_done_comb.eq(1),
                        u_outform.mint_result_gt.eq(mint_e_gt_d),
                    ]
                    m.next = "MINT_IDLE"

                with m.State("MINT_FAULT"):
                    m.d.comb += mint_fault_comb.eq(1)
                    m.next = "MINT_IDLE"

            m.d.comb += [
                mint_busy.eq(~mint_fsm.ongoing("MINT_IDLE")),
                u_outform.mint_done.eq(mint_done_comb),
                u_outform.mint_fault.eq(mint_fault_comb),
            ]

        else:
            # ── Non-IoT: same watermark allocator and Mint FSM as IoT profile ──
            # The non-IoT ChurchOutform (outform.py) uses the same alloc/Mint
            # interface as ChurchOutformIoT; the download mechanism differs but
            # the allocator and Mint FSM are identical.
            WATERMARK_INIT = 256
            DMEM_WORDS     = 2048
            watermark_reg   = Signal(32, init=WATERMARK_INIT, name="watermark_reg_noniot")
            alloc_sz_w      = Signal(32, name="alloc_sz_w_noniot")
            alloc_mask_w    = Signal(32, name="alloc_mask_w_noniot")
            alloc_aligned_w = Signal(32, name="alloc_aligned_w_noniot")
            alloc_new_wm_w  = Signal(33, name="alloc_new_wm_w_noniot")

            m.d.comb += alloc_sz_w.eq(C(1, 32) << u_outform.alloc_n)
            m.d.comb += alloc_mask_w.eq(alloc_sz_w - 1)
            m.d.comb += alloc_aligned_w.eq(
                (watermark_reg + alloc_mask_w) & ~alloc_mask_w
            )
            m.d.comb += alloc_new_wm_w.eq(
                Cat(alloc_aligned_w, C(0, 1)) + Cat(alloc_sz_w, C(0, 1))
            )
            alloc_fits_ni  = Signal(name="alloc_fits_ni")
            alloc_n_ok_ni  = Signal(name="alloc_n_ok_ni")
            m.d.comb += alloc_fits_ni.eq(alloc_new_wm_w <= DMEM_WORDS)
            m.d.comb += alloc_n_ok_ni.eq(
                (u_outform.alloc_n >= 6) & (u_outform.alloc_n <= 14)
            )

            m.d.comb += [
                u_outform.alloc_done.eq(
                    u_outform.alloc_req & alloc_fits_ni & alloc_n_ok_ni
                ),
                u_outform.alloc_fault.eq(
                    u_outform.alloc_req & (~alloc_fits_ni | ~alloc_n_ok_ni)
                ),
                u_outform.alloc_base.eq(alloc_aligned_w << 2),
            ]
            with m.If(u_outform.alloc_req & alloc_fits_ni & alloc_n_ok_ni):
                m.d.sync += watermark_reg.eq(alloc_new_wm_w[:32])

            # ── Mint FSM (non-IoT) ────────────────────────────────────────────
            mint_base_reg_ni      = Signal(32, name="mint_base_reg_ni")
            mint_cw_reg_ni        = Signal(13, name="mint_cw_reg_ni")
            mint_cc_reg_ni        = Signal(8,  name="mint_cc_reg_ni")
            mint_scan_idx_reg_ni  = Signal(14, name="mint_scan_idx_reg_ni")
            mint_copy_idx_reg_ni  = Signal(8,  name="mint_copy_idx_reg_ni")
            mint_copy_data_reg_ni = Signal(32, name="mint_copy_data_reg_ni")
            mint_hdr_reg_ni       = Signal(32, name="mint_hdr_reg_ni")
            # Registered (lump_size − cc_count) for the non-IoT copy loop —
            # same reason as mint_cc_base_reg above.
            mint_cc_base_reg_ni   = Signal(15, name="mint_cc_base_reg_ni")

            cr15_mint_view_ni     = View(CAP_REG_LAYOUT, u_regs.cr15_namespace)
            mint_ns_entry_base_ni = Signal(32, name="mint_ns_entry_base_ni")
            m.d.comb += mint_ns_entry_base_ni.eq(
                cr15_mint_view_ni.word1_location + (mint_slot_id_reg << 4)
            )

            # Same (3 + slot_id) << 8 trick as the IOT version above.
            mint_clist_slot_base_ni = Signal(32, name="mint_clist_slot_base_ni")
            mint_slot_id_p3_ni      = Signal(17, name="mint_slot_id_p3_ni")
            m.d.comb += mint_slot_id_p3_ni.eq(mint_slot_id_reg + 3)
            m.d.comb += mint_clist_slot_base_ni.eq(Cat(Const(0, 8), mint_slot_id_p3_ni))

            m.d.comb += mint_e_gt_d.eq(
                (1 << 30) | (GT_TYPE_INFORM << 25) | (1 << 16) | mint_slot_id_reg  # ★v2.0
            )
            mint_w2_ni = Signal(32, name="mint_w2_ni")
            m.d.comb += mint_w2_ni.eq((1 << 21) | (mint_lump_size_reg - 1)[:21])

            mint_integrity_ni = Signal(32, name="mint_integrity_ni")
            integrity32_amaranth(m, mint_base_reg_ni, mint_w2_ni, mint_integrity_ni)

            mint_done_comb_ni  = Signal(name="mint_done_comb_ni")
            mint_fault_comb_ni = Signal(name="mint_fault_comb_ni")

            with m.FSM(name="mint_noniot") as mint_fsm_ni:

                with m.State("MINT_IDLE"):
                    with m.If(u_outform.mint_call):
                        m.d.sync += mint_base_reg_ni.eq(u_outform.mint_base)
                        m.next = "MINT_READ_HDR"

                with m.State("MINT_READ_HDR"):
                    m.d.comb += [
                        mint_dmem_rd_en.eq(1),
                        mint_dmem_addr.eq(mint_base_reg_ni),
                    ]
                    m.next = "MINT_READ_HDR_WAIT"

                with m.State("MINT_READ_HDR_WAIT"):
                    m.d.sync += mint_hdr_reg_ni.eq(self.dmem_rd_data)
                    m.next = "MINT_CHECK_HDR"

                with m.State("MINT_CHECK_HDR"):
                    hdr_v_ni = View(LUMP_HEADER_LAYOUT, mint_hdr_reg_ni)
                    lsz_c_ni = Signal(15, name="lsz_c_ni")
                    m.d.comb += lsz_c_ni.eq(1 << (hdr_v_ni.n_minus_6 + 6))
                    with m.If(hdr_v_ni.magic != 0x1F):
                        m.next = "MINT_FAULT"
                    with m.Elif(hdr_v_ni.n_minus_6 > 8):
                        m.next = "MINT_FAULT"
                    with m.Elif(hdr_v_ni.cc > (lsz_c_ni - 2)):
                        m.next = "MINT_FAULT"
                    with m.Elif(hdr_v_ni.cw > (lsz_c_ni - hdr_v_ni.cc - 2)):
                        m.next = "MINT_FAULT"
                    with m.Else():
                        m.d.sync += [
                            mint_lump_size_reg.eq(lsz_c_ni),
                            mint_cw_reg_ni.eq(hdr_v_ni.cw),
                            mint_cc_reg_ni.eq(hdr_v_ni.cc),
                            mint_scan_idx_reg_ni.eq(hdr_v_ni.cw + 1),
                        ]
                        m.next = "MINT_SCAN_FS"

                with m.State("MINT_SCAN_FS"):
                    scan_end_c_ni = Signal(15, name="scan_end_c_ni")
                    m.d.comb += scan_end_c_ni.eq(mint_lump_size_reg - mint_cc_reg_ni - 1)
                    with m.If(mint_scan_idx_reg_ni > scan_end_c_ni):
                        m.d.sync += mint_copy_idx_reg_ni.eq(0)
                        m.next = "MINT_WRITE_NS0"
                    with m.Else():
                        m.d.comb += [
                            mint_dmem_rd_en.eq(1),
                            mint_dmem_addr.eq(
                                mint_base_reg_ni + (mint_scan_idx_reg_ni << 2)
                            ),
                        ]
                        with m.If(self.dmem_rd_data != 0):
                            m.next = "MINT_FAULT"
                        with m.Else():
                            m.d.sync += mint_scan_idx_reg_ni.eq(mint_scan_idx_reg_ni + 1)

                with m.State("MINT_WRITE_NS0"):
                    m.d.comb += [
                        mint_ns_wr_en.eq(1),
                        mint_ns_addr.eq(mint_ns_entry_base_ni),
                        mint_ns_wr_data.eq(mint_base_reg_ni),
                    ]
                    m.next = "MINT_WRITE_NS1"

                with m.State("MINT_WRITE_NS1"):
                    m.d.comb += [
                        mint_ns_wr_en.eq(1),
                        mint_ns_addr.eq(mint_ns_entry_base_ni + 4),
                        mint_ns_wr_data.eq(mint_w2_ni),
                    ]
                    m.next = "MINT_WRITE_NS2"

                with m.State("MINT_WRITE_NS2"):
                    m.d.comb += [
                        mint_ns_wr_en.eq(1),
                        mint_ns_addr.eq(mint_ns_entry_base_ni + 8),
                        mint_ns_wr_data.eq(mint_integrity_ni),
                    ]
                    m.next = "MINT_WRITE_NS3"

                with m.State("MINT_WRITE_NS3"):
                    m.d.comb += [
                        mint_ns_wr_en.eq(1),
                        mint_ns_addr.eq(mint_ns_entry_base_ni + 12),
                        mint_ns_wr_data.eq(0),
                    ]
                    # Precompute (lump_size − cc) — same alumacc-avoidance
                    # pattern as the IOT MINT FSM above.
                    m.d.sync += mint_cc_base_reg_ni.eq(mint_lump_size_reg - mint_cc_reg_ni)
                    m.next = "MINT_COPY_CLIST_RD"

                with m.State("MINT_COPY_CLIST_RD"):
                    with m.If(mint_copy_idx_reg_ni >= mint_cc_reg_ni):
                        m.next = "MINT_WRITE_CLIST"
                    with m.Else():
                        cc_off_ni = Signal(15, name="cc_off_ni")
                        m.d.comb += cc_off_ni.eq(mint_cc_base_reg_ni + mint_copy_idx_reg_ni)
                        m.d.comb += [
                            mint_dmem_rd_en.eq(1),
                            mint_dmem_addr.eq(
                                mint_base_reg_ni + (cc_off_ni << 2)
                            ),
                        ]
                        m.next = "MINT_COPY_CLIST_RD_WAIT"

                with m.State("MINT_COPY_CLIST_RD_WAIT"):
                    m.d.sync += mint_copy_data_reg_ni.eq(self.dmem_rd_data)
                    m.next = "MINT_COPY_CLIST_WR"

                with m.State("MINT_COPY_CLIST_WR"):
                    m.d.comb += [
                        mint_clist_wr_en.eq(1),
                        mint_clist_addr_d.eq(
                            mint_clist_slot_base_ni
                            + (mint_copy_idx_reg_ni << 2)
                        ),
                        mint_clist_wr_data_d.eq(mint_copy_data_reg_ni),
                    ]
                    m.d.sync += mint_copy_idx_reg_ni.eq(mint_copy_idx_reg_ni + 1)
                    m.next = "MINT_COPY_CLIST_RD"

                with m.State("MINT_WRITE_CLIST"):
                    m.d.comb += [
                        mint_clist_wr_en.eq(1),
                        mint_clist_addr_d.eq(mint_clist_addr_reg),
                        mint_clist_wr_data_d.eq(mint_e_gt_d),
                    ]
                    m.next = "MINT_DONE"

                with m.State("MINT_DONE"):
                    m.d.comb += [
                        mint_done_comb_ni.eq(1),
                        u_outform.mint_result_gt.eq(mint_e_gt_d),
                    ]
                    m.next = "MINT_IDLE"

                with m.State("MINT_FAULT"):
                    m.d.comb += mint_fault_comb_ni.eq(1)
                    m.next = "MINT_IDLE"

            m.d.comb += [
                mint_busy.eq(~mint_fsm_ni.ongoing("MINT_IDLE")),
                u_outform.mint_done.eq(mint_done_comb_ni),
                u_outform.mint_fault.eq(mint_fault_comb_ni),
            ]

        # -----------------------------------------------------------------------
        # M-window FSM — CR15 M-flag latch + DR11-DR13 shadow (Task #432)
        #
        # Triggered by: (call_complete | return_complete | cr15_m_writeback_trigger)
        # AND cr15_m_flag == 1  (never fires when M is not active).
        # cr15_m_set (test/microcode injection): single-cycle M-set, no FSM state change.
        #
        # IDLE  → latch DR11-DR13, validate DR11 gt_type bits[26:25] ★v2.0:
        #           gt_type != NULL (0b00) → WRITEBACK
        #           gt_type == NULL        → FAULT
        # WRITEBACK (1 cycle): pack latched DR11-DR13 → CR15 + clear M → IDLE
        # FAULT     (1 cycle): INVALID_OP fault + clear M → IDLE
        # mwin_busy is HIGH in WRITEBACK and FAULT states only.
        # -----------------------------------------------------------------------

        # Combine all writeback triggers; gate the whole expression on M-flag active.
        # Only normal CALL completion (not Abstract-GT M_FETCH_DONE) triggers M-writeback.
        # Abstract-GT CALL sets M via mgt_set_trigger; its writeback fires at the next
        # normal CALL or RETURN that clears the M-window boundary.
        mwin_trigger = Signal()
        m.d.comb += mwin_trigger.eq(
            (u_call.call_normal_complete | u_return.complete | self.cr15_m_writeback_trigger) &
            u_regs.cr15_m_flag
        )

        # Latched snapshot of DR11-DR15 captured in IDLE → {WRITEBACK|FAULT} transition
        mwin_dr11_lat = Signal(32)
        mwin_dr12_lat = Signal(32)
        mwin_dr13_lat = Signal(32)
        mwin_dr14_lat = Signal(32)
        mwin_dr15_lat = Signal(32)

        # Combinatorial: decode DR11 gt_type (bits[26:25]) for NULL check ★v2.0.
        # In hardware, GT_TYPE_NULL = 0b00 at bits[26:25].
        mwin_dr11_valid = Signal()
        m.d.comb += mwin_dr11_valid.eq(u_regs.m_dr11[25:27] != GT_TYPE_NULL)

        # Integrity check on the latched shadow — must match integrity32(DR12, DR13).
        mwin_integrity_computed = Signal(32)
        integrity32_amaranth(m, mwin_dr12_lat, mwin_dr13_lat, mwin_integrity_computed)
        mwin_integrity_ok = Signal()
        m.d.comb += mwin_integrity_ok.eq(mwin_integrity_computed == mwin_dr14_lat)

        # gt_seq revocation check — GT.gt_seq (DR11[24:16]) must match NS_auth.gt_seq (DR13[29:21]) ★v2.0.
        # Detects stale GTs revoked by GC since the M-window was set.
        mwin_dr11_gt_seq = Signal(9)
        mwin_dr13_gt_seq = Signal(9)
        mwin_gtseq_ok    = Signal()
        m.d.comb += [
            mwin_dr11_gt_seq.eq(View(GT_LAYOUT, mwin_dr11_lat).gt_seq),
            mwin_dr13_gt_seq.eq(View(WORD2_LAYOUT, mwin_dr13_lat).gt_seq),
            mwin_gtseq_ok.eq(mwin_dr11_gt_seq == mwin_dr13_gt_seq),
        ]

        # Seal check — DR15[24:0] must equal fnv32(DR12, DR13) & 0x1FFFFFF.
        # Recomputes the one-round FNV-1a hash of the NS entry location (DR12)
        # and limit/authority (DR13) and compares the lower 25 bits against the
        # stored seal field.  A mismatch means the seals word was replaced with a
        # stale or replayed value since the M-window was set.
        mwin_seal_computed = Signal(32)
        mwin_seal_masked   = Signal(25)
        mwin_seal_ok       = Signal()
        # Break the FNV-1a step into three explicit binary operations so that
        # Yosys does not fuse the XOR–multiply–XOR chain into a single multi-term
        # $macc cell that write_verilog cannot emit as plain Verilog.
        mwin_fnv_xor       = Signal(32)   # FNV_OFFSET_32 ^ dr12
        mwin_fnv_mul       = Signal(32)   # xor  * FNV_PRIME_32  (truncated to 32 b)
        m.d.comb += mwin_fnv_xor.eq(FNV_OFFSET_32 ^ mwin_dr12_lat)
        m.d.comb += mwin_fnv_mul.eq(mwin_fnv_xor * FNV_PRIME_32)
        m.d.comb += [
            mwin_seal_computed.eq(mwin_fnv_mul ^ mwin_dr13_lat),
            mwin_seal_masked.eq(mwin_seal_computed[:25]),
            mwin_seal_ok.eq(mwin_seal_masked == View(SEALS_LAYOUT, mwin_dr15_lat).seal),
        ]

        with m.FSM(name="mwin"):
            with m.State("IDLE"):
                m.d.comb += [
                    mwin_busy.eq(0),
                    mwin_cr_wr_en.eq(0),
                    mwin_cr_wr_data.eq(0),
                    # M-set fires on CALL M-GT dispatch (mgt_set_trigger) or test port
                    mwin_m_set_en.eq(self.cr15_m_set | u_call.mgt_set_trigger),
                    mwin_m_clear_en.eq(0),
                    mwin_fault_valid.eq(0),
                ]
                with m.If(mwin_trigger):
                    m.d.sync += [
                        mwin_dr11_lat.eq(u_regs.m_dr11),
                        mwin_dr12_lat.eq(u_regs.m_dr12),
                        mwin_dr13_lat.eq(u_regs.m_dr13),
                        mwin_dr14_lat.eq(u_regs.m_dr14),
                        mwin_dr15_lat.eq(u_regs.m_dr15),
                    ]
                    with m.If(mwin_dr11_valid):
                        m.next = "WRITEBACK"
                    with m.Else():
                        m.next = "FAULT"

            with m.State("WRITEBACK"):
                m.d.comb += mwin_busy.eq(1)
                # Full validation: all three checks must pass; any failure → INVALID_OP + M-clear.
                #   integrity32(DR12,DR13)==DR14        (integrity_ok)
                #   GT.gt_seq==NS_auth.gt_seq           (gtseq_ok — revocation via gt_seq fields)
                #   fnv32(DR12,DR13)&0x1FFFFFF==DR15[24:0]  (seal_ok — replay gap closed)
                with m.If(mwin_integrity_ok & mwin_gtseq_ok & mwin_seal_ok):
                    mwin_wr_view = View(CAP_REG_LAYOUT, mwin_cr_wr_data)
                    m.d.comb += [
                        mwin_wr_view.word0_gt.eq(mwin_dr11_lat),
                        mwin_wr_view.word1_location.eq(mwin_dr12_lat),
                        mwin_wr_view.word2_w2.eq(mwin_dr13_lat),
                        # DR15 (NS word3/seals) is software-visible while M=1 but is not
                        # written back to CR15 since the 3-word CAP_REG layout has no word3.
                        mwin_cr_wr_en.eq(1),
                        mwin_m_set_en.eq(0),
                        mwin_m_clear_en.eq(1),
                        mwin_fault_valid.eq(0),
                    ]
                with m.Else():
                    m.d.comb += [
                        mwin_cr_wr_en.eq(0),
                        mwin_m_set_en.eq(0),
                        mwin_m_clear_en.eq(1),
                        mwin_fault_valid.eq(1),
                    ]
                m.next = "IDLE"

            with m.State("FAULT"):
                m.d.comb += [
                    mwin_busy.eq(1),
                    mwin_cr_wr_en.eq(0),
                    mwin_cr_wr_data.eq(0),
                    mwin_m_set_en.eq(0),
                    mwin_m_clear_en.eq(1),
                    mwin_fault_valid.eq(1),
                ]
                m.next = "IDLE"

        # fetch_bounds_fault: active when nia_reg escapes the active code fence.
        # Also drives cond_exec_enable low (via the declaration above) so that no
        # instruction can start in the same cycle — decode side effects are suppressed
        # before the fault is taken.  Fence is inactive when code_lo == code_hi == 0.
        m.d.comb += fetch_bounds_fault.eq(
            self.boot_complete & ~any_unit_busy &
            (code_lo_reg != code_hi_reg) &
            ((nia_reg < code_lo_reg) | (nia_reg >= code_hi_reg))
        )
        with m.If(fetch_bounds_fault):
            m.d.comb += [self.fault.eq(FaultType.BOUNDS), self.fault_valid.eq(1)]
        with m.Elif(u_decoder.fault_valid):
            m.d.comb += [self.fault.eq(u_decoder.fault), self.fault_valid.eq(1)]
        with m.Elif(u_perm.fault_valid):
            m.d.comb += [self.fault.eq(u_perm.fault_type), self.fault_valid.eq(1)]
        if not self.iot_profile:
            with m.Elif(u_lambda.lambda_fault):
                m.d.comb += [self.fault.eq(u_lambda.fault_type), self.fault_valid.eq(1)]
            with m.Elif(nested_lambda_fault):
                m.d.comb += [self.fault.eq(FaultType.INVALID_OP), self.fault_valid.eq(1)]
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
        if not self.iot_profile:
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
        with m.Elif(u_cload.cload_fault):
            m.d.comb += [self.fault.eq(u_cload.cload_fault_type), self.fault_valid.eq(1)]
        with m.Elif(u_outform.outform_fault & ~outform_mode2_active):
            m.d.comb += [self.fault.eq(u_outform.outform_fault_type), self.fault_valid.eq(1)]
        with m.Elif(u_outform_fsm.fault):
            m.d.comb += [self.fault.eq(u_outform_fsm.fault_type), self.fault_valid.eq(1)]
        with m.Elif(mwin_fault_valid):
            m.d.comb += [self.fault.eq(FaultType.INVALID_OP), self.fault_valid.eq(1)]
        with m.Else():
            m.d.comb += [self.fault.eq(FaultType.NONE), self.fault_valid.eq(0)]

        # ── fault telemetry stage encoder ─────────────────────────────────────
        # 4-bit stage index that mirrors the fault priority chain above.
        # Stage IDs: 0=Fetch/BOUNDS 1=Decode 2=PermCheck 3=Lambda
        #            4=TPERM 5=Call 6=Return 7=DataRW/Other
        fault_stage_w = Signal(4)
        with m.If(fetch_bounds_fault):
            m.d.comb += fault_stage_w.eq(0)
        with m.Elif(u_decoder.fault_valid):
            m.d.comb += fault_stage_w.eq(1)
        with m.Elif(u_perm.fault_valid):
            m.d.comb += fault_stage_w.eq(2)
        if not self.iot_profile:
            with m.Elif(u_lambda.lambda_fault):
                m.d.comb += fault_stage_w.eq(3)
            with m.Elif(nested_lambda_fault):
                m.d.comb += fault_stage_w.eq(3)
        with m.Elif(u_tperm.tperm_fault):
            m.d.comb += fault_stage_w.eq(4)
        with m.Elif(u_call.call_fault):
            m.d.comb += fault_stage_w.eq(5)
        with m.Elif(u_return.fault_valid):
            m.d.comb += fault_stage_w.eq(6)
        with m.Else():
            m.d.comb += fault_stage_w.eq(7)

        # ── fault telemetry latch registers ────────────────────────────────────
        # Latched when fault_valid fires; cleared on FAULT_RST (clear_all).
        # fault_gt / fault_cr14 reserved (zero) — sub-unit wiring in future pass.
        fault_instr_latch = Signal(32)
        fault_stage_latch = Signal(4)
        with m.If(self.fault_valid):
            m.d.sync += [
                fault_instr_latch.eq(self.imem_data),
                fault_stage_latch.eq(fault_stage_w),
            ]
        with m.Elif(clear_all):
            m.d.sync += [fault_instr_latch.eq(0), fault_stage_latch.eq(0)]
        m.d.comb += [
            self.fault_gt.eq(0),
            self.fault_instr.eq(fault_instr_latch),
            self.fault_cr14.eq(0),
            self.fault_stage.eq(fault_stage_latch),
        ]

        m.d.comb += [
            u_shared_mload.cr_rd_data.eq(u_regs.cr_rd_data),
            u_shared_mload.cr15_namespace.eq(u_regs.cr15_namespace),
            u_shared_mload.mem_rd_data.eq(self.dmem_rd_data),
            u_shared_mload.mem_rd_valid.eq(self.dmem_rd_valid),
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
            if not self.iot_profile:
                from .hw_types import IO_PORT_PET_NAME_WR
                # Intercept DWRITE writes to IO_PORT_PET_NAME_WR: the written
                # value's lower 6 bits encode the c-list slot to mark as named.
                # The write does not propagate to external data memory.
                with m.If(u_dwrite.dmem_addr == IO_PORT_PET_NAME_WR):
                    m.d.comb += [
                        u_pet_name_mem.wr_en.eq(1),
                        u_pet_name_mem.wr_addr.eq(u_dwrite.dmem_wr_data[:6]),
                        u_pet_name_mem.wr_data.eq(1),
                    ]
                with m.Else():
                    m.d.comb += [
                        self.dmem_addr.eq(u_dwrite.dmem_addr),
                        self.dmem_wr_data.eq(u_dwrite.dmem_wr_data),
                        self.dmem_wr_en.eq(1),
                    ]
            else:
                m.d.comb += [
                    self.dmem_addr.eq(u_dwrite.dmem_addr),
                    self.dmem_wr_data.eq(u_dwrite.dmem_wr_data),
                    self.dmem_wr_en.eq(1),
                ]
        with m.Elif(u_cload.mem_rd_en):
            m.d.comb += [
                self.dmem_addr.eq(u_cload.mem_addr),
                self.dmem_rd_en.eq(1),
            ]
        with m.Elif(u_outform.mem_wr_en):
            m.d.comb += [
                self.dmem_addr.eq(u_outform.mem_wr_addr),
                self.dmem_wr_data.eq(u_outform.mem_wr_data),
                self.dmem_wr_en.eq(1),
            ]
        with m.Elif(mint_dmem_rd_en):
            m.d.comb += [
                self.dmem_addr.eq(mint_dmem_addr),
                self.dmem_rd_en.eq(1),
            ]
        with m.Elif(u_return.mem_rd_en):
            m.d.comb += [
                self.dmem_addr.eq(u_return.mem_rd_addr),
                self.dmem_rd_en.eq(1),
            ]
        with m.Elif(u_return.mem_wr_en):
            m.d.comb += [
                self.dmem_addr.eq(u_return.mem_wr_addr),
                self.dmem_wr_data.eq(u_return.mem_wr_data),
                self.dmem_wr_en.eq(1),
            ]
        if not self.iot_profile:
            with m.Elif(u_irq_dispatch.mem_rd_en):
                m.d.comb += [
                    self.dmem_addr.eq(u_irq_dispatch.mem_rd_addr),
                    self.dmem_rd_en.eq(1),
                ]

        if not self.iot_profile:
            m.d.comb += [
                u_gc.valid_key_access.eq(u_shared_mload.gbit_reset_done),
                u_gc.access_index.eq(0),
            ]

            # Non-IoT NS mux: Mint writes take priority over GC (Mint fires during
            # instruction execution; GC has its own busy handshake).
            with m.If(mint_ns_wr_en):
                m.d.comb += [
                    self.ns_addr.eq(mint_ns_addr),
                    self.ns_rd_en.eq(0),
                    self.ns_wr_data.eq(Cat(mint_ns_wr_data, Const(0, 64))),
                    self.ns_wr_en.eq(1),
                ]
            with m.Elif(u_gc.gc_busy):
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
        else:
            with m.If(mint_ns_wr_en):
                m.d.comb += [
                    self.ns_addr.eq(mint_ns_addr),
                    self.ns_rd_en.eq(0),
                    self.ns_wr_data.eq(Cat(mint_ns_wr_data, Const(0, 64))),
                    self.ns_wr_en.eq(1),
                ]
            with m.Else():
                m.d.comb += [
                    self.ns_addr.eq(0),
                    self.ns_rd_en.eq(0),
                    self.ns_wr_data.eq(0),
                    self.ns_wr_en.eq(0),
                ]

        return m
