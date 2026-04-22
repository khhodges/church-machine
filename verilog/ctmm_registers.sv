// ============================================================================
// CTMM Register File - 16 Capability Registers and 16 Data Registers
// ============================================================================
// Capability Registers (CR0-CR15): Each is 4 x 64-bit words (256 bits)
//   Word 0: Golden Token (Permissions + Offset)
//   Word 1: Location (Physical address/base pointer)
//   Word 2: Limit (Size/bounds for access checking)
//   Word 3: Seals/MAC (Security validation hash)
//
// Special Registers:
//   CR6:  Current C-List
//   CR7:  CLOOMC Nucleus (Function Abstraction Code)
//   CR8:  Suspended Thread State
//   CR9:  Interrupt Thread
//   CR10: Double Fault Recovery Thread
//   CR15: Namespace root
//
// Data Registers (DR0-DR15): 64-bit data values for Turing operations
// ============================================================================

module ctmm_registers
    import ctmm_pkg::*;
(
    input  logic        clk,
    input  logic        rst_n,
    
    // ========================================================================
    // Capability Register Interface (4 x 64-bit words per register)
    // ========================================================================
    
    // Read port - returns full 256-bit capability register
    input  logic [3:0]  cr_rd_addr,           // Read address (0-15)
    output capability_reg_t cr_rd_data,       // Full 256-bit capability register
    
    // Write port - writes full 256-bit capability register
    input  logic [3:0]  cr_wr_addr,           // Write address (0-15)
    input  capability_reg_t cr_wr_data,       // Full 256-bit capability register
    input  logic        cr_wr_en,             // Write enable
    
    // Word-level write interface (for microcode sequencing)
    input  logic [3:0]  cr_word_wr_addr,      // Register address
    input  logic [1:0]  cr_word_sel,          // Word select (0-3)
    input  logic [31:0] cr_word_wr_data,      // 32-bit word data
    input  logic        cr_word_wr_en,        // Word write enable
    
    // Word-level read interface
    input  logic [3:0]  cr_word_rd_addr,      // Register address
    input  logic [1:0]  cr_word_rd_sel,       // Word select (0-3)
    output logic [31:0] cr_word_rd_data,      // 32-bit word data
    
    // Special register direct access (for fast paths)
    output capability_reg_t cr6_clist,        // CR6: Current C-List
    output capability_reg_t cr7_cloomc,       // CR7: CLOOMC Nucleus (Function Abstraction Code)
    output capability_reg_t cr8_thread,       // CR8: Suspended Thread State
    output capability_reg_t cr12_cap,         // CR12: incoming thread capability (word1_location = lump base after CHANGE)
    output capability_reg_t cr15_namespace,   // CR15: Namespace root
    
    // Special register write interfaces (GT only - Word 0)
    // Used by boot sequence and SWITCH/CHANGE instructions
    input  golden_token_t   cr6_wr_data,      // Write GT to CR6
    input  logic            cr6_wr_en,
    input  golden_token_t   cr7_wr_data,      // Write GT to CR7
    input  logic            cr7_wr_en,
    input  golden_token_t   cr8_wr_data,      // Write GT to CR8
    input  logic            cr8_wr_en,
    input  golden_token_t   cr9_wr_data,      // Write GT to CR9 (Interrupt)
    input  logic            cr9_wr_en,
    input  golden_token_t   cr10_wr_data,     // Write GT to CR10 (DFault)
    input  logic            cr10_wr_en,
    input  golden_token_t   cr11_wr_data,     // Write GT to CR11 (reserved)
    input  logic            cr11_wr_en,
    input  golden_token_t   cr12_wr_data,     // Write GT to CR12 (reserved)
    input  logic            cr12_wr_en,
    input  golden_token_t   cr13_wr_data,     // Write GT to CR13 (reserved)
    input  logic            cr13_wr_en,
    input  golden_token_t   cr14_wr_data,     // Write GT to CR14 (reserved)
    input  logic            cr14_wr_en,
    input  golden_token_t   cr15_wr_data,     // Write GT to CR15
    input  logic            cr15_wr_en,
    
    // ========================================================================
    // Data Register Interface (Turing)
    // ========================================================================
    
    input  logic [3:0]  dr_rd_addr1,          // Read address 1
    output logic [63:0] dr_rd_data1,          // Read data 1
    input  logic [3:0]  dr_rd_addr2,          // Read address 2
    output logic [63:0] dr_rd_data2,          // Read data 2
    input  logic [3:0]  dr_wr_addr,           // Write address
    input  logic [63:0] dr_wr_data,           // Write data
    input  logic        dr_wr_en,             // Write enable
    
    // ========================================================================
    // Condition Flags
    // ========================================================================
    
    output condition_flags_t flags,
    input  condition_flags_t flags_in,
    input  logic        flags_wr_en,
    
    // Parallel CALL isolation mask ports (single-cycle domain-crossing cleanup)
    // cr_b_clear_mask: bit N high → clear b_flag on CR[N]  (CRs 0-5, preserved after CALL)
    // cr_null_mask:    bit N high → write NULL to  CR[N]  (CRs 0-11, discarded after CALL)
    // cr_null_mask takes priority when both bits are asserted for the same register.
    input  logic [5:0]  cr_b_clear_mask,
    input  logic [11:0] cr_null_mask,

    // Clear all registers (boot step 1)
    input  logic        clear_all
);

    // ========================================================================
    // Capability Register Array - 18 registers, each 256 bits
    // ========================================================================
    
    capability_reg_t cap_regs [0:NUM_CAP_REGS-1];
    
    // Full register read
    assign cr_rd_data = (cr_rd_addr < NUM_CAP_REGS) ? cap_regs[cr_rd_addr] : CR_NULL;
    
    // Word-level read
    always_comb begin
        cr_word_rd_data = 32'h0;
        if (cr_word_rd_addr < NUM_CAP_REGS) begin
            case (cr_word_rd_sel)
                2'd0: cr_word_rd_data = cap_regs[cr_word_rd_addr].word0_gt;
                2'd1: cr_word_rd_data = cap_regs[cr_word_rd_addr].word1_location;
                2'd2: cr_word_rd_data = cap_regs[cr_word_rd_addr].word2_w2;
                2'd3: cr_word_rd_data = cap_regs[cr_word_rd_addr].word3_w3;
            endcase
        end
    end
    
    // Special register outputs
    assign cr6_clist      = cap_regs[CR_CLIST];
    assign cr7_cloomc     = cap_regs[CR_NUCLEUS];
    assign cr8_thread     = cap_regs[CR_THREAD];
    assign cr12_cap       = cap_regs[12];
    assign cr15_namespace = cap_regs[CR_NAMESPACE];
    
    // Full register write and word-level write
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n || clear_all) begin
            for (int i = 0; i < NUM_CAP_REGS; i++) begin
                cap_regs[i] <= CR_NULL;
            end
        end else begin
            // Full 256-bit register write
            if (cr_wr_en && cr_wr_addr < NUM_CAP_REGS) begin
                cap_regs[cr_wr_addr] <= cr_wr_data;
            end
            // Word-level write (for microcode sequencing)
            if (cr_word_wr_en && cr_word_wr_addr < NUM_CAP_REGS) begin
                case (cr_word_sel)
                    2'd0: cap_regs[cr_word_wr_addr].word0_gt <= cr_word_wr_data;
                    2'd1: cap_regs[cr_word_wr_addr].word1_location <= cr_word_wr_data;
                    2'd2: cap_regs[cr_word_wr_addr].word2_w2 <= cr_word_wr_data;
                    2'd3: cap_regs[cr_word_wr_addr].word3_w3 <= cr_word_wr_data;
                endcase
            end
            
            // Special register GT writes (Word 0 only)
            // Used by boot sequence and SWITCH/CHANGE instructions
            if (cr6_wr_en)  cap_regs[CR_CLIST].word0_gt <= cr6_wr_data;
            if (cr7_wr_en)  cap_regs[CR_NUCLEUS].word0_gt <= cr7_wr_data;
            if (cr8_wr_en)  cap_regs[CR_THREAD].word0_gt <= cr8_wr_data;
            if (cr9_wr_en)  cap_regs[9].word0_gt <= cr9_wr_data;
            if (cr10_wr_en) cap_regs[10].word0_gt <= cr10_wr_data;
            if (cr11_wr_en) cap_regs[11].word0_gt <= cr11_wr_data;
            if (cr12_wr_en) cap_regs[12].word0_gt <= cr12_wr_data;
            if (cr13_wr_en) cap_regs[13].word0_gt <= cr13_wr_data;
            if (cr14_wr_en) cap_regs[14].word0_gt <= cr14_wr_data;
            if (cr15_wr_en) cap_regs[CR_NAMESPACE].word0_gt <= cr15_wr_data;

            // Parallel CALL isolation: single-cycle mask operations.
            // cr_null_mask takes priority over cr_b_clear_mask for the same register.
            for (int i = 0; i < 12; i++) begin
                if (cr_null_mask[i])
                    cap_regs[i] <= CR_NULL;
                else if (i < 6 && cr_b_clear_mask[i])
                    cap_regs[i].word0_gt.b_flag <= 1'b0;
            end
        end
    end
    
    // ========================================================================
    // Data Registers (DR0-DR15) - 16 x 64-bit
    // ========================================================================
    
    logic [63:0] data_regs [0:15];
    
    // Dual-port read
    assign dr_rd_data1 = data_regs[dr_rd_addr1];
    assign dr_rd_data2 = data_regs[dr_rd_addr2];
    
    // Write
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n || clear_all) begin
            for (int i = 0; i < 16; i++) begin
                data_regs[i] <= 64'h0;
            end
        end else if (dr_wr_en) begin
            data_regs[dr_wr_addr] <= dr_wr_data;
        end
    end
    
    // ========================================================================
    // Condition Flags
    // ========================================================================
    
    condition_flags_t flags_reg;
    assign flags = flags_reg;
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n || clear_all) begin
            flags_reg <= '{N: 1'b0, Z: 1'b0, C: 1'b0, V: 1'b0};
        end else if (flags_wr_en) begin
            flags_reg <= flags_in;
        end
    end

endmodule
