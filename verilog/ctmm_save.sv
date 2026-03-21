// ============================================================================
// CTMM SAVE Church-Instruction (CLOOMC)
// ============================================================================
// This module implements the SAVE instruction which stores a Golden Token
// from a source CR into a C-List at a specified index.
//
// Syntax: SAVE CRs, CRd[Index]
//   CRs = Source CR (the capability whose GT we're saving)
//   CRd[Index] = Destination C-List slot
//
// SAVE Steps:
//   Step 1: Verify CRd in 0-6 AND initiate register reads (parallel)
//   Step 2: Latch destination and source register data
//   Step 3: Call mSave with destination cap, source GT, and index
//   Step 4: On success, reset G-bit on the destination C-List namespace entry
//
// The actual permission checks and memory write are done by ctmm_msave.sv
// This reduces the Trusted Computing Base - SAVE and CHANGE share mSave.
//
// G-bit Reset:
//   After a successful mSave, the G-bit is reset on the namespace entry
//   that the destination C-List GT points to. This signals the garbage
//   collector that this namespace entry is actively referenced.
//   Address calculation: CR15.Location + dst_GT.offset + 16
//
// FAULT conditions:
//   - Destination CRd not in range 0-6 (checked here)
//   - mSave faults (S permission, M||B, bounds)
// ============================================================================

module ctmm_save
    import ctmm_pkg::*;
(
    input  logic        clk,
    input  logic        rst_n,
    
    // Control interface
    input  logic        save_start,           // Start SAVE execution
    input  logic [3:0]  cr_src,               // Source register (CRs) - GT to save
    input  logic [3:0]  cr_dst,               // Destination C-List (CRd) - must be CR0-CR6
    input  logic [15:0] index,                // C-List index
    output logic        save_busy,            // SAVE in progress
    output logic        save_complete,        // SAVE finished successfully
    output logic        save_fault,           // SAVE caused a fault
    output fault_type_t fault_type,           // Type of fault
    
    // Capability register read interface
    output logic [3:0]  cr_rd_addr,           // Register to read
    input  capability_reg_t cr_rd_data,       // Full 256-bit register data
    
    // Memory write interface (32-bit)
    output logic [31:0] mem_wr_addr,
    output logic [31:0] mem_wr_data,
    output logic        mem_wr_en,
    input  logic        mem_wr_done,

    // Memory read interface (for NS validation)
    output logic [31:0] mem_rd_addr,
    output logic        mem_rd_en,
    input  logic [31:0] mem_rd_data,
    input  logic        mem_rd_valid,

    // CR15 (Namespace) interface
    input  capability_reg_t cr15_namespace
);

    // ========================================================================
    // Constants
    // ========================================================================
    
    localparam logic [3:0] MAX_CLIST_REG = 4'd6;  // Maximum allowed destination register
    
    // ========================================================================
    // State Machine - SAVE instruction wrapper
    // ========================================================================
    
    typedef enum logic [2:0] {
        SAVE_IDLE,
        SAVE_CHECK_DST_READ,  // Verify CRd in 0-6 AND initiate destination read
        SAVE_LATCH_DST,       // Latch destination, initiate source read
        SAVE_LATCH_SRC,       // Latch source
        SAVE_CALL_SUB,        // Call mSave and wait for completion
        SAVE_RESET_G          // Reset G-bit on destination C-List namespace entry
    } save_state_t;
    
    save_state_t state, next_state;
    
    // ========================================================================
    // Register Latches
    // ========================================================================
    
    capability_reg_t dst_reg_latched;  // Destination C-List register
    capability_reg_t src_reg_latched;  // Source register (for GT)
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            dst_reg_latched <= '0;
            src_reg_latched <= '0;
        end else begin
            if (state == SAVE_LATCH_DST) begin
                dst_reg_latched <= cr_rd_data;
            end
            if (state == SAVE_LATCH_SRC) begin
                src_reg_latched <= cr_rd_data;
            end
        end
    end
    
    // ========================================================================
    // Destination Range Check
    // ========================================================================
    
    logic dst_in_range;
    assign dst_in_range = (cr_dst <= MAX_CLIST_REG);
    
    // ========================================================================
    // Fault Latching (for local range check fault)
    // ========================================================================
    
    logic        fault_latched;
    fault_type_t fault_type_latched;
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            fault_latched <= 1'b0;
            fault_type_latched <= FAULT_NONE;
        end else if (state == SAVE_IDLE) begin
            fault_latched <= 1'b0;
            fault_type_latched <= FAULT_NONE;
        end else if (state == SAVE_CHECK_DST_READ && !dst_in_range) begin
            fault_latched <= 1'b1;
            fault_type_latched <= FAULT_INVALID_OP;
        end else if (state == SAVE_CALL_SUB && sub_fault_latched) begin
            fault_latched <= 1'b1;
            fault_type_latched <= sub_fault_type;
        end
    end
    
    // ========================================================================
    // mSave Subroutine Instance
    // ========================================================================
    
    logic        sub_start;
    logic        sub_start_reg;      // Registered pulse - one cycle only
    logic        sub_busy;
    logic        sub_done;
    logic        sub_fault;
    logic        sub_done_latched;   // Sticky latch for completion
    logic        sub_fault_latched;  // Sticky latch for fault
    fault_type_t sub_fault_type;
    
    // Generate single-cycle pulse on entry to SAVE_CALL_SUB
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n)
            sub_start_reg <= 1'b0;
        else if (state == SAVE_LATCH_SRC && next_state == SAVE_CALL_SUB)
            sub_start_reg <= 1'b1;  // Set on transition to CALL_SUB
        else
            sub_start_reg <= 1'b0;  // Clear after one cycle
    end
    
    // Sticky latch for sub_done/sub_fault to avoid missing single-cycle signals
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            sub_done_latched <= 1'b0;
            sub_fault_latched <= 1'b0;
        end else if (state == SAVE_IDLE) begin
            sub_done_latched <= 1'b0;
            sub_fault_latched <= 1'b0;
        end else begin
            if (sub_done) sub_done_latched <= 1'b1;
            if (sub_fault) sub_fault_latched <= 1'b1;
        end
    end
    
    assign sub_start = sub_start_reg;
    
    ctmm_msave u_msave (
        .clk             (clk),
        .rst_n           (rst_n),
        .sub_start       (sub_start),
        .sub_dst_cap     (dst_reg_latched),
        .sub_src_gt      (src_reg_latched.word0_gt),
        .sub_index       (index),
        .sub_busy        (sub_busy),
        .sub_done        (sub_done),
        .sub_fault       (sub_fault),
        .sub_fault_type  (sub_fault_type),
        .cr15_namespace  (cr15_namespace),
        .mem_wr_addr     (mem_wr_addr),
        .mem_wr_data     (mem_wr_data),
        .mem_wr_en       (mem_wr_en),
        .mem_wr_done     (mem_wr_done),
        .mem_rd_addr     (mem_rd_addr),
        .mem_rd_en       (mem_rd_en),
        .mem_rd_data     (mem_rd_data),
        .mem_rd_valid    (mem_rd_valid)
    );
    
    // ========================================================================
    // State Register
    // ========================================================================
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            state <= SAVE_IDLE;
        end else begin
            state <= next_state;
        end
    end
    
    // ========================================================================
    // Next State Logic
    // ========================================================================
    
    always_comb begin
        next_state = state;
        
        case (state)
            SAVE_IDLE: begin
                if (save_start)
                    next_state = SAVE_CHECK_DST_READ;
            end
            
            SAVE_CHECK_DST_READ: begin
                if (!dst_in_range)
                    next_state = SAVE_IDLE;  // Fault
                else
                    next_state = SAVE_LATCH_DST;
            end
            
            SAVE_LATCH_DST: begin
                next_state = SAVE_LATCH_SRC;
            end
            
            SAVE_LATCH_SRC: begin
                next_state = SAVE_CALL_SUB;
            end
            
            SAVE_CALL_SUB: begin
                if (sub_fault_latched)
                    next_state = SAVE_IDLE;  // Fault from mSave
                else if (sub_done_latched)
                    next_state = SAVE_RESET_G;  // Success → reset G-bit
            end
            
            SAVE_RESET_G: begin
                next_state = SAVE_IDLE;
            end
            
            default: next_state = SAVE_IDLE;
        endcase
    end
    
    // ========================================================================
    // Register Read Control
    // ========================================================================
    
    always_comb begin
        cr_rd_addr = 4'd0;
        
        case (state)
            SAVE_IDLE: begin
                if (save_start)
                    cr_rd_addr = cr_dst;  // Start reading destination
            end
            SAVE_CHECK_DST_READ: begin
                cr_rd_addr = cr_dst;  // Continue reading destination
            end
            SAVE_LATCH_DST: begin
                cr_rd_addr = cr_src;  // Initiate source read
            end
            SAVE_LATCH_SRC: begin
                cr_rd_addr = cr_src;  // Continue reading source
            end
            default: cr_rd_addr = 4'd0;
        endcase
    end
    
    // ========================================================================
    // G-bit Reset Interface
    // ========================================================================
    // After a successful mSave, reset the G-bit on the namespace entry
    // that the destination C-List GT points to. This signals the garbage
    // collector that this namespace entry is actively referenced.
    //
    // Address calculation: CR15.Location + dst_GT.offset + 16
    //   - CR15.Location = base of namespace table
    //   - dst_GT.offset = direct byte offset into namespace
    //   - +16 = offset to Word 3 (Seals) where G-bit resides
    // ========================================================================
    
    // ========================================================================
    // Output Signals
    // ========================================================================
    assign save_busy = (state != SAVE_IDLE);
    assign save_complete = (state == SAVE_RESET_G);
    assign save_fault = fault_latched;
    assign fault_type = fault_type_latched;

endmodule
