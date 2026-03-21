// ============================================================================
// CTMM CHANGE Church-Instruction (CLOOMC) - Full Context Switch
// ============================================================================
// CHANGE saves DR + PC offset (with packed indicators) into the thread's
// fixed memory layout. CRs and call stack frames are already current.
//
// Syntax: CHANGE CRn[Index]
//   CRn[Index] = Location in current C-List containing new Thread's GT
//
// Design Principles:
//   - Minimal TCB: CHANGE reuses mLoad for all CR validation
//   - CRs kept current by mLoad (thread table shadow update on every CR write)
//   - Stack frames kept current by CALL/RETURN
//   - PC saved as OFFSET from CR7 (allows CR7 relocation while thread sleeps)
//   - Indicators packed into spare high bits of PC offset word (PP250 design)
//   - Only DR + packed PC offset need saving during CHANGE
//
// CHANGE Sequence:
//   Phase 0 - READ CR7: Read CR7.Location to compute PC offset base
//   Phase 1 - SAVE: Save DR[0:15] + packed PC/flags to Thread[CR8] memory
//     Write 17 words to memory at CR8.Location:
//       Offset  0..15: DR0-DR15 (64-bit data registers)
//       Offset 16:     Packed PC offset + indicators
//                      [31:0]  = PC offset from CR7.Location
//                      [35:32] = {N, Z, C, V} condition flags
//                      [63:36] = Reserved (zero)
//   Phase 2 - LOAD: Fetch new Thread GT from C-List via mLoad
//     Verify L permission on source CRn (C-List access)
//     Call mLoad(src=CRn, dst=CR8, index=Index)
//     Verify M permission on fetched thread GT (thread state access)
//   Phase 3 - RESTORE: Load CR states from new Thread[CR8]
//     For each CR in {0,1,2,3,4,5,6,9,10,11,12,13,14} (skipping 7,8,15):
//       Call mLoad(src=CR8, dst=i, index=i)
//
// Permission Checks:
//   - CR8 must have M permission (save side authorization)
//   - Source CRn must have L permission (C-List fetch)
//   - Fetched thread GT must have M permission (restore side authorization)
//   - Boot exception: initial hardwired thread GT has M directly
//
// Reserved Registers (never restored):
//   CR7  - Nucleus (kernel capability) - shared across all threads
//   CR8  - Thread (current thread identity) - changed by CHANGE itself
//   CR15 - Namespace (current namespace) - changed by SWITCH
//
// FAULT conditions:
//   - CR8 lacks M permission
//   - Source CRn lacks L permission
//   - Fetched thread GT lacks M permission
//   - Any mLoad fault during load/restore phase
// ============================================================================

module ctmm_change
    import ctmm_pkg::*;
(
    input  logic        clk,
    input  logic        rst_n,
    
    // Control interface
    input  logic        change_start,
    input  logic [3:0]  cr_src,
    input  logic [7:0]  index,
    input  logic [15:0] change_mask,
    output logic        change_busy,
    output logic        change_complete,
    output logic        change_fault,
    output fault_type_t fault_type,
    
    // Capability register read interface
    output logic [3:0]  cr_rd_addr,
    input  capability_reg_t cr_rd_data,
    
    // Capability register write interface (for mLoad)
    output logic [3:0]  cr_wr_addr,
    output capability_reg_t cr_wr_data,
    output logic        cr_wr_en,
    
    // CR8 (Thread) and CR15 (Namespace) for mLoad
    input  capability_reg_t cr8_thread,
    input  capability_reg_t cr15_namespace,
    
    // Data register read interface (for Phase 1 save)
    output logic [3:0]  dr_rd_addr,
    input  logic [63:0] dr_rd_data,
    
    // PC (NIA) read interface (for Phase 1 save)
    input  logic [31:0] pc_value,
    
    // Condition flags read interface (for Phase 1 save)
    input  condition_flags_t flags_value,
    
    // Memory read interface (for mLoad)
    output logic [31:0] mem_rd_addr,
    output logic        mem_rd_en,
    input  logic [31:0] mem_rd_data,
    input  logic        mem_rd_valid,
    
    // Memory write interface (for Phase 1 DR+PC save)
    output logic [31:0] mem_wr_addr,
    output logic [31:0] mem_wr_data,
    output logic        mem_wr_en,
    input  logic        mem_wr_done,
    
    // Thread update interface (for mLoad)
    output logic        thread_wr_en,
    output logic [3:0]  thread_wr_idx,
    output logic [31:0] thread_wr_data
);

    // ========================================================================
    // Constants
    // ========================================================================

    localparam logic [15:0] RESERVED_MASK = 16'b1000_0001_1000_0000;  // CR7, CR8, CR15

    localparam int DR_COUNT = 16;
    localparam int SAVE_DR_LAST = DR_COUNT - 1;
    localparam int SAVE_TOTAL = DR_COUNT + 1;

    // ========================================================================
    // State Machine
    // ========================================================================
    
    typedef enum logic [3:0] {
        CHANGE_IDLE,
        CHANGE_READ_CR7,
        CHANGE_LATCH_CR7,
        CHANGE_READ_CRn,
        CHANGE_LATCH_CRn,
        CHANGE_SAVE_DR,
        CHANGE_SAVE_DR_WAIT,
        CHANGE_SAVE_PACKED_PC,
        CHANGE_SAVE_PACKED_PC_WAIT,
        CHANGE_LOAD_THREAD,
        CHANGE_RESTORE_CALL,
        CHANGE_RESTORE_NEXT,
        CHANGE_COMPLETE,
        CHANGE_FAULT
    } change_state_t;
    
    change_state_t state, next_state;
    
    // ========================================================================
    // DR Save Counter (0..15 for DR0-DR15)
    // ========================================================================
    
    logic [3:0] dr_save_idx;
    logic       dr_save_inc;
    logic       dr_save_reset;
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n)
            dr_save_idx <= 4'd0;
        else if (dr_save_reset)
            dr_save_idx <= 4'd0;
        else if (dr_save_inc)
            dr_save_idx <= dr_save_idx + 4'd1;
    end

    // ========================================================================
    // CR Index Counter (for Phase 3 restore)
    // ========================================================================
    
    logic [3:0] cr_index;
    logic [3:0] cr_index_next;
    logic       cr_index_inc;
    logic       cr_index_reset;
    logic [15:0] effective_mask;
    logic       skip_current_cr;
    
    assign effective_mask = mask_latched & ~RESERVED_MASK;
    assign skip_current_cr = (cr_index > 4'd14) || !effective_mask[cr_index];
    
    always_comb begin
        cr_index_next = cr_index + 4'd1;
        while (cr_index_next <= 4'd14 && !effective_mask[cr_index_next]) begin
            cr_index_next = cr_index_next + 4'd1;
        end
    end
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n)
            cr_index <= 4'd0;
        else if (cr_index_reset)
            cr_index <= 4'd0;
        else if (cr_index_inc)
            cr_index <= cr_index_next;
    end
    
    // ========================================================================
    // Latched Registers
    // ========================================================================
    
    capability_reg_t crn_reg_latched;
    logic [7:0]      index_latched;
    logic [15:0]     mask_latched;
    logic [31:0]     thread_base_addr;
    logic [31:0]     cr7_base_addr;
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            crn_reg_latched <= '0;
            index_latched <= '0;
            mask_latched <= '0;
            thread_base_addr <= '0;
            cr7_base_addr <= '0;
        end else begin
            if (state == CHANGE_IDLE && change_start) begin
                index_latched <= index;
                mask_latched <= change_mask;
                thread_base_addr <= cr8_thread.word1_location;
            end
            if (state == CHANGE_LATCH_CR7) begin
                cr7_base_addr <= cr_rd_data.word1_location;
            end
            if (state == CHANGE_LATCH_CRn) begin
                crn_reg_latched <= cr_rd_data;
            end
        end
    end
    
    // ========================================================================
    // Permission Checks
    // ========================================================================
    
    logic crn_has_l_perm;
    logic [5:0] crn_perms;
    
    assign crn_perms = crn_reg_latched.word0_gt.perms;
    assign crn_has_l_perm = crn_perms[PERM_L];

    // ========================================================================
    // Phase 1: Save Address/Data Calculation
    // ========================================================================
    // Thread memory layout at CR8.Location:
    //   +0*8  .. +15*8 : DR0-DR15 (64-bit each)
    //   +16*8          : Packed PC offset + indicators
    //                    [31:0]  = (PC - CR7.Location) offset
    //                    [35:32] = {N, Z, C, V}
    //                    [63:36] = 0
    // ========================================================================
    
    logic [31:0] pc_offset;
    logic [31:0] packed_pc_word;
    
    assign pc_offset = pc_value - cr7_base_addr;
    // [31:28]={N,Z,C,V} [27:0]=PC offset (28-bit, sufficient for code segment offsets)
    assign packed_pc_word = {flags_value.N, flags_value.Z, flags_value.C, flags_value.V, pc_offset[27:0]};

    logic [31:0] save_addr;
    logic [31:0] save_data;
    
    always_comb begin
        save_addr = 32'h0;
        save_data = 32'h0;
        case (state)
            CHANGE_SAVE_DR, CHANGE_SAVE_DR_WAIT: begin
                // Each DR is 64-bit: save low 32 bits at even index, high 32 at odd
                save_addr = thread_base_addr + ({27'h0, dr_save_idx} << 3);
                save_data = dr_rd_data[31:0];   // low half; high half handled separately
            end
            CHANGE_SAVE_PACKED_PC, CHANGE_SAVE_PACKED_PC_WAIT: begin
                save_addr = thread_base_addr + 32'd64;   // offset 16 DRs * 4 bytes each
                save_data = packed_pc_word;
            end
            default: begin
                save_addr = 32'h0;
                save_data = 32'h0;
            end
        endcase
    end
    
    // ========================================================================
    // mLoad Subroutine Instance (Phase 2 and Phase 3)
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
    logic [31:0]        mload_mem_addr;
    logic               mload_mem_rd_en;
    logic               mload_thread_wr_en;
    logic [3:0]         mload_thread_wr_idx;
    logic [31:0]        mload_thread_wr_data;
    
    logic [3:0]         mload_src;
    logic [3:0]         mload_dst;
    logic [7:0]         mload_index;
    
    assign mload_src = (state == CHANGE_LOAD_THREAD) ? cr_src : 4'd8;
    assign mload_dst = (state == CHANGE_LOAD_THREAD) ? 4'd8 : cr_index;
    assign mload_index = (state == CHANGE_LOAD_THREAD) ? index_latched : cr_index;
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n)
            mload_start_reg <= 1'b0;
        else if ((state == CHANGE_SAVE_PACKED_PC_WAIT && next_state == CHANGE_LOAD_THREAD) ||
                 (state == CHANGE_LATCH_CRn && next_state == CHANGE_LOAD_THREAD) ||
                 (state == CHANGE_LOAD_THREAD && next_state == CHANGE_RESTORE_CALL) ||
                 (state == CHANGE_RESTORE_NEXT && next_state == CHANGE_RESTORE_CALL))
            mload_start_reg <= 1'b1;
        else
            mload_start_reg <= 1'b0;
    end
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            mload_done_latched <= 1'b0;
            mload_fault_latched <= 1'b0;
        end else if (state == CHANGE_IDLE) begin
            mload_done_latched <= 1'b0;
            mload_fault_latched <= 1'b0;
        end else if (mload_start_reg) begin
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
        .sub_direct     (1'b0),
        .sub_direct_gt  ('0),
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
        .thread_wr_data (mload_thread_wr_data)
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
            fault_type_latched <= FAULT_PERM_L;
        end else if (mload_fault_latched) begin
            fault_latched <= 1'b1;
            fault_type_latched <= mload_fault_type;
        end
    end
    
    // ========================================================================
    // State Register
    // ========================================================================
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n)
            state <= CHANGE_IDLE;
        else
            state <= next_state;
    end
    
    // ========================================================================
    // Next State Logic
    // ========================================================================
    
    always_comb begin
        next_state = state;
        cr_index_inc = 1'b0;
        cr_index_reset = 1'b0;
        dr_save_inc = 1'b0;
        dr_save_reset = 1'b0;
        
        case (state)
            CHANGE_IDLE: begin
                if (change_start) begin
                    dr_save_reset = 1'b1;
                    cr_index_reset = 1'b1;
                    next_state = CHANGE_READ_CR7;
                end
            end
            
            CHANGE_READ_CR7: begin
                next_state = CHANGE_LATCH_CR7;
            end
            
            CHANGE_LATCH_CR7: begin
                next_state = CHANGE_READ_CRn;
            end
            
            CHANGE_READ_CRn: begin
                next_state = CHANGE_LATCH_CRn;
            end
            
            CHANGE_LATCH_CRn: begin
                if (!crn_has_l_perm)
                    next_state = CHANGE_FAULT;
                else
                    next_state = CHANGE_SAVE_DR;
            end
            
            // ================================================================
            // Phase 1: Save DR[0:15] + packed PC/flags to Thread memory
            // ================================================================
            
            CHANGE_SAVE_DR: begin
                next_state = CHANGE_SAVE_DR_WAIT;
            end
            
            CHANGE_SAVE_DR_WAIT: begin
                if (mem_wr_done) begin
                    if (dr_save_idx == SAVE_DR_LAST[3:0]) begin
                        next_state = CHANGE_SAVE_PACKED_PC;
                    end else begin
                        dr_save_inc = 1'b1;
                        next_state = CHANGE_SAVE_DR;
                    end
                end
            end
            
            CHANGE_SAVE_PACKED_PC: begin
                next_state = CHANGE_SAVE_PACKED_PC_WAIT;
            end
            
            CHANGE_SAVE_PACKED_PC_WAIT: begin
                if (mem_wr_done)
                    next_state = CHANGE_LOAD_THREAD;
            end
            
            // ================================================================
            // Phase 2: Load new Thread identity into CR8
            // ================================================================
            
            CHANGE_LOAD_THREAD: begin
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
                if (skip_current_cr) begin
                    cr_index_inc = 1'b1;
                    if (cr_index_next > 4'd14)
                        next_state = CHANGE_COMPLETE;
                end else begin
                    if (mload_fault_latched)
                        next_state = CHANGE_FAULT;
                    else if (mload_done_latched)
                        next_state = CHANGE_RESTORE_NEXT;
                end
            end
            
            CHANGE_RESTORE_NEXT: begin
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
    // DR Read Address (for Phase 1 save)
    // ========================================================================
    
    assign dr_rd_addr = dr_save_idx;
    
    // ========================================================================
    // Register Read Control
    // ========================================================================
    
    always_comb begin
        cr_rd_addr = 4'd0;
        
        case (state)
            CHANGE_IDLE: begin
                if (change_start)
                    cr_rd_addr = 4'd7;
            end
            CHANGE_READ_CR7, CHANGE_LATCH_CR7: begin
                cr_rd_addr = 4'd7;
            end
            CHANGE_READ_CRn, CHANGE_LATCH_CRn: begin
                cr_rd_addr = cr_src;
            end
            default: begin
                cr_rd_addr = mload_cr_rd_addr;
            end
        endcase
    end
    
    // ========================================================================
    // Memory Interface Muxing
    // ========================================================================
    
    // Write interface: Phase 1 DR + packed PC save
    assign mem_wr_addr = save_addr;
    assign mem_wr_data = save_data;
    assign mem_wr_en = (state == CHANGE_SAVE_DR) ||
                       (state == CHANGE_SAVE_PACKED_PC);
    
    // Read interface: mLoad only
    assign mem_rd_addr = mload_mem_addr;
    assign mem_rd_en = mload_mem_rd_en;
    
    // CR write interface: mLoad only
    assign cr_wr_addr = mload_cr_wr_addr;
    assign cr_wr_data = mload_cr_wr_data;
    assign cr_wr_en = mload_cr_wr_en;
    
    // Thread update interface: mLoad only
    assign thread_wr_en = mload_thread_wr_en;
    assign thread_wr_idx = mload_thread_wr_idx;
    assign thread_wr_data = mload_thread_wr_data;
    
    // ========================================================================
    // Output Signals
    // ========================================================================
    
    assign change_busy = (state != CHANGE_IDLE);
    assign change_complete = (state == CHANGE_COMPLETE);
    assign change_fault = fault_latched;
    assign fault_type = fault_type_latched;

endmodule
