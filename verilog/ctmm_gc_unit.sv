// ============================================================================
// CTMM Garbage Collection Unit - Deterministic GC with G Bit
// ============================================================================
// PP250 Design: Mark-Scan-Sweep.
//   Mark:  Sets G=1 on all namespace entries.
//   Scan:  Relies on mLoad (in the LOAD/CALL paths) resetting G=0 on every
//          valid access. No explicit scan state needed in hardware — the
//          normal execution path between Mark and Sweep IS the scan phase.
//   Sweep: Identifies entries still with G=1 as garbage.
// TODO: Sweep currently only counts garbage entries. To fully reclaim,
//       add a GC_SWEEP_WRITE state to bump version and clear G on garbage.
// ============================================================================

module ctmm_gc_unit
    import ctmm_pkg::*;
(
    input  logic        clk,
    input  logic        rst_n,
    
    // Control
    input  logic        gc_start,         // Start GC cycle
    input  logic        gc_mark_en,       // Enable mark phase
    input  logic        gc_sweep_en,      // Enable sweep phase
    output logic        gc_busy,          // GC in progress
    output logic        gc_done,          // GC cycle complete
    
    // Namespace memory interface (for marking)
    output logic [31:0] ns_addr,          // Address to mark
    output logic        ns_rd_en,         // Read enable
    input  golden_token_t ns_rd_data,     // Current GT at address
    output golden_token_t ns_wr_data,     // GT with G bit set
    output logic        ns_wr_en,         // Write enable
    
    // Configuration
    input  logic [31:0] ns_start_addr,    // Start of namespace
    input  logic [31:0] ns_end_addr,      // End of namespace
    
    // Results
    output logic [31:0] marked_count,     // Number of entries marked
    output logic [31:0] garbage_count,    // Number of garbage entries found
    
    // G bit reset interface (from LOAD operations)
    input  logic [31:0] access_addr,      // Address being accessed
    input  logic        valid_key_access, // Valid key touched this entry
    input  logic        is_namespace_access, // Access is to namespace entry
    output logic        g_bit_reset       // G bit was reset
);

    // ========================================================================
    // State Machine
    // ========================================================================
    
    typedef enum logic [2:0] {
        GC_IDLE,
        GC_MARK_READ,
        GC_MARK_WRITE,
        GC_SWEEP_READ,
        GC_SWEEP_CHECK,
        GC_COMPLETE
    } gc_state_t;
    
    gc_state_t state, next_state;
    
    logic [31:0] current_addr;
    logic [31:0] mark_counter;
    logic [31:0] garbage_counter;
    
    // ========================================================================
    // State Register
    // ========================================================================
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            state <= GC_IDLE;
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
            GC_IDLE: begin
                if (gc_start && gc_mark_en)
                    next_state = GC_MARK_READ;
                else if (gc_start && gc_sweep_en)
                    next_state = GC_SWEEP_READ;
            end
            
            GC_MARK_READ: begin
                next_state = GC_MARK_WRITE;
            end
            
            GC_MARK_WRITE: begin
                if (current_addr >= ns_end_addr) begin
                    if (gc_sweep_en)
                        next_state = GC_SWEEP_READ;
                    else
                        next_state = GC_COMPLETE;
                end else begin
                    next_state = GC_MARK_READ;
                end
            end
            
            GC_SWEEP_READ: begin
                next_state = GC_SWEEP_CHECK;
            end
            
            GC_SWEEP_CHECK: begin
                if (current_addr >= ns_end_addr)
                    next_state = GC_COMPLETE;
                else
                    next_state = GC_SWEEP_READ;
            end
            
            GC_COMPLETE: begin
                next_state = GC_IDLE;
            end
            
            default: next_state = GC_IDLE;
        endcase
    end
    
    // ========================================================================
    // Address Counter
    // ========================================================================
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            current_addr <= 32'h0;
        end else if (state == GC_IDLE && gc_start) begin
            current_addr <= ns_start_addr;
        end else if (state == GC_MARK_WRITE || state == GC_SWEEP_CHECK) begin
            current_addr <= current_addr + 32'h1;
        end
    end
    
    // ========================================================================
    // Mark Counter
    // ========================================================================
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            mark_counter <= 32'h0;
        end else if (state == GC_IDLE && gc_start) begin
            mark_counter <= 32'h0;
        end else if (state == GC_MARK_WRITE && !ns_rd_data.b_flag) begin
            mark_counter <= mark_counter + 32'h1;
        end
    end
    
    assign marked_count = mark_counter;
    
    // ========================================================================
    // Garbage Counter
    // ========================================================================
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            garbage_counter <= 32'h0;
        end else if (state == GC_IDLE && gc_start) begin
            garbage_counter <= 32'h0;
        end else if (state == GC_SWEEP_CHECK && ns_rd_data.b_flag) begin
            garbage_counter <= garbage_counter + 32'h1;
        end
    end
    
    assign garbage_count = garbage_counter;
    
    // ========================================================================
    // Namespace Memory Interface
    // ========================================================================
    
    assign ns_addr = current_addr;
    assign ns_rd_en = (state == GC_MARK_READ) || (state == GC_SWEEP_READ);
    
    always_comb begin
        ns_wr_data = ns_rd_data;
        ns_wr_data.b_flag = 1'b1;
    end
    
    assign ns_wr_en = (state == GC_MARK_WRITE);
    
    // ========================================================================
    // Status Outputs
    // ========================================================================
    
    assign gc_busy = (state != GC_IDLE) && (state != GC_COMPLETE);
    assign gc_done = (state == GC_COMPLETE);
    
    // ========================================================================
    // G Bit Reset Logic (from LOAD operations)
    // ========================================================================
    // When a valid key accesses a namespace entry, reset G bit
    // This is the mechanism by which reachable entries are marked
    
    assign g_bit_reset = valid_key_access && is_namespace_access;

endmodule
