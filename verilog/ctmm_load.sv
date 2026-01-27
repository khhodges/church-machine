// ============================================================================
// CTMM LOAD Church-Instruction (CLOOMC)
// ============================================================================
// This module implements the LOAD instruction by:
//   1. Invoking the shared mLoad micro-routine with source, destination, and index
//   2. mLoad writes directly to the destination register (single bus transfer)
//
// The actual capability fetching is done by ctmm_mload.sv
// This reduces the Trusted Computing Base - all Church CLOOMC instructions
// share the same verified mLoad micro-routine for capability fetching.
// ============================================================================

module ctmm_load
    import ctmm_pkg::*;
(
    input  logic        clk,
    input  logic        rst_n,
    
    // Control interface
    input  logic        load_start,           // Start LOAD execution
    input  logic [3:0]  cr_src,               // Source register (CRn)
    input  logic [3:0]  cr_dst,               // Destination register (CRd)
    input  logic [7:0]  index,                // C-List index
    output logic        load_busy,            // LOAD in progress
    output logic        load_complete,        // LOAD finished successfully
    output logic        load_fault,           // LOAD caused a fault
    output fault_type_t fault_type,           // Type of fault
    
    // Capability register read interface (directly from subroutine)
    output logic [3:0]  cr_rd_addr,           // Register to read
    input  capability_reg_t cr_rd_data,       // Full 256-bit register data
    
    // Capability register write interface (directly from subroutine)
    output logic [3:0]  cr_wr_addr,           // Register to write
    output capability_reg_t cr_wr_data,       // Full 256-bit data to write
    output logic        cr_wr_en,             // Write enable
    
    // CR15 (Namespace) interface
    input  capability_reg_t cr15_namespace,   // CR15 Namespace register
    
    // Memory interface
    output logic [63:0] mem_addr,             // Memory address
    output logic        mem_rd_en,            // Read enable
    input  logic [63:0] mem_rd_data,          // Read data
    input  logic        mem_rd_valid,         // Read data valid
    
    // Thread update interface - writes GT (G=0) to Thread[CRd]
    output logic        thread_wr_en,         // Write enable for Thread[CRd]
    output logic [3:0]  thread_wr_idx,        // Index into Thread (= CRd)
    output logic [63:0] thread_wr_data,       // GT with G=0
    
    // G bit reset interface
    output logic        g_bit_reset,
    output logic [63:0] g_bit_addr
);

    // ========================================================================
    // State Machine - LOAD instruction wrapper (simplified)
    // ========================================================================
    // No longer needs WRITE_DST state - subroutine writes directly
    
    typedef enum logic [1:0] {
        LOAD_IDLE,
        LOAD_START_SUB,
        LOAD_WAIT_ACK,
        LOAD_CALL_SUB
    } load_wrapper_state_t;
    
    load_wrapper_state_t state, next_state;
    
    // ========================================================================
    // LOAD Subroutine Instance
    // ========================================================================
    
    logic        sub_start;
    logic        sub_busy;
    logic        sub_done;
    logic        sub_fault;
    fault_type_t sub_fault_type;
    
    ctmm_mload u_mload (
        .clk            (clk),
        .rst_n          (rst_n),
        
        // Subroutine interface - pass destination directly
        .sub_start      (sub_start),
        .sub_cr_src     (cr_src),
        .sub_cr_dst     (cr_dst),        // Destination passed to subroutine
        .sub_index      (index),
        .sub_busy       (sub_busy),
        .sub_done       (sub_done),
        .sub_fault      (sub_fault),
        .sub_fault_type (sub_fault_type),
        
        // Register read interface
        .cr_rd_addr     (cr_rd_addr),
        .cr_rd_data     (cr_rd_data),
        
        // Register write interface - subroutine writes directly
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
        
        // Thread update - writes GT to Thread[CRd]
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
            state <= LOAD_IDLE;
        end else begin
            state <= next_state;
        end
    end
    
    // ========================================================================
    // Next State Logic - Proper Start/Ack Handshake
    // ========================================================================
    
    always_comb begin
        next_state = state;
        sub_start = 1'b0;
        
        case (state)
            LOAD_IDLE: begin
                if (load_start)
                    next_state = LOAD_START_SUB;
            end
            
            LOAD_START_SUB: begin
                sub_start = 1'b1;
                next_state = LOAD_WAIT_ACK;
            end
            
            LOAD_WAIT_ACK: begin
                sub_start = 1'b1;
                if (sub_busy)
                    next_state = LOAD_CALL_SUB;
            end
            
            LOAD_CALL_SUB: begin
                // Wait for subroutine to complete
                // Subroutine writes directly to CRd on sub_done
                if (sub_done || sub_fault)
                    next_state = LOAD_IDLE;
            end
            
            default: next_state = LOAD_IDLE;
        endcase
    end
    
    // ========================================================================
    // Output Signals
    // ========================================================================
    
    assign load_busy = (state != LOAD_IDLE);
    assign load_complete = (state == LOAD_CALL_SUB) && sub_done;
    assign load_fault = (state == LOAD_CALL_SUB) && sub_fault;
    assign fault_type = sub_fault_type;

endmodule
