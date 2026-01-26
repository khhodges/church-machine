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
//   CR7:  Nucleus (kernel capability)
//   CR8:  Thread identity
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
    input  logic [63:0] cr_word_wr_data,      // 64-bit word data
    input  logic        cr_word_wr_en,        // Word write enable
    
    // Word-level read interface
    input  logic [3:0]  cr_word_rd_addr,      // Register address
    input  logic [1:0]  cr_word_rd_sel,       // Word select (0-3)
    output logic [63:0] cr_word_rd_data,      // 64-bit word data
    
    // Special register direct access (for fast paths)
    output capability_reg_t cr6_clist,        // CR6: Current C-List
    output capability_reg_t cr7_nucleus,      // CR7: Nucleus
    output capability_reg_t cr8_thread,       // CR8: Thread identity
    output capability_reg_t cr15_namespace,   // CR15: Namespace root
    
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
        cr_word_rd_data = 64'h0;
        if (cr_word_rd_addr < NUM_CAP_REGS) begin
            case (cr_word_rd_sel)
                2'd0: cr_word_rd_data = cap_regs[cr_word_rd_addr].word0_gt;
                2'd1: cr_word_rd_data = cap_regs[cr_word_rd_addr].word1_location;
                2'd2: cr_word_rd_data = cap_regs[cr_word_rd_addr].word2_limit;
                2'd3: cr_word_rd_data = cap_regs[cr_word_rd_addr].word3_seals;
            endcase
        end
    end
    
    // Special register outputs
    assign cr6_clist     = cap_regs[CR_CLIST];
    assign cr7_nucleus   = cap_regs[CR_NUCLEUS];
    assign cr8_thread    = cap_regs[CR_THREAD];
    assign cr15_namespace= cap_regs[CR_NAMESPACE];
    assign cr16_nia      = cap_regs[CR_NIA];
    assign cr17_fault    = cap_regs[CR_FAULT];
    
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
                    2'd2: cap_regs[cr_word_wr_addr].word2_limit <= cr_word_wr_data;
                    2'd3: cap_regs[cr_word_wr_addr].word3_seals <= cr_word_wr_data;
                endcase
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
