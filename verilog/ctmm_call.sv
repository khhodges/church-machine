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
//   Pre: Save CR5 GT for later restoration by RETURN
//   Phase 1: mLoad CRs[Index] → CR6   (nodal C-List)
//   Phase 2: mLoad CR6[0]    → CR14   (CLOOMC code capability)
//   Phase 3: Fetch NS[CR14.slot_id].word3_lump (+12) to read mw field
//   Phase 4: NIA = CR14.word1_location + (1 + mw) * 4
//   Phase 5: Clear B-flag on preserved CRs, apply isolation
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

    // Saved CR5 GT output for RETURN restoration
    output golden_token_t saved_cr5_gt,

    // Isolation interface
    output logic        nia_set,
    output logic [31:0] nia_value,
    output logic [15:0] dr_clear_mask,
    output logic [15:0] cr_clear_mask
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
        CALL_CLEAR_B_INIT,
        CALL_CLEAR_B_CHECK,
        CALL_CLEAR_B_READ,
        CALL_CLEAR_B_WRITE,
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
    // FETCH_LUMP: read NS[slot_id].word3_lump (+12) for mw field
    // ========================================================================
    // NS entry base = CR15.word1_location + (slot_id << 4); lump is at +12.

    logic [31:0] lump_fetch_addr;
    logic [31:0] lump_reg;          // word3_lump raw value

    assign lump_fetch_addr = cr15_namespace.word1_location
                           + ({16'h0, cr14_latched.word0_gt.slot_id} << 4)
                           + 32'd12;

    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n)
            lump_reg <= 32'd0;
        else if (state == CALL_FETCH_LUMP && mem_rd_valid)
            lump_reg <= mem_rd_data;
    end

    // Decode word3_lump via lump_header_t struct (defined in ctmm_pkg.sv)
    // lump_header_t is a packed struct matching LUMP_HEADER_LAYOUT in layouts.py:
    //   .r [0], .c [1], .h [2], .mw [8:3], .typ [10:9], .cc [18:11],
    //   .n_minus_6 [22:19], .ver [26:23], .magic [31:27]
    lump_header_t lump_view;
    assign lump_view = lump_reg;

    // NIA = code_base + (1 + mw) * 4  (skip over the prologue header word)
    // mw is 6 bits from lump_view.mw (bits [8:3] of word3_lump)
    logic [31:0] nia_computed;
    assign nia_computed = cr14_latched.word1_location
                        + ({26'd0, lump_view.mw} + 32'd1) * 32'd4;

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
        .mem_rd_valid   (lump_fetch_active ? 1'b0 : mem_rd_valid),
        .thread_wr_en   (thread_wr_en),
        .thread_wr_idx  (thread_wr_idx),
        .thread_wr_data (thread_wr_data)
    );

    // ========================================================================
    // B-Flag Clearing Loop
    // ========================================================================
    // After both loads complete, walk CR0-CR5 that are PRESERVED (mask=1)
    // and clear the b_flag from word0_gt so they are unbound in the new domain.

    logic [2:0]      b_idx;
    capability_reg_t b_cr_latched;
    logic            b_wr_en_local;
    logic [3:0]      b_wr_addr_local;
    capability_reg_t b_wr_data_local;

    logic [5:0] cr_preserve;
    assign cr_preserve = mask_latched[10:5];

    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n)
            b_idx <= 3'd0;
        else if (state == CALL_CLEAR_B_INIT)
            b_idx <= 3'd0;
        else if (state == CALL_CLEAR_B_CHECK && !cr_preserve[b_idx])
            b_idx <= b_idx + 3'd1;
        else if (state == CALL_CLEAR_B_WRITE)
            b_idx <= b_idx + 3'd1;
    end

    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n)
            b_cr_latched <= CR_NULL;
        else if (state == CALL_CLEAR_B_READ)
            b_cr_latched <= cr_rd_data;
    end

    // ========================================================================
    // Memory Muxing (local FETCH_LUMP vs mLoad sub-module)
    // ========================================================================

    logic [31:0] sub_mem_addr;
    logic        sub_mem_rd_en;
    logic        lump_fetch_active;

    assign lump_fetch_active = (state == CALL_FETCH_LUMP) ||
                               (state == CALL_PHASE2_DONE);

    assign mem_addr   = lump_fetch_active ? lump_fetch_addr : sub_mem_addr;
    assign mem_rd_en  = lump_fetch_active ? (state == CALL_FETCH_LUMP) : sub_mem_rd_en;

    // ========================================================================
    // Register Read/Write Muxing
    // ========================================================================

    logic local_rd_en;
    logic [3:0] local_rd_addr;

    assign local_rd_en  = (state == CALL_CHECK_SRC) || (state == CALL_READ_SRC) ||
                          (state == CALL_READ_CR5)  || (state == CALL_CLEAR_B_CHECK) ||
                          (state == CALL_CLEAR_B_READ);
    assign local_rd_addr = (state == CALL_READ_CR5) ? 4'd5 :
                           ((state == CALL_CLEAR_B_CHECK) || (state == CALL_CLEAR_B_READ))
                           ? {1'b0, b_idx} : cr_src;

    assign cr_rd_addr = local_rd_en ? local_rd_addr : sub_cr_rd_addr;

    // B-flag clear write
    always_comb begin
        b_wr_en_local   = 1'b0;
        b_wr_addr_local = 4'd0;
        b_wr_data_local = CR_NULL;
        if (state == CALL_CLEAR_B_WRITE) begin
            b_wr_en_local        = 1'b1;
            b_wr_addr_local      = {1'b0, b_idx};
            b_wr_data_local      = b_cr_latched;
            b_wr_data_local.word0_gt.b_flag = 1'b0;
        end
    end

    assign cr_wr_en   = b_wr_en_local | sub_cr_wr_en;
    assign cr_wr_addr = b_wr_en_local ? b_wr_addr_local : sub_cr_wr_addr;
    assign cr_wr_data = b_wr_en_local ? b_wr_data_local : sub_cr_wr_data;

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
                if (mem_rd_valid) next_state = CALL_CLEAR_B_INIT;

            CALL_CLEAR_B_INIT:
                next_state = CALL_CLEAR_B_CHECK;

            CALL_CLEAR_B_CHECK:
                if (b_idx > 3'd5)                next_state = CALL_COMPLETE;
                else if (cr_preserve[b_idx])     next_state = CALL_CLEAR_B_READ;
                // else stay: b_idx increments in FF

            CALL_CLEAR_B_READ:
                next_state = CALL_CLEAR_B_WRITE;

            CALL_CLEAR_B_WRITE:
                next_state = CALL_CLEAR_B_CHECK;

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

    assign nia_set      = (state == CALL_COMPLETE);
    assign nia_value    = nia_computed;
    assign dr_clear_mask = (state == CALL_COMPLETE) ? dr_clear_computed : 16'd0;
    assign cr_clear_mask = (state == CALL_COMPLETE) ? cr_clear_computed : 16'd0;

endmodule
