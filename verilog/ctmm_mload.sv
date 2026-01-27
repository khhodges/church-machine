// ============================================================================
// CTMM mLoad - Shared Micro-Routine for Capability Fetching
// ============================================================================
// This is the TRUSTED micro-routine used by all Church CLOOMC instructions
// that need to fetch a capability from a C-List:
//   - LOAD: sub_cr_dst = user-specified destination
//   - CALL: sub_cr_dst = CR7 (Nucleus)
//   - RETURN: sub_cr_dst = return register
//   - CHANGE: sub_cr_dst = CR8 (Thread)
//   - SWITCH: sub_cr_dst = CR15 (Namespace)
//
// Minimizing this trusted code base is critical for security.
// All capability fetching goes through this single verified micro-routine.
//
// KEY OPTIMIZATION: mLoad writes directly to the destination register,
// avoiding a second bus transfer through the caller.
//
// Microcode Sequence:
//   Step 1: Check CRn has M or L permission
//   Step 2: Check bounds: Index < CRn.Limit  
//   Step 3: Fetch GT from CRn[Index] → result.W0
//   Step 4: Check GT.offset < CR15.limit AND CR15 = M
//   Step 5: Fetch Word 1 (Location) from CR15.Location + GT.offset
//   Step 6: Fetch Word 2 (Limit) from CR15.Location + GT.offset + 8
//   Step 7: Fetch Word 3 (Seals) from CR15.Location + GT.offset + 16
//   Step 8: Validate MAC (calculated hash vs Seals)
//   Step 9: If G=1, reset G bit in CR15[GT.offset].Word3.Gbit
//   Step 10: Always write GT with G=0 to Thread[CRd] for suspension/rescheduling
//   Step 11: Write capability to CRd, signal done
//
// Note: GT.offset is a direct memory offset (bytes), not an index.
//       This provides hardware error detection - bit errors in the offset
//       will likely fail bounds check rather than accessing wrong entry.
// ============================================================================

module ctmm_mload
    import ctmm_pkg::*;
(
    input  logic        clk,
    input  logic        rst_n,
    
    // ========================================================================
    // Subroutine Interface - Called by LOAD, CALL, RETURN, CHANGE, SWITCH
    // ========================================================================
    input  logic        sub_start,            // Start subroutine execution
    input  logic [3:0]  sub_cr_src,           // Source register (CRn)
    input  logic [3:0]  sub_cr_dst,           // Destination register (CRd) - written directly
    input  logic [7:0]  sub_index,            // C-List index
    output logic        sub_busy,             // Subroutine in progress
    output logic        sub_done,             // Subroutine completed successfully
    output logic        sub_fault,            // Subroutine caused a fault
    output fault_type_t sub_fault_type,       // Type of fault
    
    // ========================================================================
    // Capability Register Read Interface
    // ========================================================================
    output logic [3:0]  cr_rd_addr,           // Register to read
    input  capability_reg_t cr_rd_data,       // Full 256-bit register data
    
    // ========================================================================
    // Capability Register Write Interface - Direct write to destination
    // ========================================================================
    output logic [3:0]  cr_wr_addr,           // Destination register (CRd)
    output capability_reg_t cr_wr_data,       // Fetched capability with G bit cleared
    output logic        cr_wr_en,             // Write enable (asserted on completion)
    
    // ========================================================================
    // CR15 (Namespace) Interface
    // ========================================================================
    input  capability_reg_t cr15_namespace,   // CR15 Namespace register
    
    // ========================================================================
    // Memory Interface (for fetching from C-List and Namespace)
    // ========================================================================
    output logic [63:0] mem_addr,             // Memory address
    output logic        mem_rd_en,            // Read enable
    input  logic [63:0] mem_rd_data,          // Read data (one 64-bit word)
    input  logic        mem_rd_valid,         // Read data valid
    
    // ========================================================================
    // Thread Update Interface - writes GT (G=0) to Thread[CRd]
    // ========================================================================
    // When a capability is loaded into CRd, the GT used is saved to Thread[CRd].
    // This enables thread suspension/rescheduling - CRs can be reloaded from saved GTs.
    // ========================================================================
    output logic        thread_wr_en,         // Write enable for Thread[CRd]
    output logic [3:0]  thread_wr_idx,        // Index into Thread (= CRd)
    output logic [63:0] thread_wr_data,       // GT with G=0
    
    // ========================================================================
    // G Bit Reset Interface - writes to CR15[GT.offset].Word3.Gbit
    // ========================================================================
    output logic        g_bit_reset,          // Signal to reset G bit
    output logic [63:0] g_bit_addr            // Address: CR15.Location + GT.offset + 16
);

    // ========================================================================
    // State Machine
    // ========================================================================
    
    typedef enum logic [3:0] {
        SUB_IDLE,
        SUB_FETCH_SRC,
        SUB_CHECK_L,
        SUB_CHECK_BOUNDS,
        SUB_FETCH_W0,
        SUB_CHECK_NS,
        SUB_FETCH_W1,
        SUB_FETCH_W2,
        SUB_FETCH_W3,
        SUB_CHECK_MAC,
        SUB_RESET_G,
        SUB_UPDATE_THREAD,   // Always write GT with G=0 to Thread[CRd]
        SUB_COMPLETE,
        SUB_FAULT
    } sub_state_t;
    
    sub_state_t state, next_state;
    
    // Latched operands
    logic [3:0]  cr_src_reg;
    logic [3:0]  cr_dst_reg;
    logic [7:0]  index_reg;
    
    // Latched source capability register (CRn)
    capability_reg_t src_cap;
    
    // Building result capability
    capability_reg_t result_cap;
    
    // ========================================================================
    // State Register
    // ========================================================================
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            state <= SUB_IDLE;
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
        end else if (state == SUB_IDLE && sub_start) begin
            cr_src_reg <= sub_cr_src;
            cr_dst_reg <= sub_cr_dst;
            index_reg <= sub_index;
        end
    end
    
    // ========================================================================
    // Source Capability Latching
    // ========================================================================
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            src_cap <= CR_NULL;
        end else if (state == SUB_FETCH_SRC) begin
            src_cap <= cr_rd_data;
        end
    end
    
    // ========================================================================
    // C-List Address Calculation (for fetching GT)
    // ========================================================================
    
    // Address in CRn's C-List: CRn.Location + (Index * 8) for GT fetch
    logic [63:0] clist_gt_addr;
    assign clist_gt_addr = src_cap.word1_location + ({56'h0, index_reg} << 3);
    
    // ========================================================================
    // Result Capability Building
    // ========================================================================
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            result_cap <= CR_NULL;
        end else begin
            case (state)
                SUB_IDLE: begin
                    result_cap <= CR_NULL;
                end
                
                SUB_FETCH_W0: begin
                    if (mem_rd_valid) begin
                        result_cap.word0_gt <= mem_rd_data;
                    end
                end
                
                SUB_FETCH_W1: begin
                    if (mem_rd_valid) begin
                        result_cap.word1_location <= mem_rd_data;
                    end
                end
                
                SUB_FETCH_W2: begin
                    if (mem_rd_valid) begin
                        result_cap.word2_limit <= mem_rd_data;
                    end
                end
                
                SUB_FETCH_W3: begin
                    if (mem_rd_valid) begin
                        result_cap.word3_seals <= mem_rd_data;
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
    
    // Step 1: Check L or M permission on source capability CRn
    logic has_l_permission;
    logic has_m_permission;
    logic has_load_permission;
    assign has_l_permission = src_cap.word0_gt.perms[PERM_L];
    assign has_m_permission = src_cap.word0_gt.perms[PERM_M];
    assign has_load_permission = has_l_permission || has_m_permission;
    
    // Step 2: Check bounds: Index < CRn.Limit
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
    assign gt_offset_in_bounds = ({32'h0, result_cap.word0_gt.offset} < cr15_namespace.word2_limit);
    assign step4_ok = gt_offset_in_bounds && cr15_has_m;
    
    // Check G bit on fetched GT
    logic gt_has_g_bit;
    assign gt_has_g_bit = result_cap.word0_gt.perms[PERM_G];
    
    // ========================================================================
    // Namespace Address Calculation
    // ========================================================================
    
    // Namespace base from CR15.Location
    logic [63:0] ns_base_addr;
    assign ns_base_addr = cr15_namespace.word1_location;
    
    // Namespace entry address = CR15.Location + GT.offset (direct memory offset)
    logic [63:0] ns_entry_addr;
    assign ns_entry_addr = ns_base_addr + {32'h0, result_cap.word0_gt.offset};
    
    // ========================================================================
    // MAC Validation
    // ========================================================================
    
    logic [63:0] calculated_mac;
    logic mac_valid;
    
    assign calculated_mac = result_cap.word0_gt ^ 
                            result_cap.word1_location ^ 
                            result_cap.word2_limit;
    
    // TODO: implement full MAC validation
    assign mac_valid = 1'b1;
    
    // ========================================================================
    // Next State Logic
    // ========================================================================
    
    always_comb begin
        next_state = state;
        
        case (state)
            SUB_IDLE: begin
                if (sub_start)
                    next_state = SUB_FETCH_SRC;
            end
            
            SUB_FETCH_SRC: begin
                next_state = SUB_CHECK_L;
            end
            
            SUB_CHECK_L: begin
                if (src_is_null)
                    next_state = SUB_FAULT;
                else if (!has_load_permission)
                    next_state = SUB_FAULT;
                else
                    next_state = SUB_CHECK_BOUNDS;
            end
            
            SUB_CHECK_BOUNDS: begin
                if (!bounds_ok)
                    next_state = SUB_FAULT;
                else
                    next_state = SUB_FETCH_W0;
            end
            
            SUB_FETCH_W0: begin
                if (mem_rd_valid)
                    next_state = SUB_CHECK_NS;
            end
            
            SUB_CHECK_NS: begin
                if (!step4_ok)
                    next_state = SUB_FAULT;
                else
                    next_state = SUB_FETCH_W1;
            end
            
            SUB_FETCH_W1: begin
                if (mem_rd_valid)
                    next_state = SUB_FETCH_W2;
            end
            
            SUB_FETCH_W2: begin
                if (mem_rd_valid)
                    next_state = SUB_FETCH_W3;
            end
            
            SUB_FETCH_W3: begin
                if (mem_rd_valid)
                    next_state = SUB_CHECK_MAC;
            end
            
            SUB_CHECK_MAC: begin
                if (!mac_valid)
                    next_state = SUB_FAULT;
                else if (gt_has_g_bit)
                    next_state = SUB_RESET_G;
                else
                    next_state = SUB_UPDATE_THREAD;  // Skip RESET_G but always UPDATE_THREAD
            end
            
            SUB_RESET_G: begin
                next_state = SUB_UPDATE_THREAD;
            end
            
            SUB_UPDATE_THREAD: begin
                // Always write GT with G=0 to Thread[CRd] for suspension/rescheduling
                next_state = SUB_COMPLETE;
            end
            
            SUB_COMPLETE: begin
                next_state = SUB_IDLE;
            end
            
            SUB_FAULT: begin
                next_state = SUB_IDLE;
            end
            
            default: next_state = SUB_IDLE;
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
                SUB_CHECK_L: begin
                    if (src_is_null)
                        fault_type_reg <= FAULT_NULL_CAP;
                    else if (!has_load_permission)
                        fault_type_reg <= FAULT_PERM_L;
                end
                
                SUB_CHECK_BOUNDS: begin
                    if (!bounds_ok)
                        fault_type_reg <= FAULT_BOUNDS;
                end
                
                SUB_CHECK_NS: begin
                    if (!step4_ok)
                        fault_type_reg <= FAULT_BOUNDS;  // GT.offset or CR15.M failed
                end
                
                SUB_CHECK_MAC: begin
                    if (!mac_valid)
                        fault_type_reg <= FAULT_MAC;
                end
                
                SUB_IDLE: begin
                    fault_type_reg <= FAULT_NONE;
                end
                
                default: begin
                    // Hold current fault type
                end
            endcase
        end
    end
    
    // ========================================================================
    // Output Signals
    // ========================================================================
    
    // Status outputs
    assign sub_busy = (state != SUB_IDLE);
    assign sub_done = (state == SUB_COMPLETE);
    assign sub_fault = (state == SUB_FAULT);
    assign sub_fault_type = fault_type_reg;
    
    // Register read address
    assign cr_rd_addr = (state == SUB_FETCH_SRC) ? cr_src_reg : 4'd0;
    
    // ========================================================================
    // Direct Write to Destination Register - Single Bus Transfer
    // ========================================================================
    // The subroutine writes directly to the destination CR on completion,
    // avoiding a second bus transfer through the caller.
    //
    // TIMING: cr_wr_en is asserted for one cycle in SUB_COMPLETE state.
    // The register file must be designed to capture data on rising edge
    // when cr_wr_en is high (standard synchronous write).
    // ========================================================================
    
    assign cr_wr_addr = cr_dst_reg;
    
    // Write data with G bit cleared
    always_comb begin
        cr_wr_data = result_cap;
        cr_wr_data.word0_gt.perms[PERM_G] = 1'b0;  // Always clear G bit
    end
    
    // Write enable on successful completion (one cycle pulse)
    assign cr_wr_en = (state == SUB_COMPLETE);
    
    // ========================================================================
    // Memory Interface
    // ========================================================================
    
    always_comb begin
        mem_addr = 64'h0;
        case (state)
            SUB_FETCH_W0:     mem_addr = clist_gt_addr;
            SUB_FETCH_W1:     mem_addr = ns_entry_addr;
            SUB_FETCH_W2:     mem_addr = ns_entry_addr + 64'd8;
            SUB_FETCH_W3:     mem_addr = ns_entry_addr + 64'd16;
            default:          mem_addr = 64'h0;
        endcase
    end
    
    assign mem_rd_en = (state == SUB_FETCH_W0) ||
                       (state == SUB_FETCH_W1) ||
                       (state == SUB_FETCH_W2) ||
                       (state == SUB_FETCH_W3);
    
    // ========================================================================
    // Thread Update - write GT with G=0 to Thread[CRd]
    // ========================================================================
    // Saves the GT used to load CRd, enabling thread suspension/rescheduling.
    // This is UNCONDITIONAL - happens on every successful LOAD.
    // ========================================================================
    
    logic [63:0] gt_with_g_cleared;
    always_comb begin
        gt_with_g_cleared = result_cap.word0_gt;
        gt_with_g_cleared[PERM_G + 48] = 1'b0;  // Clear G bit in permissions field
    end
    
    assign thread_wr_en = (state == SUB_UPDATE_THREAD);
    assign thread_wr_idx = cr_dst_reg;         // Write to Thread[CRd]
    assign thread_wr_data = gt_with_g_cleared;
    
    // G bit reset output - writes to CR15[GT.offset].Word3.Gbit
    assign g_bit_reset = (state == SUB_RESET_G);
    assign g_bit_addr = ns_entry_addr + 64'd16;

endmodule
