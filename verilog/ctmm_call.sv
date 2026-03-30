// ============================================================================
// CTMM CALL Church-Instruction
// ============================================================================
// Implements the CALL instruction: two-phase capability load to invoke a
// procedure via an E (Enter) capability.
//
// Syntax: CALL CRs[Index]
//   CRs = Source C-List register (CR0-CR5)
//   Index = Index into the C-List
//
// CALL Steps (Two-Phase Load + Isolation):
//   Pre:    Save CR5 GT for later restoration by RETURN
//   Phase 1: mLoad CRs[Index] → CR6   (nodal C-List)
//   Phase 2: mLoad CR6[0]    → CR14   (CLOOMC code capability)
//   Phase 3: Fetch Mem[CR14.word1_location] — callee lump header (cw, cc, n_minus_6)
//   Phase 4: NIA = CR14.word1_location + 4  (lump word 0 = header; first instruction at word 1)
//   Phase 5: Clear B-flag + null non-preserved CRs in one cycle (b_clear_mask out)
//   Phase 6: Read STO from Heap[0] = Mem[CR5.word1_location]; check sp_min ≤ STO ≤ sp_max
//            (bounds derived from THREAD_HDR hidden register via thread_hdr_in; no extra read)
//
// Permission check: source CR must have E (Enter) permission.
//
// MASK Field: bit=1 means PRESERVE
//   [10:5] = CR0-CR5 preserve mask
//   [4:0]  = DR1-DR5 preserve mask
//
// FAULT conditions:
//   - Source CRs not in range CR0-CR5
//   - Source CRs lacks E permission
//   - Either mLoad faults
// ============================================================================

module ctmm_call
    import ctmm_pkg::*;
(
    input  logic        clk,
    input  logic        rst_n,

    // Control interface
    input  logic        call_start,
    input  logic [3:0]  cr_src,
    input  logic [15:0] index,
    input  logic [10:0] mask,
    output logic        call_busy,
    output logic        call_complete,
    output logic        call_fault,
    output fault_type_t fault_type,

    // Capability register read interface
    output logic [3:0]       cr_rd_addr,
    input  capability_reg_t  cr_rd_data,

    // Capability register write interface (B-flag clearing)
    output logic [3:0]       cr_wr_addr,
    output capability_reg_t  cr_wr_data,
    output logic             cr_wr_en,

    // CR15 (Namespace) interface
    input  capability_reg_t  cr15_namespace,

    // Memory interface
    output logic [31:0] mem_addr,
    output logic        mem_rd_en,
    input  logic [31:0] mem_rd_data,
    input  logic        mem_rd_valid,

    // Thread update interface
    output logic        thread_wr_en,
    output logic [3:0]  thread_wr_idx,
    output logic [31:0] thread_wr_data,

    // THREAD_HDR hidden register — loaded by CHANGE on thread restore.
    // CALL reads stack bounds from this word directly (no memory read per CALL).
    input  logic [31:0] thread_hdr_in,

    // Saved CR5 GT output for RETURN restoration
    output golden_token_t saved_cr5_gt,

    // Isolation interface
    output logic        nia_set,
    output logic [31:0] nia_value,
    output logic [15:0] dr_clear_mask,
    output logic [15:0] cr_clear_mask,

    // Parallel B-flag clear: one bit per CR0–CR5 domain register.
    // Asserted for one cycle at CALL_CLEAR_B; register file clears b_flag on each
    // masked CR in a single clock edge (no read-modify-write loop needed).
    output logic [5:0]  b_clear_mask,

    // Parallel null mask: bit N=1 → write NULL to CR[N] (CR0–CR11).
    // Asserted at CALL_CLEAR_B for non-preserved CRs only.
    // cr_null_mask takes priority over b_clear_mask in the register file.
    output logic [11:0] cr_null_mask
);

    // ========================================================================
    // Constants
    // ========================================================================

    localparam logic [3:0] CR6_CLIST  = 4'd6;
    localparam logic [3:0] CR14_CODE  = 4'd14;
    localparam logic [3:0] MAX_SRC_REG = 4'd5;

    // ========================================================================
    // State Machine
    // ========================================================================

    typedef enum logic [3:0] {
        CALL_IDLE,
        CALL_CHECK_SRC,
        CALL_READ_SRC,
        CALL_CHECK_PERM,
        CALL_READ_CR5,
        CALL_PHASE1,
        CALL_PHASE1_DONE,
        CALL_PHASE2,
        CALL_PHASE2_DONE,
        CALL_FETCH_LUMP,
        CALL_CLEAR_B,
        CALL_STACK_READ_SP,   // Read STO from Heap[0] = Mem[CR5.word1_location]
        CALL_STACK_CHECK,     // Validate sp_min ≤ STO ≤ sp_max (using THREAD_HDR)
        CALL_COMPLETE,
        CALL_FAULT
    } call_state_t;

    call_state_t state, next_state;

    // Phase: 0=Phase1 (load CR6), 1=Phase2 (load CR14)
    logic phase;

    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n)                          phase <= 1'b0;
        else if (state == CALL_IDLE)         phase <= 1'b0;
        else if (state == CALL_PHASE1_DONE)  phase <= 1'b1;
    end

    // ========================================================================
    // CR14 Latch (captured after Phase 2 completes)
    // ========================================================================
    // cr14_latched holds the loaded code capability after Phase 2 mLoad.
    // Its word1_location = code base pointer; word0_gt.slot_id = NS slot.

    capability_reg_t cr14_latched;

    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n)
            cr14_latched <= CR_NULL;
        else if (state == CALL_PHASE2_DONE)
            cr14_latched <= sub_cr_wr_data;   // mLoad wrote CR14 — grab its value
    end

    // ========================================================================
    // FETCH_LUMP: read the callee lump header from Mem[CR14.word1_location]
    // ========================================================================
    // After Phase 2, mLoad has written CR14 = the callee code capability.
    // CR14.word1_location is the lump base address; word[0] = lump_header_t.
    // No slot_id arithmetic is needed — mLoad already resolved the NS entry.

    logic [31:0] lump_fetch_addr;
    logic [31:0] lump_reg;

    assign lump_fetch_addr = cr14_latched.word1_location;

    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n)
            lump_reg <= 32'd0;
        else if (state == CALL_FETCH_LUMP && mem_rd_valid)
            lump_reg <= mem_rd_data;
    end

    // Decode callee lump header via lump_header_t struct (defined in ctmm_pkg.sv).
    // lump_header_t is a packed struct matching LUMP_HEADER_LAYOUT in layouts.py:
    //   .cc [7:0], .typ [9:8], .cw [22:10], .n_minus_6 [26:23], .magic [31:27]
    lump_header_t lump_view;
    assign lump_view = lump_reg;

    // Latched lump fields (set when lump_reg captures mem_rd_data in FETCH_LUMP)
    logic [12:0] cw_latched;        // callee code-word count
    logic [7:0]  cc_latched;        // c-list slot count
    logic [3:0]  n_minus_6_latched; // frame-words minus 6

    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            cw_latched        <= 13'd0;
            cc_latched        <= 8'd0;
            n_minus_6_latched <= 4'd0;
        end else if (state == CALL_FETCH_LUMP && mem_rd_valid) begin
            cw_latched        <= lump_view.cw;
            cc_latched        <= lump_view.cc;
            n_minus_6_latched <= lump_view.n_minus_6;
        end
    end

    // CR5 heap base: latched at CALL_READ_CR5 so STACK_READ_SP can use it
    // without an extra CR read cycle.  CR5.word1_location = heap base address;
    // STO is stored at Heap[0] = Mem[cr5_heap_base].
    logic [31:0] cr5_heap_base;
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) cr5_heap_base <= 32'd0;
        else if (state == CALL_READ_CR5) cr5_heap_base <= cr_rd_data.word1_location;
    end

    // NIA = code_base + 4  (word 0 of the lump is the header; first instruction is word 1)
    // CR14.word1_location = lump base byte address (set by mLoad after Phase 2).
    logic [31:0] nia_computed;
    assign nia_computed = cr14_latched.word1_location + 32'd4;

    // ========================================================================
    // THREAD_HDR — Stack Bounds (decoded from hidden per-thread register)
    // ========================================================================
    // thread_hdr_in holds Mem[CR12.word1_location+0], loaded by CHANGE on
    // thread restore.  CALL reads stack bounds from it directly (no memory
    // read per CALL needed for the thread header).
    //
    // Stack bounds (word offsets into thread lump):
    //   sp_max = thr_lump_words − 12 − 1    (top guard; caps zone = 12, fixed)
    //   sp_min = thr_lump_words − 12 − cw + 2 (CALL needs 2 words of headroom)
    // STO is read from Heap[0] = Mem[CR5.word1_location] in CALL_STACK_READ_SP.

    lump_header_t thr_hdr_view;
    assign thr_hdr_view = thread_hdr_in;

    // thr_lump_words = 2^(n_minus_6 + 6)  (total words in thread lump)
    // sp_max = thr_lump_words − 12 − 1    (top of stack zone; caps zone = 12, fixed)
    // sp_min = thr_lump_words − 12 − cw + 2 (CALL needs 2 words of headroom)
    // Both are word-offset-based; STO is a word offset into the thread lump.
    logic [31:0] thr_lump_words;
    logic [31:0] thr_sp_max;
    logic [31:0] thr_sp_min;

    assign thr_lump_words = 32'd1 << ({27'd0, thr_hdr_view.n_minus_6} + 5'd6);
    assign thr_sp_max     = thr_lump_words - 32'd13;                          // -12 (caps) -1 (guard)
    assign thr_sp_min     = thr_lump_words - 32'd12 - {19'd0, thr_hdr_view.cw} + 32'd2;

    // sp_latched: STO (stack-top offset) read from Heap[0] = Mem[cr5_heap_base]
    logic [31:0] sp_latched;
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) sp_latched <= 32'd0;
        else if (state == CALL_STACK_READ_SP && mem_rd_valid) sp_latched <= mem_rd_data;
    end

    // ========================================================================
    // Operand Latching
    // ========================================================================

    logic [10:0] mask_latched;
    logic [15:0] index_latched;

    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            mask_latched  <= 11'd0;
            index_latched <= 16'd0;
        end else if (state == CALL_IDLE && call_start) begin
            mask_latched  <= mask;
            index_latched <= index;
        end
    end

    // ========================================================================
    // Permission Check
    // ========================================================================

    capability_reg_t src_reg_latched;

    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n)
            src_reg_latched <= CR_NULL;
        else if (state == CALL_READ_SRC)
            src_reg_latched <= cr_rd_data;
    end

    logic src_in_range;
    logic src_has_e_perm;
    assign src_in_range  = (cr_src <= MAX_SRC_REG);
    assign src_has_e_perm = src_reg_latched.word0_gt.perms[PERM_E];

    // ========================================================================
    // CR5 GT Latching
    // ========================================================================

    golden_token_t saved_cr5_gt_reg;

    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n)
            saved_cr5_gt_reg <= GT_NULL;
        else if (state == CALL_READ_CR5)
            saved_cr5_gt_reg <= cr_rd_data.word0_gt;
    end

    assign saved_cr5_gt = saved_cr5_gt_reg;

    // ========================================================================
    // Fault Latching
    // ========================================================================

    logic        fault_latched;
    fault_type_t fault_type_latched;

    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            fault_latched      <= 1'b0;
            fault_type_latched <= FAULT_NONE;
        end else if (state == CALL_IDLE) begin
            fault_latched      <= 1'b0;
            fault_type_latched <= FAULT_NONE;
        end else if (state == CALL_CHECK_SRC && !src_in_range) begin
            fault_latched      <= 1'b1;
            fault_type_latched <= FAULT_PERM_E;
        end else if (state == CALL_CHECK_PERM && !src_has_e_perm) begin
            fault_latched      <= 1'b1;
            fault_type_latched <= FAULT_PERM_E;
        end else if ((state == CALL_PHASE1 || state == CALL_PHASE2) && sub_fault_latched) begin
            fault_latched      <= 1'b1;
            fault_type_latched <= sub_fault_type;
        end else if (state == CALL_STACK_CHECK) begin
            if (sp_latched > thr_sp_max) begin
                fault_latched      <= 1'b1;
                fault_type_latched <= FAULT_STACK_CORRUPT;
            end else if (sp_latched < thr_sp_min) begin
                fault_latched      <= 1'b1;
                fault_type_latched <= FAULT_STACK_OVERFLOW;
            end
        end
    end

    // ========================================================================
    // mLoad Subroutine
    // ========================================================================

    logic        sub_start_reg;
    logic        sub_busy;
    logic        sub_done;
    logic        sub_fault;
    logic        sub_done_latched;
    logic        sub_fault_latched;
    fault_type_t sub_fault_type;

    logic [3:0]  mload_src;
    logic [3:0]  mload_dst;
    logic [15:0] mload_index;

    assign mload_src   = phase ? CR6_CLIST : cr_src;
    assign mload_dst   = phase ? CR14_CODE : CR6_CLIST;
    assign mload_index = phase ? 16'd0     : index_latched;

    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n)
            sub_start_reg <= 1'b0;
        else if ((state == CALL_READ_CR5    && next_state == CALL_PHASE1) ||
                 (state == CALL_PHASE1_DONE && next_state == CALL_PHASE2))
            sub_start_reg <= 1'b1;
        else
            sub_start_reg <= 1'b0;
    end

    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            sub_done_latched  <= 1'b0;
            sub_fault_latched <= 1'b0;
        end else if (state == CALL_IDLE || sub_start_reg ||
                     state == CALL_PHASE2_DONE) begin
            sub_done_latched  <= 1'b0;
            sub_fault_latched <= 1'b0;
        end else begin
            if (sub_done)  sub_done_latched  <= 1'b1;
            if (sub_fault) sub_fault_latched <= 1'b1;
        end
    end

    // mLoad register write (routed through here to caller)
    logic [3:0]       sub_cr_wr_addr;
    capability_reg_t  sub_cr_wr_data;
    logic             sub_cr_wr_en;
    logic [3:0]       sub_cr_rd_addr;

    ctmm_mload u_mload (
        .clk            (clk),
        .rst_n          (rst_n),
        .sub_start      (sub_start_reg),
        .sub_cr_src     (mload_src),
        .sub_cr_dst     (mload_dst),
        .sub_index      (mload_index),
        .sub_direct     (1'b0),
        .sub_direct_gt  (32'd0),
        .sub_m_elevated (1'b1),
        .sub_busy       (sub_busy),
        .sub_done       (sub_done),
        .sub_fault      (sub_fault),
        .sub_fault_type (sub_fault_type),
        .cr_rd_addr     (sub_cr_rd_addr),
        .cr_rd_data     (cr_rd_data),
        .cr_wr_addr     (sub_cr_wr_addr),
        .cr_wr_data     (sub_cr_wr_data),
        .cr_wr_en       (sub_cr_wr_en),
        .cr15_namespace (cr15_namespace),
        .mem_addr       (sub_mem_addr),
        .mem_rd_en      (sub_mem_rd_en),
        .mem_rd_data    (mem_rd_data),
        .mem_rd_valid   (local_mem_active ? 1'b0 : mem_rd_valid),
        .thread_wr_en   (thread_wr_en),
        .thread_wr_idx  (thread_wr_idx),
        .thread_wr_data (thread_wr_data)
    );

    // ========================================================================
    // B-Flag + Null Clear (Parallel, single-cycle)
    // ========================================================================
    // cr_preserve[n]=1 means bit n of CR0-CR5 is preserved; clear only its b_flag.
    // Non-preserved CRs are nulled via cr_clear_mask; no sequential loop needed.

    logic [5:0] cr_preserve;
    assign cr_preserve = mask_latched[10:5];

    // ========================================================================
    // Memory Muxing (local FETCH_LUMP vs mLoad sub-module)
    // ========================================================================

    logic [31:0] sub_mem_addr;
    logic        sub_mem_rd_en;
    logic        lump_fetch_active;

    assign lump_fetch_active = (state == CALL_FETCH_LUMP) ||
                               (state == CALL_PHASE2_DONE);

    // Memory mux priority: lump fetch > stack SP read > mLoad sub-module.
    // Also gate mLoad's mem_rd_valid during local reads so it cannot advance
    // its own FSM while a local read is in progress.
    wire local_mem_active = lump_fetch_active || (state == CALL_STACK_READ_SP);

    assign mem_addr   = lump_fetch_active         ? lump_fetch_addr :
                        (state == CALL_STACK_READ_SP) ? cr5_heap_base  : sub_mem_addr;
    assign mem_rd_en  = lump_fetch_active         ? (state == CALL_FETCH_LUMP) :
                        (state == CALL_STACK_READ_SP) ? 1'b1           : sub_mem_rd_en;

    // ========================================================================
    // Register Read/Write Muxing
    // ========================================================================

    logic local_rd_en;
    logic [3:0] local_rd_addr;

    assign local_rd_en   = (state == CALL_CHECK_SRC) || (state == CALL_READ_SRC) ||
                           (state == CALL_READ_CR5);
    assign local_rd_addr = (state == CALL_READ_CR5) ? 4'd5 : cr_src;

    assign cr_rd_addr = local_rd_en ? local_rd_addr : sub_cr_rd_addr;

    // mLoad subroutine writes are the only CR writes during CALL
    assign cr_wr_en   = sub_cr_wr_en;
    assign cr_wr_addr = sub_cr_wr_addr;
    assign cr_wr_data = sub_cr_wr_data;

    // ========================================================================
    // State Register
    // ========================================================================

    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) state <= CALL_IDLE;
        else        state <= next_state;
    end

    // ========================================================================
    // Next State Logic
    // ========================================================================

    always_comb begin
        next_state = state;
        case (state)
            CALL_IDLE:
                if (call_start) next_state = CALL_CHECK_SRC;

            CALL_CHECK_SRC:
                next_state = src_in_range ? CALL_READ_SRC : CALL_FAULT;

            CALL_READ_SRC:
                next_state = CALL_CHECK_PERM;

            CALL_CHECK_PERM:
                next_state = src_has_e_perm ? CALL_READ_CR5 : CALL_FAULT;

            CALL_READ_CR5:
                next_state = CALL_PHASE1;

            CALL_PHASE1:
                if (sub_fault_latched)     next_state = CALL_FAULT;
                else if (sub_done_latched) next_state = CALL_PHASE1_DONE;

            CALL_PHASE1_DONE:
                next_state = CALL_PHASE2;

            CALL_PHASE2:
                if (sub_fault_latched)     next_state = CALL_FAULT;
                else if (sub_done_latched) next_state = CALL_PHASE2_DONE;

            CALL_PHASE2_DONE:
                next_state = CALL_FETCH_LUMP;

            CALL_FETCH_LUMP:
                if (mem_rd_valid) next_state = CALL_CLEAR_B;

            CALL_CLEAR_B:
                // Single cycle: b_clear_mask and cr_clear_mask are asserted
                // by combinational outputs; no loop or read-modify-write needed.
                next_state = CALL_STACK_READ_SP;

            CALL_STACK_READ_SP:
                // Waiting for Heap[0] (STO) to be returned from memory.
                if (mem_rd_valid) next_state = CALL_STACK_CHECK;

            CALL_STACK_CHECK: begin
                // sp_latched just captured from memory; evaluate bounds.
                // Fault latching happens in the always_ff block above.
                if (sp_latched > thr_sp_max || sp_latched < thr_sp_min)
                    next_state = CALL_FAULT;
                else
                    next_state = CALL_COMPLETE;
            end

            CALL_COMPLETE:
                next_state = CALL_IDLE;

            CALL_FAULT:
                next_state = CALL_IDLE;

            default: next_state = CALL_IDLE;
        endcase
    end

    // ========================================================================
    // Isolation Outputs
    // ========================================================================

    wire [4:0] dr1_5_preserve = mask_latched[4:0];
    wire [15:0] dr_clear_computed = {8'hFF, 2'b11, ~dr1_5_preserve, 1'b0};
    wire [15:0] cr_clear_computed = {10'd0, ~cr_preserve};

    assign call_busy     = (state != CALL_IDLE);
    assign call_complete = (state == CALL_COMPLETE);
    assign call_fault    = fault_latched;
    assign fault_type    = fault_type_latched;

    assign nia_set       = (state == CALL_COMPLETE);
    assign nia_value     = nia_computed;
    assign dr_clear_mask = (state == CALL_CLEAR_B) ? dr_clear_computed : 16'd0;
    assign cr_clear_mask = (state == CALL_CLEAR_B) ? cr_clear_computed : 16'd0;

    // b_clear_mask: one bit per CR0-CR5; high for one cycle during CALL_CLEAR_B.
    // Register file clears b_flag on each asserted bit in a single clock edge,
    // replacing the old 36-cycle sequential read-modify-write loop.
    assign b_clear_mask = (state == CALL_CLEAR_B) ? cr_preserve : 6'd0;

    // cr_null_mask: bits [5:0] null non-preserved CR0-CR5 during CALL_CLEAR_B.
    // Bits [11:6] are 0 — CRs 6-11 are managed by the CALL protocol (Phases 1/2).
    assign cr_null_mask = (state == CALL_CLEAR_B) ? {6'd0, ~cr_preserve} : 12'd0;

endmodule
