// ============================================================================
// CTMM RETURN Instruction - Using mLoad for CR Restoration
// ============================================================================
// Implements the RETURN instruction which returns from a procedure call
// by restoring the saved context through mLoad validation.
//
// Syntax: RETURN CRn
//   CRn = Register containing return capability (saved by CALL)
//
// RETURN Steps:
//   1. Read return capability from CRn
//   2. Verify CRn has E (Enter) permission
//   3. Extract saved CR6 GT and CR7 GT from return capability
//   4. Phase 0: Route saved CR5 GT through mLoad → CR5 (tolerant: fault clears CR5)
//      - Revalidates version/MAC against namespace (catches recycled entries)
//      - If mLoad faults, CR5 is cleared and execution continues
//   5. Check saved CR6 GT has E permission (fault if not)
//   6. Phase 1: Route saved CR6 GT through mLoad → CR6
//      - Revalidates version/MAC against namespace (catches recycled entries)
//      - Resets G-bit on namespace entry
//      - Updates thread table shadow at Thread[CR6]
//   7. Elevate M permission on CR6 after successful mLoad
//   8. Phase 2: Route saved CR7 GT through mLoad → CR7
//      - Same validation pipeline as Phase 1
//   9. Set NIA to saved return address + 1 (advance past CALL/CHANGE)
//  10. Clear M bit (leaving internal abstraction)
//
// Golden Rule: All CR writes go through mLoad. RETURN does NOT directly
// write to CR6/CR7. Instead, mLoad revalidates the saved GTs against
// the namespace, catching any entries that were recycled during the call.
//
// FAULT conditions:
//   - CRn lacks E permission
//   - CRn is null capability
//   - Saved CR6 GT lacks E permission
//   - Saved CR6/CR7 GT fails mLoad validation (version/MAC/bounds)
// ============================================================================

module ctmm_return
    import ctmm_pkg::*;
(
    input  logic        clk,
    input  logic        rst_n,
    
    // Control interface
    input  logic        return_start,
    input  logic [2:0]  cr_src,
    output logic        busy,
    output logic        complete,
    output logic        fault_valid,
    output fault_type_t fault_type,
    
    // Capability register read interface
    output logic [3:0]  cr_rd_addr,
    input  capability_reg_t cr_rd_data,
    
    // Capability register write interface (driven by mLoad or local)
    output logic [3:0]  cr_wr_addr,
    output capability_reg_t cr_wr_data,
    output logic        cr_wr_en,
    
    // NIA update interface
    output logic        nia_set,
    output logic [31:0] nia_value,

    // M bit clear interface
    output logic        clear_m_bit,

    // CR15 (Namespace) interface for mLoad
    input  capability_reg_t cr15_namespace,

    // Memory interface (32-bit)
    output logic [31:0] mem_addr,
    output logic        mem_rd_en,
    input  logic [31:0] mem_rd_data,
    input  logic        mem_rd_valid,

    // Thread update interface (driven by mLoad)
    output logic        thread_wr_en,
    output logic [3:0]  thread_wr_idx,
    output logic [31:0] thread_wr_data
);

    // ========================================================================
    // Constants
    // ========================================================================
    
    localparam logic [3:0] CR6_CLIST = 4'd6;
    localparam logic [3:0] CR14_CODE  = 4'd14;
    
    // ========================================================================
    // State Machine
    // ========================================================================
    
    typedef enum logic [3:0] {
        IDLE,
        READ_SRC,
        CHECK_PERM,
        CHECK_CR6_E,
        PHASE1_START,
        PHASE1_WAIT,
        PHASE1_DONE,
        PHASE2_START,
        PHASE2_WAIT,
        SET_NIA,
        COMPLETE,
        FAULT
    } state_t;
    
    state_t state, next_state;
    
    // ========================================================================
    // Latched Data
    // ========================================================================
    
    capability_reg_t return_cap;
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n)
            return_cap <= '0;
        else if (state == READ_SRC)
            return_cap <= cr_rd_data;
    end
    
    // ========================================================================
    // Permission Check
    // ========================================================================
    
    logic has_e_perm;
    logic is_null_cap;
    logic [5:0] src_perms;
    
    assign src_perms = return_cap.word0_gt.perms;
    assign has_e_perm = src_perms[PERM_E];
    assign is_null_cap = (return_cap.word0_gt == GT_NULL);
    
    // ========================================================================
    // Extracted Return Values
    // ========================================================================
    
    logic [31:0] saved_nia;
    golden_token_t saved_cr6_gt;
    golden_token_t saved_cr7_gt;
    
    assign saved_nia = return_cap.word1_location;
    assign saved_cr6_gt = return_cap.word2_w2;
    assign saved_cr7_gt = return_cap.word3_w3;
    
    // ========================================================================
    // Saved CR6 GT E Permission Check
    // ========================================================================
    
    logic saved_cr6_has_e;
    logic [5:0] saved_cr6_perms;
    assign saved_cr6_perms = saved_cr6_gt.perms;
    assign saved_cr6_has_e = saved_cr6_perms[PERM_E];
    
    // ========================================================================
    // Phase Tracking
    // ========================================================================
    
    logic [1:0] phase;  // 0 = Phase 1 (restore CR6), 1 = Phase 2 (restore CR7)
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n)
            phase <= 2'd0;
        else if (state == IDLE)
            phase <= 2'd0;
        else if (state == PHASE1_DONE)
            phase <= 2'd1;
    end
    
    // ========================================================================
    // CR6 Latch - captures mLoad output when writing CR6 during Phase 1
    // ========================================================================
    
    logic [3:0]      mload_cr_wr_addr;
    capability_reg_t mload_cr_wr_data;
    logic            mload_cr_wr_en;
    
    capability_reg_t cr6_latched;
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n)
            cr6_latched <= '0;
        else if (mload_cr_wr_en && mload_cr_wr_addr == CR6_CLIST)
            cr6_latched <= mload_cr_wr_data;
    end
    
    // (M elevation removed - M is transient, not stored in GT)
    
    // ========================================================================
    // State Register
    // ========================================================================
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n)
            state <= IDLE;
        else
            state <= next_state;
    end
    
    // ========================================================================
    // Fault Latching
    // ========================================================================
    
    fault_type_t fault_latched;
    logic fault_flag;
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            fault_flag <= 1'b0;
            fault_latched <= FAULT_NONE;
        end else if (state == IDLE) begin
            fault_flag <= 1'b0;
            fault_latched <= FAULT_NONE;
        end else if (state == CHECK_PERM) begin
            if (is_null_cap) begin
                fault_flag <= 1'b1;
                fault_latched <= FAULT_NULL_CAP;
            end else if (!has_e_perm) begin
                fault_flag <= 1'b1;
                fault_latched <= FAULT_PERM_E;
            end
        end else if (state == CHECK_CR6_E && !saved_cr6_has_e) begin
            fault_flag <= 1'b1;
            fault_latched <= FAULT_PERM_E;
        end else if ((state == PHASE1_WAIT || state == PHASE2_WAIT) && sub_fault_latched) begin
            fault_flag <= 1'b1;
            fault_latched <= sub_fault_type;
        end
    end
    
    // ========================================================================
    // mLoad Subroutine Instance
    // ========================================================================
    
    logic        sub_start;
    logic        sub_start_reg;
    logic        sub_busy;
    logic        sub_done;
    logic        sub_fault_sig;
    logic        sub_done_latched;
    logic        sub_fault_latched;
    fault_type_t sub_fault_type;
    
    logic [3:0]  sub_cr_rd_addr;
    
    logic [3:0]  mload_dst;
    logic [31:0] mload_direct_gt;
    
    always_comb begin
        case (phase)
            2'd0: begin
                mload_dst = CR6_CLIST;
                mload_direct_gt = saved_cr6_gt;
            end
            default: begin
                mload_dst = CR14_CODE;
                mload_direct_gt = saved_cr7_gt;
            end
        endcase
    end
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n)
            sub_start_reg <= 1'b0;
        else if ((state == PHASE1_START) || (state == PHASE2_START))
            sub_start_reg <= 1'b1;
        else
            sub_start_reg <= 1'b0;
    end
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            sub_done_latched <= 1'b0;
            sub_fault_latched <= 1'b0;
        end else if (state == IDLE || state == PHASE1_START || state == PHASE2_START) begin
            sub_done_latched <= 1'b0;
            sub_fault_latched <= 1'b0;
        end else begin
            if (sub_done) sub_done_latched <= 1'b1;
            if (sub_fault_sig) sub_fault_latched <= 1'b1;
        end
    end
    
    assign sub_start = sub_start_reg;
    
    ctmm_mload u_mload (
        .clk            (clk),
        .rst_n          (rst_n),
        
        .sub_start      (sub_start),
        .sub_cr_src     (4'd0),            // Unused in direct mode
        .sub_cr_dst     (mload_dst),
        .sub_index      (16'd0),
        .sub_direct     (1'b1),
        .sub_direct_gt  (mload_direct_gt),
        .sub_m_elevated (1'b0),
        .sub_busy       (sub_busy),
        .sub_done       (sub_done),
        .sub_fault      (sub_fault_sig),
        .sub_fault_type (sub_fault_type),
        
        .cr_rd_addr     (sub_cr_rd_addr),
        .cr_rd_data     (cr_rd_data),
        .cr_wr_addr     (mload_cr_wr_addr),
        .cr_wr_data     (mload_cr_wr_data),
        .cr_wr_en       (mload_cr_wr_en),
        
        .cr15_namespace (cr15_namespace),
        
        .mem_addr       (mem_addr),
        .mem_rd_en      (mem_rd_en),
        .mem_rd_data    (mem_rd_data),
        .mem_rd_valid   (mem_rd_valid),
        
        .thread_wr_en   (thread_wr_en),
        .thread_wr_idx  (thread_wr_idx),
        .thread_wr_data (thread_wr_data)
    );
    
    assign cr_wr_en   = mload_cr_wr_en;
    assign cr_wr_addr = mload_cr_wr_addr;
    assign cr_wr_data = mload_cr_wr_data;
    
    // ========================================================================
    // Next State Logic
    // ========================================================================
    
    always_comb begin
        next_state = state;
        
        case (state)
            IDLE: begin
                if (return_start)
                    next_state = READ_SRC;
            end
            
            READ_SRC: next_state = CHECK_PERM;
            
            CHECK_PERM: begin
                if (is_null_cap || !has_e_perm)
                    next_state = FAULT;
                else
                    next_state = CHECK_CR6_E;
            end
            
            CHECK_CR6_E: begin
                if (!saved_cr6_has_e)
                    next_state = FAULT;
                else
                    next_state = PHASE1_START;
            end
            
            PHASE1_START: next_state = PHASE1_WAIT;
            
            PHASE1_WAIT: begin
                if (sub_fault_latched)
                    next_state = FAULT;
                else if (sub_done_latched)
                    next_state = PHASE1_DONE;
            end
            
            PHASE1_DONE: next_state = PHASE2_START;
            PHASE2_START: next_state = PHASE2_WAIT;
            
            PHASE2_WAIT: begin
                if (sub_fault_latched)
                    next_state = FAULT;
                else if (sub_done_latched)
                    next_state = SET_NIA;
            end
            
            SET_NIA: next_state = COMPLETE;
            COMPLETE: next_state = IDLE;
            FAULT: next_state = IDLE;
            
            default: next_state = IDLE;
        endcase
    end
    
    // ========================================================================
    // Output Signals
    // ========================================================================
    
    assign busy = (state != IDLE);
    assign complete = (state == COMPLETE);
    assign fault_valid = fault_flag;
    assign fault_type = fault_latched;
    
    logic local_cr_rd_en;
    assign local_cr_rd_en = (state == IDLE && return_start) || (state == READ_SRC);
    assign cr_rd_addr = local_cr_rd_en ? {1'b0, cr_src} : sub_cr_rd_addr;
    
    // NIA update - advance past saved instruction (CALL or CHANGE)
    assign nia_set = (state == SET_NIA);
    assign nia_value = saved_nia + 32'd1;
    
    assign clear_m_bit = 1'b0;

endmodule
