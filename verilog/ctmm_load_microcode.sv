// ============================================================================
// CTMM LOAD Instruction Microcode Sequencer
// ============================================================================
// Implements the LOAD instruction:
//   LOAD CRd, [CRn + Index]
//
// Microcode Sequence:
//   Step 1: Check CRn has M or L permission
//   Step 2: Check bounds: Index < CRn.Limit  
//   Step 3: Fetch GT from CRn[Index] → CRd.W0
//   Step 4: Check GT.offset < CR15.limit AND CR15 = M
//   Step 5: Fetch Word 1 (Location) from Namespace at GT.Offset
//   Step 6: Fetch Word 2 (Limit) from Namespace
//   Step 7: Fetch Word 3 (Seals) from Namespace
//   Step 8: Validate MAC (calculated hash vs Seals)
//   Step 9: Reset G bit in CR15[GT.offset].Word3.Gbit
//   Step 10: Write all 4 words to destination CRd
//   Step 11: Advance NIA, instruction complete
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
    
    // CR15 (Namespace) interface - for fetching W1, W2, W3
    input  capability_reg_t cr15_namespace,   // CR15 Namespace register
    
    // Namespace memory interface (for fetching from Namespace table)
    output logic [63:0] ns_addr,              // Namespace memory address
    output logic        ns_rd_en,             // Read enable
    input  logic [63:0] ns_rd_data,           // Read data (one 64-bit word)
    input  logic        ns_rd_valid,          // Read data valid
    
    // G bit reset interface - resets G bit in CR15[GT.offset].Word3.Gbit
    output logic        g_bit_reset,          // Signal to reset G bit in namespace
    output logic [63:0] g_bit_ns_addr         // Address: CR15.Location + GT.offset*24 + 16 (Word3)
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
    
    // Building destination capability (CRd)
    capability_reg_t dst_cap;
    
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
    // Source Capability Latching
    // ========================================================================
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            src_cap <= CR_NULL;
        end else if (state == LOAD_FETCH_SRC) begin
            src_cap <= cr_rd_data;
        end
    end
    
    // ========================================================================
    // Step 1: CRd.W0 = GT from CRn[Index]
    // The GT (Golden Token) is fetched from the C-List at CRn.Location + Index
    // This GT will be used to access the Namespace (CR15) in subsequent steps
    // ========================================================================
    
    // Address in CRn's C-List: CRn.Location + (Index * 8) for GT fetch
    logic [63:0] clist_gt_addr;
    assign clist_gt_addr = src_cap.word1_location + ({56'h0, index_reg} << 3);
    
    // ========================================================================
    // Destination Capability Building State Machine
    // ========================================================================
    
    logic [1:0] ns_word_counter;  // Which namespace word we're fetching (1-3)
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            dst_cap <= CR_NULL;
            ns_word_counter <= 2'd0;
        end else begin
            case (state)
                LOAD_IDLE: begin
                    dst_cap <= CR_NULL;
                    ns_word_counter <= 2'd0;
                end
                
                // Step 1: Fetch GT from C-List → CRd.W0
                LOAD_FETCH_W0: begin
                    if (ns_rd_valid) begin
                        dst_cap.word0_gt <= ns_rd_data;  // GT goes into Word 0
                        ns_word_counter <= 2'd1;
                    end
                end
                
                // Steps 4-6: Fetch W1, W2, W3 from Namespace using GT.Offset
                LOAD_FETCH_W1: begin
                    if (ns_rd_valid) begin
                        dst_cap.word1_location <= ns_rd_data;
                        ns_word_counter <= 2'd2;
                    end
                end
                
                LOAD_FETCH_W2: begin
                    if (ns_rd_valid) begin
                        dst_cap.word2_limit <= ns_rd_data;
                        ns_word_counter <= 2'd3;
                    end
                end
                
                LOAD_FETCH_W3: begin
                    if (ns_rd_valid) begin
                        dst_cap.word3_seals <= ns_rd_data;
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
    
    // Check L or M permission on source capability CRn (required to fetch GT)
    logic has_l_permission;
    logic has_m_permission;
    logic has_load_permission;
    assign has_l_permission = src_cap.word0_gt.perms[PERM_L];
    assign has_m_permission = src_cap.word0_gt.perms[PERM_M];
    assign has_load_permission = has_l_permission || has_m_permission;
    
    // Check bounds: Index must be less than CRn.Limit
    logic bounds_ok;
    assign bounds_ok = ({56'h0, index_reg} < src_cap.word2_limit);
    
    // Check if source CRn is null capability
    logic src_is_null;
    assign src_is_null = (src_cap.word0_gt == GT_NULL);
    
    // Step 4: Check GT.offset < CR15.limit AND CR15 = M
    logic cr15_has_m;
    logic gt_offset_in_bounds;
    logic step4_ok;
    assign cr15_has_m = cr15_namespace.word0_gt.perms[PERM_M];
    assign gt_offset_in_bounds = ({32'h0, dst_cap.word0_gt.offset} < cr15_namespace.word2_limit);
    assign step4_ok = gt_offset_in_bounds && cr15_has_m;
    
    // Check G bit on fetched GT
    logic gt_has_g_bit;
    assign gt_has_g_bit = dst_cap.word0_gt.perms[PERM_G];
    
    // ========================================================================
    // Namespace Address Calculation
    // ========================================================================
    
    // Namespace base from CR15.Location
    logic [63:0] ns_base_addr;
    assign ns_base_addr = cr15_namespace.word1_location;
    
    // Namespace entry address = CR15.Location + (GT.Offset * 24)
    // Each namespace entry is 3 words (192 bits = 24 bytes)
    logic [63:0] ns_entry_addr;
    assign ns_entry_addr = ns_base_addr + ({32'h0, dst_cap.word0_gt.offset} * 64'd24);
    
    // ========================================================================
    // MAC Validation
    // ========================================================================
    
    logic [63:0] calculated_mac;
    logic mac_valid;
    
    // Simplified MAC: XOR of first 3 words
    assign calculated_mac = dst_cap.word0_gt ^ 
                            dst_cap.word1_location ^ 
                            dst_cap.word2_limit;
    
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
            
            // Read CRn register
            LOAD_FETCH_SRC: begin
                next_state = LOAD_CHECK_L;
            end
            
            // Step 1: Check M or L permission on CRn
            LOAD_CHECK_L: begin
                if (src_is_null)
                    next_state = LOAD_FAULT;  // Null capability fault
                else if (!has_load_permission)
                    next_state = LOAD_FAULT;  // M or L permission required on CRn
                else
                    next_state = LOAD_CHECK_BOUNDS;
            end
            
            // Step 2: Check bounds
            LOAD_CHECK_BOUNDS: begin
                if (!bounds_ok)
                    next_state = LOAD_FAULT;  // Bounds check failed
                else
                    next_state = LOAD_FETCH_W0;  // Fetch GT from C-List
            end
            
            // Step 3: Fetch GT from CRn[Index] → CRd.W0
            LOAD_FETCH_W0: begin
                if (ns_rd_valid)
                    next_state = LOAD_CALC_ADDR;  // GT fetched, now do Step 4 check
            end
            
            // Step 4: Check GT.offset < CR15.limit AND CR15 = M
            LOAD_CALC_ADDR: begin
                if (!step4_ok)
                    next_state = LOAD_FAULT;  // Bounds or M permission failed
                else
                    next_state = LOAD_FETCH_W1;  // Begin namespace fetch
            end
            
            // Step 5: Fetch W1 (Location) from Namespace
            LOAD_FETCH_W1: begin
                if (ns_rd_valid)
                    next_state = LOAD_FETCH_W2;
            end
            
            // Step 6: Fetch W2 (Limit) from Namespace
            LOAD_FETCH_W2: begin
                if (ns_rd_valid)
                    next_state = LOAD_FETCH_W3;
            end
            
            // Step 7: Fetch W3 (Seals) from Namespace
            LOAD_FETCH_W3: begin
                if (ns_rd_valid)
                    next_state = LOAD_CHECK_MAC;
            end
            
            // Step 7: Validate MAC
            LOAD_CHECK_MAC: begin
                if (!mac_valid)
                    next_state = LOAD_FAULT;  // MAC validation failed
                else if (gt_has_g_bit)
                    next_state = LOAD_RESET_G;
                else
                    next_state = LOAD_WRITE_DST;
            end
            
            // Step 8: Reset G bit
            LOAD_RESET_G: begin
                next_state = LOAD_WRITE_DST;
            end
            
            // Step 9: Write to CRd
            LOAD_WRITE_DST: begin
                next_state = LOAD_COMPLETE;
            end
            
            // Step 10: Complete
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
                        fault_type_reg <= FAULT_PERM_L;  // M or L required on CRn
                end
                
                LOAD_CHECK_BOUNDS: begin
                    if (!bounds_ok)
                        fault_type_reg <= FAULT_BOUNDS;
                end
                
                LOAD_CALC_ADDR: begin
                    if (!gt_has_m_permission)
                        fault_type_reg <= FAULT_PERM_M;  // M required for Namespace
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
    
    // Register read address
    assign cr_rd_addr = (state == LOAD_FETCH_SRC) ? cr_src_reg : 4'd0;
    
    // Register write
    assign cr_wr_addr = cr_dst_reg;
    
    // Write data with G bit cleared if needed
    always_comb begin
        cr_wr_data = dst_cap;
        // Clear G bit after namespace access
        if (gt_has_m_permission) begin
            cr_wr_data.word0_gt.perms[PERM_G] = 1'b0;
        end
    end
    
    assign cr_wr_en = (state == LOAD_WRITE_DST);
    
    // ========================================================================
    // Namespace Memory Interface
    // ========================================================================
    
    // Address selection based on state:
    // - FETCH_W0: C-List address (CRn.Location + Index*8) to get GT
    // - FETCH_W1/W2/W3: Namespace address (CR15.Location + GT.Offset*24 + word*8)
    always_comb begin
        ns_addr = 64'h0;
        case (state)
            LOAD_FETCH_W0: ns_addr = clist_gt_addr;  // Fetch GT from C-List
            LOAD_FETCH_W1: ns_addr = ns_entry_addr;  // Fetch W1 from Namespace
            LOAD_FETCH_W2: ns_addr = ns_entry_addr + 64'd8;   // W2
            LOAD_FETCH_W3: ns_addr = ns_entry_addr + 64'd16;  // W3
            default: ns_addr = 64'h0;
        endcase
    end
    
    assign ns_rd_en = (state == LOAD_FETCH_W0) ||
                      (state == LOAD_FETCH_W1) ||
                      (state == LOAD_FETCH_W2) ||
                      (state == LOAD_FETCH_W3);
    
    // G bit reset output - writes to CR15[GT.offset].Word3.Gbit
    assign g_bit_reset = (state == LOAD_RESET_G);
    assign g_bit_ns_addr = ns_entry_addr + 64'd16;  // Word3 address in namespace

endmodule
