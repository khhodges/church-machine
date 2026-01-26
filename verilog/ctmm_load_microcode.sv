// ============================================================================
// CTMM LOAD Instruction Microcode Sequencer
// ============================================================================
// Implements the LOAD instruction:
//   LOAD CRd, [CRn + Index]
//
// Microcode Sequence:
//   Step 1: Fetch source CR (CRn) - read all 4 words
//   Step 2: Check L permission on CRn.Word0 (Golden Token)
//   Step 3: Calculate memory address: CRn.Location + (Index * 32 bytes)
//   Step 4: Check bounds: Index < CRn.Limit
//   Step 5: Fetch Word 0 (GT) from C-List memory
//   Step 6: Fetch Word 1 (Location) from C-List memory
//   Step 7: Fetch Word 2 (Limit) from C-List memory  
//   Step 8: Fetch Word 3 (Seals) from C-List memory
//   Step 9: Validate MAC (calculated hash vs Seals)
//   Step 10: Reset G bit if namespace access (M or L permission set)
//   Step 11: Write all 4 words to destination CRd
//   Step 12: Advance NIA, instruction complete
//
// Each step takes 1 clock cycle (synchronous memory assumed)
// ============================================================================

module ctmm_load_microcode
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
    
    // Capability register read interface
    output logic [3:0]  cr_rd_addr,           // Register to read
    input  capability_reg_t cr_rd_data,       // Full 256-bit register data
    
    // Capability register write interface
    output logic [3:0]  cr_wr_addr,           // Register to write
    output capability_reg_t cr_wr_data,       // Full 256-bit data to write
    output logic        cr_wr_en,             // Write enable
    
    // Memory interface (for fetching from C-List)
    output logic [63:0] mem_addr,             // Memory address
    output logic        mem_rd_en,            // Read enable
    input  logic [63:0] mem_rd_data,          // Read data (one 64-bit word)
    input  logic        mem_rd_valid,         // Read data valid
    
    // G bit reset interface
    output logic        g_bit_reset,          // Signal to reset G bit in namespace
    output logic [31:0] g_bit_ns_offset       // Namespace offset for G bit reset
);

    // ========================================================================
    // State Machine
    // ========================================================================
    
    load_state_t state, next_state;
    
    // Latched instruction operands
    logic [3:0]  cr_src_reg;
    logic [3:0]  cr_dst_reg;
    logic [7:0]  index_reg;
    
    // Latched source capability register (CRn)
    capability_reg_t src_cap;
    
    // Fetched destination capability (from C-List memory)
    capability_reg_t fetched_cap;
    
    // Calculated address for C-List access
    logic [63:0] clist_base_addr;
    logic [63:0] entry_addr;
    
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
    // Operand Latching
    // ========================================================================
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            cr_src_reg <= 4'd0;
            cr_dst_reg <= 4'd0;
            index_reg <= 8'd0;
        end else if (state == LOAD_IDLE && load_start) begin
            cr_src_reg <= cr_src;
            cr_dst_reg <= cr_dst;
            index_reg <= index;
        end
    end
    
    // ========================================================================
    // Source Capability Latching (Step 1)
    // ========================================================================
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            src_cap <= CR_NULL;
        end else if (state == LOAD_FETCH_SRC) begin
            src_cap <= cr_rd_data;
        end
    end
    
    // ========================================================================
    // Address Calculation (Step 3)
    // ========================================================================
    
    // C-List base address from CRn.Word1 (Location)
    assign clist_base_addr = src_cap.word1_location;
    
    // Entry address = Base + (Index * 32 bytes per capability)
    // Each capability is 4 x 64-bit = 32 bytes
    assign entry_addr = clist_base_addr + ({56'h0, index_reg} << 5);
    
    // ========================================================================
    // Memory Fetch State Machine
    // ========================================================================
    
    logic [1:0] word_counter;  // Which word we're fetching (0-3)
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            word_counter <= 2'd0;
            fetched_cap <= CR_NULL;
        end else begin
            case (state)
                LOAD_CALC_ADDR: begin
                    word_counter <= 2'd0;
                    fetched_cap <= CR_NULL;
                end
                
                LOAD_FETCH_W0: begin
                    if (mem_rd_valid) begin
                        fetched_cap.word0_gt <= mem_rd_data;
                        word_counter <= 2'd1;
                    end
                end
                
                LOAD_FETCH_W1: begin
                    if (mem_rd_valid) begin
                        fetched_cap.word1_location <= mem_rd_data;
                        word_counter <= 2'd2;
                    end
                end
                
                LOAD_FETCH_W2: begin
                    if (mem_rd_valid) begin
                        fetched_cap.word2_limit <= mem_rd_data;
                        word_counter <= 2'd3;
                    end
                end
                
                LOAD_FETCH_W3: begin
                    if (mem_rd_valid) begin
                        fetched_cap.word3_seals <= mem_rd_data;
                    end
                end
                
                default: begin
                    // Hold values
                end
            endcase
        end
    end
    
    // ========================================================================
    // Permission and Bounds Checking
    // ========================================================================
    
    // Check L or M permission on source capability (required to load GT into CRd)
    logic has_l_permission;
    logic has_m_permission;
    logic has_load_permission;
    assign has_l_permission = src_cap.word0_gt.perms[PERM_L];
    assign has_m_permission = src_cap.word0_gt.perms[PERM_M];
    assign has_load_permission = has_l_permission || has_m_permission;
    
    // Check bounds: Index must be less than Limit
    logic bounds_ok;
    assign bounds_ok = ({56'h0, index_reg} < src_cap.word2_limit);
    
    // Check if source is null capability
    logic src_is_null;
    assign src_is_null = (src_cap.word0_gt == GT_NULL);
    
    // Check if this is a namespace access (for G bit reset)
    logic is_namespace_access;
    assign is_namespace_access = fetched_cap.word0_gt.perms[PERM_M] || 
                                  fetched_cap.word0_gt.perms[PERM_L];
    
    // Check G bit on fetched capability
    logic fetched_has_g_bit;
    assign fetched_has_g_bit = fetched_cap.word0_gt.perms[PERM_G];
    
    // ========================================================================
    // MAC Validation (simplified - would compute hash in real implementation)
    // ========================================================================
    
    logic [63:0] calculated_mac;
    logic mac_valid;
    
    // Simplified MAC: XOR of first 3 words (real impl would use SHA/HMAC)
    assign calculated_mac = fetched_cap.word0_gt ^ 
                            fetched_cap.word1_location ^ 
                            fetched_cap.word2_limit;
    
    // For now, accept any MAC (real impl would compare against word3_seals)
    assign mac_valid = 1'b1;  // TODO: implement full MAC validation
    
    // ========================================================================
    // Next State Logic
    // ========================================================================
    
    always_comb begin
        next_state = state;
        
        case (state)
            LOAD_IDLE: begin
                if (load_start)
                    next_state = LOAD_FETCH_SRC;
            end
            
            LOAD_FETCH_SRC: begin
                // Source register read takes 1 cycle (synchronous)
                next_state = LOAD_CHECK_L;
            end
            
            LOAD_CHECK_L: begin
                if (src_is_null)
                    next_state = LOAD_FAULT;  // Null capability fault
                else if (!has_load_permission)
                    next_state = LOAD_FAULT;  // L or M permission required
                else
                    next_state = LOAD_CALC_ADDR;
            end
            
            LOAD_CALC_ADDR: begin
                next_state = LOAD_CHECK_BOUNDS;
            end
            
            LOAD_CHECK_BOUNDS: begin
                if (!bounds_ok)
                    next_state = LOAD_FAULT;  // Bounds check failed
                else
                    next_state = LOAD_FETCH_W0;
            end
            
            LOAD_FETCH_W0: begin
                if (mem_rd_valid)
                    next_state = LOAD_FETCH_W1;
            end
            
            LOAD_FETCH_W1: begin
                if (mem_rd_valid)
                    next_state = LOAD_FETCH_W2;
            end
            
            LOAD_FETCH_W2: begin
                if (mem_rd_valid)
                    next_state = LOAD_FETCH_W3;
            end
            
            LOAD_FETCH_W3: begin
                if (mem_rd_valid)
                    next_state = LOAD_CHECK_MAC;
            end
            
            LOAD_CHECK_MAC: begin
                if (!mac_valid)
                    next_state = LOAD_FAULT;  // MAC validation failed
                else if (is_namespace_access && fetched_has_g_bit)
                    next_state = LOAD_RESET_G;
                else
                    next_state = LOAD_WRITE_DST;
            end
            
            LOAD_RESET_G: begin
                next_state = LOAD_WRITE_DST;
            end
            
            LOAD_WRITE_DST: begin
                next_state = LOAD_COMPLETE;
            end
            
            LOAD_COMPLETE: begin
                next_state = LOAD_IDLE;
            end
            
            LOAD_FAULT: begin
                next_state = LOAD_IDLE;
            end
            
            default: next_state = LOAD_IDLE;
        endcase
    end
    
    // ========================================================================
    // Fault Type Determination
    // ========================================================================
    
    fault_type_t fault_type_reg;
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            fault_type_reg <= FAULT_NONE;
        end else begin
            case (state)
                LOAD_CHECK_L: begin
                    if (src_is_null)
                        fault_type_reg <= FAULT_NULL_CAP;
                    else if (!has_load_permission)
                        fault_type_reg <= FAULT_PERM_L;  // L or M permission required
                end
                
                LOAD_CHECK_BOUNDS: begin
                    if (!bounds_ok)
                        fault_type_reg <= FAULT_BOUNDS;
                end
                
                LOAD_CHECK_MAC: begin
                    if (!mac_valid)
                        fault_type_reg <= FAULT_MAC;
                end
                
                LOAD_IDLE: begin
                    fault_type_reg <= FAULT_NONE;
                end
                
                default: begin
                    // Hold current fault type
                end
            endcase
        end
    end
    
    assign fault_type = fault_type_reg;
    
    // ========================================================================
    // Output Signals
    // ========================================================================
    
    // Status outputs
    assign load_busy = (state != LOAD_IDLE);
    assign load_complete = (state == LOAD_COMPLETE);
    assign load_fault = (state == LOAD_FAULT);
    
    // Register read address (for Step 1: fetch source CR)
    assign cr_rd_addr = (state == LOAD_FETCH_SRC) ? cr_src_reg : 4'd0;
    
    // Register write (Step 11: write to destination CR)
    assign cr_wr_addr = cr_dst_reg;
    
    // Write data with G bit cleared if needed
    always_comb begin
        cr_wr_data = fetched_cap;
        // If we went through RESET_G state, clear the G bit
        if (is_namespace_access) begin
            cr_wr_data.word0_gt.perms[PERM_G] = 1'b0;
        end
    end
    
    assign cr_wr_en = (state == LOAD_WRITE_DST);
    
    // Memory interface
    // Address is entry_addr + (word_counter * 8 bytes)
    assign mem_addr = entry_addr + ({62'h0, word_counter} << 3);
    
    assign mem_rd_en = (state == LOAD_FETCH_W0) ||
                       (state == LOAD_FETCH_W1) ||
                       (state == LOAD_FETCH_W2) ||
                       (state == LOAD_FETCH_W3);
    
    // G bit reset output
    assign g_bit_reset = (state == LOAD_RESET_G);
    assign g_bit_ns_offset = fetched_cap.word0_gt.offset;

endmodule
