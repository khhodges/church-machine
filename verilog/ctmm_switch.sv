// ============================================================================
// CTMM SWITCH Church-Instruction (CLOOMC)
// ============================================================================
// This module implements the SWITCH instruction which loads a capability
// into system registers CR8-CR15 based on a 3-bit target field.
//
// Target field mapping (3 bits):
//   000 = CR8  (Thread)         - CHANGE is alias for SWITCH target=0
//   001 = CR9  (Interrupt Thread)
//   010 = CR10 (Double Fault Recovery)
//   011 = CR11 (future/virtual namespace)
//   100 = CR12 (future/virtual namespace)
//   101 = CR13 (future/virtual namespace)
//   110 = CR14 (future/virtual namespace)
//   111 = CR15 (Namespace root)
//
// SWITCH Steps:
//   1. Verify source CRs is in range 0-7
//   2. Verify source CRs has L (Load) permission
//   3. Call mLoad with sub_cr_dst = CR8 + target
//
// The actual capability fetching is done by ctmm_mload.sv
// This reduces the Trusted Computing Base - all Church CLOOMC instructions
// share the same verified mLoad micro-routine for capability fetching.
//
// FAULT conditions:
//   - Source CRs lacks L permission
//   - mLoad faults (bounds, MAC, etc.)
// ============================================================================

module ctmm_switch
    import ctmm_pkg::*;
(
    input  logic        clk,
    input  logic        rst_n,
    
    // Control interface
    input  logic        switch_start,         // Start SWITCH execution
    input  logic [2:0]  cr_src,               // Source register (CRn) - CR0-CR7 (3-bit)
    input  logic [2:0]  target,               // Target system register: 0=CR8, 7=CR15
    input  logic [9:0]  index,                // C-List index (10-bit, 0-1023)
    output logic        switch_busy,          // SWITCH in progress
    output logic        switch_complete,      // SWITCH finished successfully
    output logic        switch_fault,         // SWITCH caused a fault
    output fault_type_t fault_type,           // Type of fault
    
    // Capability register read interface (directly from subroutine)
    output logic [3:0]  cr_rd_addr,           // Register to read
    input  capability_reg_t cr_rd_data,       // Full 256-bit register data
    
    // Capability register write interface (directly from subroutine)
    output logic [3:0]  cr_wr_addr,           // Register to write (always CR15)
    output capability_reg_t cr_wr_data,       // Full 256-bit data to write
    output logic        cr_wr_en,             // Write enable
    
    // CR15 (Namespace) interface
    input  capability_reg_t cr15_namespace,   // CR15 Namespace register
    
    // Memory interface
    output logic [31:0] mem_addr,             // Memory address
    output logic        mem_rd_en,            // Read enable
    input  logic [31:0] mem_rd_data,          // Read data
    input  logic        mem_rd_valid,         // Read data valid
    
    // Thread update interface - writes GT (G=0) to Thread[CR15]
    output logic        thread_wr_en,         // Write enable for Thread[CR15]
    output logic [3:0]  thread_wr_idx,        // Index into Thread (= CR15 = 4'd15)
    output logic [31:0] thread_wr_data,       // GT (word0 = golden_token_t)
    
    // B-flag reset interface (clears b_flag in clist entry after SWITCH)
    output logic        g_bit_reset,
    output logic [31:0] g_bit_addr
);

    // ========================================================================
    // Constants
    // ========================================================================
    
    localparam logic [3:0] CR8_BASE = 4'd8;          // Base for target calculation
    localparam logic [3:0] MAX_CLIST_REG = 4'd7;    // Maximum allowed source register (CR0-CR7)
    
    // Calculate destination register from target field: CR8 + target
    logic [3:0] dest_cr;
    assign dest_cr = CR8_BASE + {1'b0, target};     // 4'd8 + target (0-7) = CR8-CR15
    
    // ========================================================================
    // State Machine - SWITCH instruction wrapper
    // ========================================================================
    
    typedef enum logic [2:0] {
        SWITCH_IDLE,
        SWITCH_CHECK_SRC,     // Verify source is CR0-CR6
        SWITCH_READ_SRC,      // Read source register for permission check
        SWITCH_CHECK_PERM,    // Verify L permission on source
        SWITCH_START_SUB,     // Start mLoad subroutine
        SWITCH_WAIT_ACK,      // Wait for subroutine to acknowledge
        SWITCH_CALL_SUB       // Wait for subroutine to complete
    } switch_state_t;
    
    switch_state_t state, next_state;
    
    // ========================================================================
    // Local Register Read Control
    // ========================================================================
    // SWITCH needs to read source CR before permission check.
    // When in CHECK_SRC/READ_SRC states, we drive cr_rd_addr locally.
    // After starting mLoad, the subroutine takes control.
    // ========================================================================
    
    logic        local_cr_rd_en;
    logic [3:0]  local_cr_rd_addr;
    logic [3:0]  sub_cr_rd_addr;
    
    assign local_cr_rd_en = (state == SWITCH_CHECK_SRC) || (state == SWITCH_READ_SRC);
    assign local_cr_rd_addr = cr_src;
    
    // ========================================================================
    // Permission Check Logic
    // ========================================================================
    
    logic src_in_range;
    logic src_has_l_perm;
    logic [5:0] src_perms;
    
    // Latched source register data for permission check
    capability_reg_t src_reg_latched;
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            src_reg_latched <= '0;
        end else if (state == SWITCH_READ_SRC) begin
            src_reg_latched <= cr_rd_data;
        end
    end
    
    assign src_in_range = (cr_src <= MAX_CLIST_REG);
    assign src_perms = src_reg_latched.word0_gt.perms;
    assign src_has_l_perm = src_perms[PERM_L];
    
    // ========================================================================
    // Fault Latching
    // ========================================================================
    // Latch fault status to ensure switch_fault is reliably asserted
    // ========================================================================
    
    logic        fault_latched;
    fault_type_t fault_type_latched;
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            fault_latched <= 1'b0;
            fault_type_latched <= FAULT_NONE;
        end else if (state == SWITCH_IDLE) begin
            fault_latched <= 1'b0;
            fault_type_latched <= FAULT_NONE;
        end else if (state == SWITCH_CHECK_SRC && !src_in_range) begin
            fault_latched <= 1'b1;
            fault_type_latched <= FAULT_INVALID_OP;
        end else if (state == SWITCH_CHECK_PERM && !src_has_l_perm) begin
            fault_latched <= 1'b1;
            fault_type_latched <= FAULT_PERM_L;
        end else if (state == SWITCH_CALL_SUB && sub_fault) begin
            fault_latched <= 1'b1;
            fault_type_latched <= sub_fault_type;
        end
    end
    
    // ========================================================================
    // mLoad Subroutine Instance
    // ========================================================================
    
    logic        sub_start;
    logic        sub_busy;
    logic        sub_done;
    logic        sub_fault;
    fault_type_t sub_fault_type;
    
    // Mux register read address between local control and subroutine
    assign cr_rd_addr = local_cr_rd_en ? local_cr_rd_addr : sub_cr_rd_addr;
    
    ctmm_mload u_mload (
        .clk            (clk),
        .rst_n          (rst_n),
        
        // Subroutine interface - destination from target field
        .sub_start      (sub_start),
        .sub_cr_src     ({1'b0, cr_src}),    // Pad 3-bit to 4-bit for mLoad
        .sub_cr_dst     (dest_cr),           // CR8 + target (0-7) = CR8-CR15
        .sub_index      (index),             // Full 10-bit index (0-1023)
        .sub_direct     (1'b0),              // SWITCH uses C-List fetch mode
        .sub_direct_gt  ('0),
        .sub_busy       (sub_busy),
        .sub_done       (sub_done),
        .sub_fault      (sub_fault),
        .sub_fault_type (sub_fault_type),
        
        // Register read interface - mLoad drives via sub_cr_rd_addr
        .cr_rd_addr     (sub_cr_rd_addr),
        .cr_rd_data     (cr_rd_data),
        
        // Register write interface - subroutine writes directly to dest_cr
        .cr_wr_addr     (cr_wr_addr),
        .cr_wr_data     (cr_wr_data),
        .cr_wr_en       (cr_wr_en),
        
        // Namespace interface
        .cr15_namespace (cr15_namespace),
        
        // Memory interface
        .mem_addr       (mem_addr),
        .mem_rd_en      (mem_rd_en),
        .mem_rd_data    (mem_rd_data),
        .mem_rd_valid   (mem_rd_valid),
        
        // Thread update - writes GT to Thread[CR15]
        .thread_wr_en   (thread_wr_en),
        .thread_wr_idx  (thread_wr_idx),
        .thread_wr_data (thread_wr_data),
        
        // G bit reset
        .g_bit_reset    (g_bit_reset),
        .g_bit_addr     (g_bit_addr)
    );
    
    // ========================================================================
    // State Register
    // ========================================================================
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            state <= SWITCH_IDLE;
        end else begin
            state <= next_state;
        end
    end
    
    // ========================================================================
    // Next State Logic
    // ========================================================================
    
    always_comb begin
        next_state = state;
        sub_start = 1'b0;
        
        case (state)
            SWITCH_IDLE: begin
                if (switch_start)
                    next_state = SWITCH_CHECK_SRC;
            end
            
            SWITCH_CHECK_SRC: begin
                // Step 1: Verify source is CR0-CR6 (not reserved registers)
                // Also initiates register read for permission check
                if (!src_in_range)
                    next_state = SWITCH_IDLE;  // Fault - source out of range
                else
                    next_state = SWITCH_READ_SRC;
            end
            
            SWITCH_READ_SRC: begin
                // Step 2: Wait one cycle for register read to complete
                // Data is latched in src_reg_latched
                next_state = SWITCH_CHECK_PERM;
            end
            
            SWITCH_CHECK_PERM: begin
                // Step 3: Verify source has L permission (using latched data)
                if (!src_has_l_perm)
                    next_state = SWITCH_IDLE;  // Fault - no L permission
                else
                    next_state = SWITCH_START_SUB;
            end
            
            SWITCH_START_SUB: begin
                sub_start = 1'b1;
                next_state = SWITCH_WAIT_ACK;
            end
            
            SWITCH_WAIT_ACK: begin
                sub_start = 1'b1;
                if (sub_busy)
                    next_state = SWITCH_CALL_SUB;
            end
            
            SWITCH_CALL_SUB: begin
                // Wait for subroutine to complete
                // Subroutine writes directly to CR15 on sub_done
                if (sub_done || sub_fault)
                    next_state = SWITCH_IDLE;
            end
            
            default: next_state = SWITCH_IDLE;
        endcase
    end
    
    // ========================================================================
    // Output Signals
    // ========================================================================
    
    assign switch_busy = (state != SWITCH_IDLE);
    assign switch_complete = (state == SWITCH_CALL_SUB) && sub_done;
    assign switch_fault = fault_latched;
    assign fault_type = fault_type_latched;

endmodule
