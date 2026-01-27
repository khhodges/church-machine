// ============================================================================
// CTMM CALL Church-Instruction (CLOOMC)
// ============================================================================
// This module implements the CALL instruction which performs a two-step
// capability load to invoke a procedure:
//
// Syntax: CALL CRs[Index]
//   CRs = Source C-List register (CR0-CR6)
//   Index = Index into the C-List
//
// CALL Steps (Two-Phase Load + Isolation):
//   Phase 1: Load nodal C-List into CR6
//     1. Verify source CRs is in range 0-5 (not CR6 itself)
//     2. Verify source CRs has L permission
//     3. Call mLoad: CRs[Index] → CR6 (nodal C-List)
//   Phase 2: Load CLOOMC code into CR7
//     4. Call mLoad: CR6[0] → CR7 (CLOOMC code at offset zero)
//   Phase 3: Start isolated abstraction with MASK
//     5. Set NIA = 0 (start execution at offset zero)
//     6. Apply isolation based on MASK
//
// Fixed Register Behaviors (NOT in MASK):
//   DR0: always preserved (primary argument)
//   DR6-DR7: always cleared
//   DR8-DR15: always cleared
//
// MASK Field (11 bits): bit=1 means PRESERVE
//   [10:5] = CR0-CR5 preserve mask
//   [4:0]  = DR1-DR5 preserve mask
//
// The actual capability fetching is done by ctmm_mload.sv
// This reduces the Trusted Computing Base - all Church CLOOMC instructions
// share the same verified mLoad micro-routine for capability fetching.
//
// FAULT conditions:
//   - Source CRs not in range 0-5 (CR6 is destination)
//   - Source CRs lacks L permission
//   - Either mLoad faults (bounds, MAC, etc.)
// ============================================================================

module ctmm_call
    import ctmm_pkg::*;
(
    input  logic        clk,
    input  logic        rst_n,
    
    // Control interface
    input  logic        call_start,           // Start CALL execution
    input  logic [3:0]  cr_src,               // Source register (CRs) - must be CR0-CR5
    input  logic [7:0]  index,                // C-List index
    input  logic [10:0] mask,                 // Preserve mask: [10:5]=CR0-5, [4:0]=DR1-5
    output logic        call_busy,            // CALL in progress
    output logic        call_complete,        // CALL finished successfully
    output logic        call_fault,           // CALL caused a fault
    output fault_type_t fault_type,           // Type of fault
    
    // Capability register read interface
    output logic [3:0]  cr_rd_addr,           // Register to read
    input  capability_reg_t cr_rd_data,       // Full 256-bit register data
    
    // Capability register write interface
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
    
    // Thread update interface
    output logic        thread_wr_en,
    output logic [3:0]  thread_wr_idx,
    output logic [63:0] thread_wr_data,
    
    // G bit reset interface
    output logic        g_bit_reset,
    output logic [63:0] g_bit_addr,
    
    // Isolation interface - clear registers and set NIA
    output logic        nia_set,              // Set NIA enable
    output logic [63:0] nia_value,            // NIA = 0 for isolated abstraction
    output logic [15:0] dr_clear_mask,        // DRs to clear: bit[i]=1 means clear DR[i]
    output logic [15:0] cr_clear_mask         // CRs to clear: bit[i]=1 means clear CR[i]
);

    // ========================================================================
    // Constants
    // ========================================================================
    
    localparam logic [3:0] CR6_CLIST = 4'd6;       // Phase 1 destination
    localparam logic [3:0] CR7_NUCLEUS = 4'd7;    // Phase 2 destination
    localparam logic [3:0] MAX_SRC_REG = 4'd5;    // Source must be CR0-CR5 (not CR6)
    localparam logic [7:0] OFFSET_ZERO = 8'd0;    // CR6[0] for Phase 2
    
    // ========================================================================
    // State Machine - CALL instruction (two-phase)
    // ========================================================================
    
    typedef enum logic [3:0] {
        CALL_IDLE,
        CALL_CHECK_SRC,       // Verify source is CR0-CR5
        CALL_READ_SRC,        // Read source register for permission check
        CALL_CHECK_PERM,      // Verify L permission on source
        CALL_PHASE1,          // mLoad: CRs[Index] → CR6
        CALL_PHASE1_DONE,     // Phase 1 complete, prepare Phase 2
        CALL_PHASE2,          // mLoad: CR6[0] → CR7
        CALL_COMPLETE,
        CALL_FAULT
    } call_state_t;
    
    call_state_t state, next_state;
    
    // ========================================================================
    // Phase Tracking
    // ========================================================================
    
    logic phase;  // 0 = Phase 1 (load CR6), 1 = Phase 2 (load CR7)
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n)
            phase <= 1'b0;
        else if (state == CALL_IDLE)
            phase <= 1'b0;
        else if (state == CALL_PHASE1_DONE)
            phase <= 1'b1;
    end
    
    // ========================================================================
    // Local Register Read Control
    // ========================================================================
    
    logic        local_cr_rd_en;
    logic [3:0]  local_cr_rd_addr;
    logic [3:0]  sub_cr_rd_addr;
    
    assign local_cr_rd_en = (state == CALL_CHECK_SRC) || (state == CALL_READ_SRC);
    assign local_cr_rd_addr = cr_src;
    
    // ========================================================================
    // Permission Check Logic
    // ========================================================================
    
    logic src_in_range;
    logic src_has_l_perm;
    logic [9:0] src_perms;
    
    capability_reg_t src_reg_latched;
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            src_reg_latched <= '0;
        end else if (state == CALL_READ_SRC) begin
            src_reg_latched <= cr_rd_data;
        end
    end
    
    assign src_in_range = (cr_src <= MAX_SRC_REG);
    assign src_perms = src_reg_latched.word0_gt[57:48];
    assign src_has_l_perm = src_perms[PERM_L];
    
    // ========================================================================
    // Fault Latching
    // ========================================================================
    
    logic        fault_latched;
    fault_type_t fault_type_latched;
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            fault_latched <= 1'b0;
            fault_type_latched <= FAULT_NONE;
        end else if (state == CALL_IDLE) begin
            fault_latched <= 1'b0;
            fault_type_latched <= FAULT_NONE;
        end else if (state == CALL_CHECK_SRC && !src_in_range) begin
            fault_latched <= 1'b1;
            fault_type_latched <= FAULT_PERM;
        end else if (state == CALL_CHECK_PERM && !src_has_l_perm) begin
            fault_latched <= 1'b1;
            fault_type_latched <= FAULT_PERM;
        end else if ((state == CALL_PHASE1 || state == CALL_PHASE2) && sub_fault_latched) begin
            fault_latched <= 1'b1;
            fault_type_latched <= sub_fault_type;
        end
    end
    
    // ========================================================================
    // mLoad Subroutine Instance
    // ========================================================================
    
    logic        sub_start;
    logic        sub_start_reg;
    logic        sub_busy;
    logic        sub_done;
    logic        sub_fault;
    logic        sub_done_latched;
    logic        sub_fault_latched;
    fault_type_t sub_fault_type;
    
    // mLoad parameters depend on phase
    logic [3:0]  mload_src;
    logic [3:0]  mload_dst;
    logic [7:0]  mload_index;
    
    assign mload_src = phase ? CR6_CLIST : cr_src;        // Phase 1: CRs, Phase 2: CR6
    assign mload_dst = phase ? CR7_NUCLEUS : CR6_CLIST;   // Phase 1: CR6, Phase 2: CR7
    assign mload_index = phase ? OFFSET_ZERO : index;     // Phase 1: Index, Phase 2: 0
    
    // Single-cycle pulse on entry to PHASE1 or PHASE2
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n)
            sub_start_reg <= 1'b0;
        else if ((state == CALL_CHECK_PERM && next_state == CALL_PHASE1) ||
                 (state == CALL_PHASE1_DONE && next_state == CALL_PHASE2))
            sub_start_reg <= 1'b1;
        else
            sub_start_reg <= 1'b0;
    end
    
    // Sticky latches for completion/fault
    // Clear on IDLE or when starting a new mLoad
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            sub_done_latched <= 1'b0;
            sub_fault_latched <= 1'b0;
        end else if (state == CALL_IDLE) begin
            sub_done_latched <= 1'b0;
            sub_fault_latched <= 1'b0;
        end else if (sub_start_reg) begin
            sub_done_latched <= 1'b0;
            sub_fault_latched <= 1'b0;
        end else begin
            if (sub_done) sub_done_latched <= 1'b1;
            if (sub_fault) sub_fault_latched <= 1'b1;
        end
    end
    
    assign sub_start = sub_start_reg;
    
    ctmm_mload u_mload (
        .clk            (clk),
        .rst_n          (rst_n),
        
        // Subroutine interface
        .sub_start      (sub_start),
        .sub_cr_src     (mload_src),
        .sub_cr_dst     (mload_dst),
        .sub_index      (mload_index),
        .sub_busy       (sub_busy),
        .sub_done       (sub_done),
        .sub_fault      (sub_fault),
        .sub_fault_type (sub_fault_type),
        
        // Register interfaces
        .cr_rd_addr     (sub_cr_rd_addr),
        .cr_rd_data     (cr_rd_data),
        .cr_wr_addr     (cr_wr_addr),
        .cr_wr_data     (cr_wr_data),
        .cr_wr_en       (cr_wr_en),
        
        // CR15 interface
        .cr15_namespace (cr15_namespace),
        
        // Memory interface
        .mem_addr       (mem_addr),
        .mem_rd_en      (mem_rd_en),
        .mem_rd_data    (mem_rd_data),
        .mem_rd_valid   (mem_rd_valid),
        
        // Thread update interface
        .thread_wr_en   (thread_wr_en),
        .thread_wr_idx  (thread_wr_idx),
        .thread_wr_data (thread_wr_data),
        
        // G bit reset interface
        .g_bit_reset    (g_bit_reset),
        .g_bit_addr     (g_bit_addr)
    );
    
    // ========================================================================
    // State Register
    // ========================================================================
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            state <= CALL_IDLE;
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
            CALL_IDLE: begin
                if (call_start)
                    next_state = CALL_CHECK_SRC;
            end
            
            CALL_CHECK_SRC: begin
                if (!src_in_range)
                    next_state = CALL_FAULT;
                else
                    next_state = CALL_READ_SRC;
            end
            
            CALL_READ_SRC: begin
                next_state = CALL_CHECK_PERM;
            end
            
            CALL_CHECK_PERM: begin
                if (!src_has_l_perm)
                    next_state = CALL_FAULT;
                else
                    next_state = CALL_PHASE1;
            end
            
            CALL_PHASE1: begin
                // Wait for mLoad: CRs[Index] → CR6
                if (sub_fault_latched)
                    next_state = CALL_FAULT;
                else if (sub_done_latched)
                    next_state = CALL_PHASE1_DONE;
            end
            
            CALL_PHASE1_DONE: begin
                // Transition to Phase 2
                next_state = CALL_PHASE2;
            end
            
            CALL_PHASE2: begin
                // Wait for mLoad: CR6[0] → CR7
                if (sub_fault_latched)
                    next_state = CALL_FAULT;
                else if (sub_done_latched)
                    next_state = CALL_COMPLETE;
            end
            
            CALL_COMPLETE: begin
                next_state = CALL_IDLE;
            end
            
            CALL_FAULT: begin
                next_state = CALL_IDLE;
            end
            
            default: next_state = CALL_IDLE;
        endcase
    end
    
    // ========================================================================
    // Register Read Address Muxing
    // ========================================================================
    
    assign cr_rd_addr = local_cr_rd_en ? local_cr_rd_addr : sub_cr_rd_addr;
    
    // ========================================================================
    // Output Signals
    // ========================================================================
    
    assign call_busy = (state != CALL_IDLE);
    assign call_complete = (state == CALL_COMPLETE);
    assign call_fault = fault_latched;
    assign fault_type = fault_type_latched;
    
    // ========================================================================
    // Isolation Signals - Active on successful completion
    // ========================================================================
    // On CALL_COMPLETE:
    //   - Set NIA = 0 to start execution at offset zero
    //   - Clear DR8-DR15 always (upper DRs cannot be preserved)
    //   - Clear DR0-DR7 unless mask bit is set (preserve)
    //   - Clear CR0-CR5 unless mask bit is set (preserve)
    //
    // MASK format (14 bits from instruction):
    //   mask[7:0]  = DR preserve: bit[i]=1 means PRESERVE DR[i]
    //   mask[13:8] = CR preserve: bit[i-8]=1 means PRESERVE CR[i-8]
    //
    // Output masks: bit[i]=1 means CLEAR register[i]
    // ========================================================================
    
    // Latch mask on call_start for use at completion
    // Mask format: [10:5]=CR0-5, [4:0]=DR1-5
    logic [10:0] mask_latched;
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n)
            mask_latched <= 11'd0;
        else if (call_start && state == CALL_IDLE)
            mask_latched <= mask;
    end
    
    // Extract preserve bits from mask
    wire [5:0] cr_preserve = mask_latched[10:5];  // CR0-CR5
    wire [4:0] dr1_5_preserve = mask_latched[4:0]; // DR1-DR5
    
    // DR clear mask: bit[i]=1 means clear DR[i]
    // DR0: always preserved (bit=0)
    // DR1-DR5: from mask (inverted)
    // DR6-DR7: always cleared (bit=1)
    // DR8-DR15: always cleared (bit=1)
    wire [15:0] dr_clear_computed = {8'b1111_1111,    // DR8-15 always cleared
                                     2'b11,           // DR6-7 always cleared
                                     ~dr1_5_preserve, // DR1-5 from mask
                                     1'b0};           // DR0 always preserved
    
    // CR clear mask: bit[i]=1 means clear CR[i]
    // CR0-CR5: from mask (inverted)
    // CR6-CR15: never cleared by CALL (bit=0)
    wire [15:0] cr_clear_computed = {10'd0, ~cr_preserve};
    
    assign nia_set = (state == CALL_COMPLETE);
    assign nia_value = 64'd0;  // Start at offset zero
    assign dr_clear_mask = (state == CALL_COMPLETE) ? dr_clear_computed : 16'd0;
    assign cr_clear_mask = (state == CALL_COMPLETE) ? cr_clear_computed : 16'd0;

endmodule


