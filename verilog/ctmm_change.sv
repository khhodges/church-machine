// ============================================================================
// CTMM CHANGE Church-Instruction (CLOOMC) - Full Context Switch
// ============================================================================
// This module implements the CHANGE instruction which performs a complete
// thread context switch using the trusted mSave and mLoad micro-routines.
//
// Syntax: CHANGE CRn[Index]
//   CRn[Index] = Location in current C-List containing new Thread's GT
//
// CHANGE Sequence (25 operations: Save 12 + Load 1 + Restore 12):
//   Phase 1 - SAVE: Save current CR states to Thread[CR8]
//     For each CR in {0,1,2,3,4,5,6,9,10,11,12,13,14} (skipping 7,8,15):
//       Call mSave(dst=CR8, src_gt=CR[i].GT, index=i)
//   Phase 2 - LOAD: Fetch new Thread identity
//     Call mLoad(src=CRn, dst=CR8, index=Index)
//   Phase 3 - RESTORE: Load CR states from new Thread[CR8]
//     For each CR in {0,1,2,3,4,5,6,9,10,11,12,13,14} (skipping 7,8,15):
//       Call mLoad(src=CR8, dst=i, index=i)
//
// CHANGE_MASK Optimization:
//   The CHANGE_MASK[15:0] allows skipping CRs during save/restore.
//   Default mask skips CR7 (Nucleus), CR8 (Thread), CR15 (Namespace).
//   Optional: Skip CR11-14 for faster context switch.
//
// Reserved Registers (never saved/restored):
//   CR7  - Nucleus (kernel capability) - shared across all threads
//   CR8  - Thread (current thread identity) - changed by CHANGE itself
//   CR15 - Namespace (current namespace) - changed by SWITCH
//
// FAULT conditions:
//   - Any mSave fault during save phase
//   - Any mLoad fault during load/restore phase
//   - Source CRn lacks L permission
//   - Index out of bounds
// ============================================================================

module ctmm_change
    import ctmm_pkg::*;
(
    input  logic        clk,
    input  logic        rst_n,
    
    // Control interface
    input  logic        change_start,         // Start CHANGE execution
    input  logic [3:0]  cr_src,               // Source C-List register (CRn)
    input  logic [7:0]  index,                // Index in CRn for new Thread GT
    input  logic [15:0] change_mask,          // Mask: 1=save/restore, 0=skip
    output logic        change_busy,          // CHANGE in progress
    output logic        change_complete,      // CHANGE finished successfully
    output logic        change_fault,         // CHANGE caused a fault
    output fault_type_t fault_type,           // Type of fault
    
    // Capability register read interface
    output logic [3:0]  cr_rd_addr,           // Register to read
    input  capability_reg_t cr_rd_data,       // Full 256-bit register data
    
    // Capability register write interface (for mLoad)
    output logic [3:0]  cr_wr_addr,           // Destination register
    output capability_reg_t cr_wr_data,       // Capability to write
    output logic        cr_wr_en,             // Write enable
    
    // CR8 (Thread) and CR15 (Namespace) for mLoad
    input  capability_reg_t cr8_thread,       // Current Thread register
    input  capability_reg_t cr15_namespace,   // Namespace register
    
    // Memory read interface (for mLoad)
    output logic [63:0] mem_rd_addr,          // Memory address to read
    output logic        mem_rd_en,            // Read enable
    input  logic [63:0] mem_rd_data,          // Read data
    input  logic        mem_rd_valid,         // Read data valid
    
    // Memory write interface (for mSave)
    output logic [63:0] mem_wr_addr,          // Memory address to write
    output logic [63:0] mem_wr_data,          // Data to write
    output logic        mem_wr_en,            // Write enable
    input  logic        mem_wr_done,          // Write complete acknowledgment
    
    // Thread update interface (for mLoad)
    output logic        thread_wr_en,
    output logic [3:0]  thread_wr_idx,
    output logic [63:0] thread_wr_data,
    
    // G bit reset interface (for mLoad)
    output logic        g_bit_reset,
    output logic [63:0] g_bit_addr
);

    // ========================================================================
    // Constants - CR indices to process
    // ========================================================================
    // Reserved registers that are never saved/restored:
    //   CR7  = Nucleus (shared kernel)
    //   CR8  = Thread (handled by CHANGE)
    //   CR15 = Namespace (handled by SWITCH)
    
    localparam logic [15:0] RESERVED_MASK = 16'b1000_0001_1000_0000;  // CR7, CR8, CR15
    
    // ========================================================================
    // State Machine
    // ========================================================================
    
    typedef enum logic [3:0] {
        CHANGE_IDLE,
        CHANGE_READ_CRn,          // Read CRn to verify permissions
        CHANGE_LATCH_CRn,         // Latch CRn data
        CHANGE_SAVE_READ_CR,      // Read current CR for save phase
        CHANGE_SAVE_LATCH_CR,     // Latch CR data
        CHANGE_SAVE_CALL,         // Call mSave for current CR
        CHANGE_SAVE_NEXT,         // Move to next CR or phase
        CHANGE_LOAD_THREAD,       // Call mLoad for new Thread
        CHANGE_RESTORE_CALL,      // Call mLoad for restore phase
        CHANGE_RESTORE_NEXT,      // Move to next CR or complete
        CHANGE_COMPLETE,
        CHANGE_FAULT
    } change_state_t;
    
    change_state_t state, next_state;
    
    // ========================================================================
    // CR Index Counter
    // ========================================================================
    
    logic [3:0] cr_index;           // Current CR being processed (0-14)
    logic [3:0] cr_index_next;      // Next CR to process
    logic       cr_index_inc;       // Increment counter
    logic       cr_index_reset;     // Reset counter to 0
    logic [15:0] effective_mask;    // change_mask AND NOT RESERVED_MASK
    logic       skip_current_cr;    // Skip this CR (mask bit = 0 or reserved)
    
    assign effective_mask = mask_latched & ~RESERVED_MASK;
    assign skip_current_cr = (cr_index > 4'd14) || !effective_mask[cr_index];
    
    // Find next valid CR to process
    always_comb begin
        cr_index_next = cr_index + 4'd1;
        while (cr_index_next <= 4'd14 && !effective_mask[cr_index_next]) begin
            cr_index_next = cr_index_next + 4'd1;
        end
    end
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            cr_index <= 4'd0;
        end else if (cr_index_reset) begin
            // Find first valid CR
            cr_index <= 4'd0;
        end else if (cr_index_inc) begin
            cr_index <= cr_index_next;
        end
    end
    
    // ========================================================================
    // Latched Registers
    // ========================================================================
    
    capability_reg_t crn_reg_latched;    // Source C-List register
    capability_reg_t current_cr_latched; // Current CR being saved
    logic [7:0]      index_latched;      // Index latched on start
    logic [15:0]     mask_latched;       // Mask latched on start
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            crn_reg_latched <= '0;
            current_cr_latched <= '0;
            index_latched <= '0;
            mask_latched <= '0;
        end else begin
            if (state == CHANGE_IDLE && change_start) begin
                index_latched <= index;
                mask_latched <= change_mask;
            end
            if (state == CHANGE_LATCH_CRn) begin
                crn_reg_latched <= cr_rd_data;
            end
            if (state == CHANGE_SAVE_LATCH_CR) begin
                current_cr_latched <= cr_rd_data;
            end
        end
    end
    
    // ========================================================================
    // Source Permission Check
    // ========================================================================
    
    logic crn_has_l_perm;
    logic [9:0] crn_perms;
    
    assign crn_perms = crn_reg_latched.word0_gt[57:48];
    assign crn_has_l_perm = crn_perms[PERM_L];
    
    // ========================================================================
    // mSave Subroutine Instance
    // ========================================================================
    
    logic               msave_start;
    logic               msave_start_reg;
    logic               msave_busy;
    logic               msave_done;
    logic               msave_fault;
    logic               msave_done_latched;
    logic               msave_fault_latched;
    fault_type_t        msave_fault_type;
    logic [63:0]        msave_wr_addr;
    logic [63:0]        msave_wr_data;
    logic               msave_wr_en;
    
    // Single-cycle pulse for mSave start
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n)
            msave_start_reg <= 1'b0;
        else if (state == CHANGE_SAVE_LATCH_CR && next_state == CHANGE_SAVE_CALL)
            msave_start_reg <= 1'b1;
        else
            msave_start_reg <= 1'b0;
    end
    
    // Sticky latches for mSave completion
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            msave_done_latched <= 1'b0;
            msave_fault_latched <= 1'b0;
        end else if (state == CHANGE_IDLE || state == CHANGE_SAVE_NEXT) begin
            msave_done_latched <= 1'b0;
            msave_fault_latched <= 1'b0;
        end else begin
            if (msave_done) msave_done_latched <= 1'b1;
            if (msave_fault) msave_fault_latched <= 1'b1;
        end
    end
    
    assign msave_start = msave_start_reg;
    
    ctmm_msave u_msave (
        .clk            (clk),
        .rst_n          (rst_n),
        .sub_start      (msave_start),
        .sub_dst_cap    (cr8_thread),               // Save to Thread (CR8)
        .sub_src_gt     (current_cr_latched.word0_gt),
        .sub_index      (cr_index),                 // Thread[cr_index] = CR[cr_index].GT
        .sub_busy       (msave_busy),
        .sub_done       (msave_done),
        .sub_fault      (msave_fault),
        .sub_fault_type (msave_fault_type),
        .mem_wr_addr    (msave_wr_addr),
        .mem_wr_data    (msave_wr_data),
        .mem_wr_en      (msave_wr_en),
        .mem_wr_done    (mem_wr_done)
    );
    
    // ========================================================================
    // mLoad Subroutine Instance
    // ========================================================================
    
    logic               mload_start;
    logic               mload_start_reg;
    logic               mload_busy;
    logic               mload_done;
    logic               mload_fault;
    logic               mload_done_latched;
    logic               mload_fault_latched;
    fault_type_t        mload_fault_type;
    logic [3:0]         mload_cr_rd_addr;
    logic [3:0]         mload_cr_wr_addr;
    capability_reg_t    mload_cr_wr_data;
    logic               mload_cr_wr_en;
    logic [63:0]        mload_mem_addr;
    logic               mload_mem_rd_en;
    logic               mload_thread_wr_en;
    logic [3:0]         mload_thread_wr_idx;
    logic [63:0]        mload_thread_wr_data;
    logic               mload_g_bit_reset;
    logic [63:0]        mload_g_bit_addr;
    
    // mLoad source and destination depend on phase
    logic [3:0]         mload_src;
    logic [3:0]         mload_dst;
    logic [7:0]         mload_index;
    
    // In LOAD_THREAD phase: src=CRn, dst=CR8, index=user_index
    // In RESTORE phase: src=CR8, dst=cr_index, index=cr_index
    assign mload_src = (state == CHANGE_LOAD_THREAD) ? cr_src : 4'd8;  // CRn or CR8
    assign mload_dst = (state == CHANGE_LOAD_THREAD) ? 4'd8 : cr_index;
    assign mload_index = (state == CHANGE_LOAD_THREAD) ? index_latched : cr_index;
    
    // Single-cycle pulse for mLoad start
    // Pulse on entry to LOAD_THREAD or RESTORE_CALL (for each restore)
    // Use state transitions to detect entry:
    //   - Entering LOAD_THREAD: from SAVE_NEXT or SAVE_READ_CR (all saves done)
    //   - Entering RESTORE_CALL: from LOAD_THREAD (after thread load) or RESTORE_NEXT
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n)
            mload_start_reg <= 1'b0;
        else if ((state == CHANGE_SAVE_NEXT && next_state == CHANGE_LOAD_THREAD) ||      // Saves done → Thread load
                 (state == CHANGE_SAVE_READ_CR && next_state == CHANGE_LOAD_THREAD) ||   // Skipped all saves
                 (state == CHANGE_LOAD_THREAD && next_state == CHANGE_RESTORE_CALL) ||   // Thread done → first restore
                 (state == CHANGE_RESTORE_NEXT && next_state == CHANGE_RESTORE_CALL))    // Next restore
            mload_start_reg <= 1'b1;
        else
            mload_start_reg <= 1'b0;
    end
    
    // Sticky latches for mLoad completion
    // Clear only on IDLE or when starting a new mLoad call
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            mload_done_latched <= 1'b0;
            mload_fault_latched <= 1'b0;
        end else if (state == CHANGE_IDLE) begin
            mload_done_latched <= 1'b0;
            mload_fault_latched <= 1'b0;
        end else if (mload_start_reg) begin
            // Clear on new mLoad start
            mload_done_latched <= 1'b0;
            mload_fault_latched <= 1'b0;
        end else begin
            if (mload_done) mload_done_latched <= 1'b1;
            if (mload_fault) mload_fault_latched <= 1'b1;
        end
    end
    
    assign mload_start = mload_start_reg;
    
    ctmm_mload u_mload (
        .clk            (clk),
        .rst_n          (rst_n),
        .sub_start      (mload_start),
        .sub_cr_src     (mload_src),
        .sub_cr_dst     (mload_dst),
        .sub_index      (mload_index),
        .sub_busy       (mload_busy),
        .sub_done       (mload_done),
        .sub_fault      (mload_fault),
        .sub_fault_type (mload_fault_type),
        .cr_rd_addr     (mload_cr_rd_addr),
        .cr_rd_data     (cr_rd_data),
        .cr_wr_addr     (mload_cr_wr_addr),
        .cr_wr_data     (mload_cr_wr_data),
        .cr_wr_en       (mload_cr_wr_en),
        .cr15_namespace (cr15_namespace),
        .mem_addr       (mload_mem_addr),
        .mem_rd_en      (mload_mem_rd_en),
        .mem_rd_data    (mem_rd_data),
        .mem_rd_valid   (mem_rd_valid),
        .thread_wr_en   (mload_thread_wr_en),
        .thread_wr_idx  (mload_thread_wr_idx),
        .thread_wr_data (mload_thread_wr_data),
        .g_bit_reset    (mload_g_bit_reset),
        .g_bit_addr     (mload_g_bit_addr)
    );
    
    // ========================================================================
    // Fault Latching
    // ========================================================================
    
    logic        fault_latched;
    fault_type_t fault_type_latched;
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            fault_latched <= 1'b0;
            fault_type_latched <= FAULT_NONE;
        end else if (state == CHANGE_IDLE) begin
            fault_latched <= 1'b0;
            fault_type_latched <= FAULT_NONE;
        end else if (state == CHANGE_LATCH_CRn && !crn_has_l_perm) begin
            fault_latched <= 1'b1;
            fault_type_latched <= FAULT_PERM;
        end else if (msave_fault_latched) begin
            fault_latched <= 1'b1;
            fault_type_latched <= msave_fault_type;
        end else if (mload_fault_latched) begin
            fault_latched <= 1'b1;
            fault_type_latched <= mload_fault_type;
        end
    end
    
    // ========================================================================
    // State Register
    // ========================================================================
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            state <= CHANGE_IDLE;
        end else begin
            state <= next_state;
        end
    end
    
    // ========================================================================
    // Next State Logic
    // ========================================================================
    
    always_comb begin
        next_state = state;
        cr_index_inc = 1'b0;
        cr_index_reset = 1'b0;
        
        case (state)
            CHANGE_IDLE: begin
                if (change_start) begin
                    cr_index_reset = 1'b1;
                    next_state = CHANGE_READ_CRn;
                end
            end
            
            CHANGE_READ_CRn: begin
                // Read CRn to verify L permission
                next_state = CHANGE_LATCH_CRn;
            end
            
            CHANGE_LATCH_CRn: begin
                // Check L permission
                if (!crn_has_l_perm)
                    next_state = CHANGE_FAULT;
                else
                    next_state = CHANGE_SAVE_READ_CR;
            end
            
            // ================================================================
            // Phase 1: Save current CRs to Thread
            // ================================================================
            
            CHANGE_SAVE_READ_CR: begin
                // Skip if this CR is masked out
                if (skip_current_cr) begin
                    cr_index_inc = 1'b1;
                    if (cr_index_next > 4'd14)
                        next_state = CHANGE_LOAD_THREAD;  // All saves done
                    // else stay in SAVE_READ_CR to check next
                end else begin
                    next_state = CHANGE_SAVE_LATCH_CR;
                end
            end
            
            CHANGE_SAVE_LATCH_CR: begin
                // CR data latched, start mSave
                next_state = CHANGE_SAVE_CALL;
            end
            
            CHANGE_SAVE_CALL: begin
                // Wait for mSave to complete
                if (msave_fault_latched)
                    next_state = CHANGE_FAULT;
                else if (msave_done_latched)
                    next_state = CHANGE_SAVE_NEXT;
            end
            
            CHANGE_SAVE_NEXT: begin
                // Move to next CR
                cr_index_inc = 1'b1;
                if (cr_index_next > 4'd14)
                    next_state = CHANGE_LOAD_THREAD;
                else
                    next_state = CHANGE_SAVE_READ_CR;
            end
            
            // ================================================================
            // Phase 2: Load new Thread identity into CR8
            // ================================================================
            
            CHANGE_LOAD_THREAD: begin
                // mLoad started by pulse generator
                // Wait for completion
                if (mload_fault_latched)
                    next_state = CHANGE_FAULT;
                else if (mload_done_latched) begin
                    cr_index_reset = 1'b1;
                    next_state = CHANGE_RESTORE_CALL;
                end
            end
            
            // ================================================================
            // Phase 3: Restore CRs from new Thread
            // ================================================================
            
            CHANGE_RESTORE_CALL: begin
                // Skip if this CR is masked out
                if (skip_current_cr) begin
                    cr_index_inc = 1'b1;
                    if (cr_index_next > 4'd14)
                        next_state = CHANGE_COMPLETE;
                    // else stay in RESTORE_CALL to check next
                end else begin
                    // Wait for mLoad to complete
                    if (mload_fault_latched)
                        next_state = CHANGE_FAULT;
                    else if (mload_done_latched)
                        next_state = CHANGE_RESTORE_NEXT;
                end
            end
            
            CHANGE_RESTORE_NEXT: begin
                // Move to next CR
                cr_index_inc = 1'b1;
                if (cr_index_next > 4'd14)
                    next_state = CHANGE_COMPLETE;
                else
                    next_state = CHANGE_RESTORE_CALL;
            end
            
            CHANGE_COMPLETE: begin
                next_state = CHANGE_IDLE;
            end
            
            CHANGE_FAULT: begin
                next_state = CHANGE_IDLE;
            end
            
            default: next_state = CHANGE_IDLE;
        endcase
    end
    
    // ========================================================================
    // Register Read Control
    // ========================================================================
    
    always_comb begin
        cr_rd_addr = 4'd0;
        
        case (state)
            CHANGE_IDLE: begin
                if (change_start)
                    cr_rd_addr = cr_src;
            end
            CHANGE_READ_CRn, CHANGE_LATCH_CRn: begin
                cr_rd_addr = cr_src;
            end
            CHANGE_SAVE_READ_CR, CHANGE_SAVE_LATCH_CR: begin
                cr_rd_addr = cr_index;  // Read current CR
            end
            default: begin
                // During mLoad phases, mLoad controls cr_rd_addr
                cr_rd_addr = mload_cr_rd_addr;
            end
        endcase
    end
    
    // ========================================================================
    // Memory Interface Muxing
    // ========================================================================
    
    // Write interface: mSave only
    assign mem_wr_addr = msave_wr_addr;
    assign mem_wr_data = msave_wr_data;
    assign mem_wr_en = msave_wr_en;
    
    // Read interface: mLoad only
    assign mem_rd_addr = mload_mem_addr;
    assign mem_rd_en = mload_mem_rd_en;
    
    // CR write interface: mLoad only
    assign cr_wr_addr = mload_cr_wr_addr;
    assign cr_wr_data = mload_cr_wr_data;
    assign cr_wr_en = mload_cr_wr_en;
    
    // Thread and G bit interfaces: mLoad only
    assign thread_wr_en = mload_thread_wr_en;
    assign thread_wr_idx = mload_thread_wr_idx;
    assign thread_wr_data = mload_thread_wr_data;
    assign g_bit_reset = mload_g_bit_reset;
    assign g_bit_addr = mload_g_bit_addr;
    
    // ========================================================================
    // Output Signals
    // ========================================================================
    
    assign change_busy = (state != CHANGE_IDLE);
    assign change_complete = (state == CHANGE_COMPLETE);
    assign change_fault = fault_latched;
    assign fault_type = fault_type_latched;

endmodule
