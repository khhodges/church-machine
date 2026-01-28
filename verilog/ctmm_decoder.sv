// ============================================================================
// CTMM Instruction Decoder - Church and Turing Instruction Decode
// ============================================================================
// Decodes 32-bit instructions into control signals
// Standardized Instruction Format:
//   Bits [31:27] - Opcode (5 bits)
//   Bits [26:23] - Condition code (4 bits)
//   Bit  [22]    - I bit (Immediate mode flag)
//   Bits [21:0]  - Operands (instruction-specific)
// ============================================================================

module ctmm_decoder
    import ctmm_pkg::*;
(
    input  logic        clk,
    input  logic        rst_n,
    
    // Instruction input
    input  logic [31:0] instruction,
    input  logic        instr_valid,
    
    // Condition flags for evaluation
    input  condition_flags_t flags,
    
    // Decoded outputs
    output logic        exec_enable,      // Condition passed, execute
    output logic        is_church_op,     // Church (capability) operation
    output logic        is_turing_op,     // Turing (data) operation
    
    // Church instruction decoded fields (3-bit CR for 8 registers)
    // CR0-CR7 addressable by instructions; CR8-CR15 are protected/special
    output church_opcode_t church_op,
    output logic [2:0]  cr_src,           // Source CR (3 bits: CR0-CR7)
    output logic [2:0]  cr_dst,           // Destination CR (3 bits: CR0-CR7)
    output logic [9:0]  clist_index,      // C-List index (10 bits: 1024 entries)
    output logic [3:0]  tperm_preset,     // TPERM preset mask code
    output logic [9:0]  call_mask,        // CALL permission mask (10 bits when I=1)
    output logic        imm_mode,         // I bit - immediate mode flag
    
    // Turing instruction decoded fields
    output turing_opcode_t turing_op,
    output logic [3:0]  dr_src1,          // Source DR 1
    output logic [3:0]  dr_src2,          // Source DR 2
    output logic [3:0]  dr_dst,           // Destination DR
    output logic [13:0] immediate,        // Immediate value (14 bits when I=1)
    output logic [21:0] ldi_immediate,    // LDI large immediate (22 bits)
    output logic [17:0] branch_offset,    // Branch offset (18 bits)
    
    // Store-Exclusive result register (for SAVEX)
    output logic [3:0]  excl_result_dr,   // DR to store success/fail result
    
    // Load/Store Multiple register mask
    output logic [15:0] reg_list,         // Register list for LDM/STM
    
    // Fault output
    output fault_type_t fault,
    output logic        fault_valid
);

    // ========================================================================
    // Instruction Field Extraction (New Format)
    // ========================================================================
    
    logic [4:0] opcode_field;
    logic [3:0] cond_field;
    logic       i_bit;
    logic [21:0] operand_field;
    
    assign opcode_field = instruction[31:27];
    assign cond_field = instruction[26:23];
    assign i_bit = instruction[22];
    assign operand_field = instruction[21:0];
    
    // I bit passthrough
    assign imm_mode = i_bit;
    
    // ========================================================================
    // Condition Code Evaluation
    // ========================================================================
    
    logic cond_pass;
    
    always_comb begin
        case (cond_code_t'(cond_field))
            COND_EQ: cond_pass = flags.Z;
            COND_NE: cond_pass = !flags.Z;
            COND_CS: cond_pass = flags.C;
            COND_CC: cond_pass = !flags.C;
            COND_MI: cond_pass = flags.N;
            COND_PL: cond_pass = !flags.N;
            COND_VS: cond_pass = flags.V;
            COND_VC: cond_pass = !flags.V;
            COND_HI: cond_pass = flags.C && !flags.Z;
            COND_LS: cond_pass = !flags.C || flags.Z;
            COND_GE: cond_pass = (flags.N == flags.V);
            COND_LT: cond_pass = (flags.N != flags.V);
            COND_GT: cond_pass = !flags.Z && (flags.N == flags.V);
            COND_LE: cond_pass = flags.Z || (flags.N != flags.V);
            COND_AL: cond_pass = 1'b1;
            COND_NV: cond_pass = 1'b0;
            default: cond_pass = 1'b0;
        endcase
    end
    
    assign exec_enable = instr_valid && cond_pass;
    
    // ========================================================================
    // Opcode Classification (5-bit opcodes)
    // ========================================================================
    
    // Church operations: opcodes 00001 - 01011 (1-11)
    assign is_church_op = (opcode_field >= 5'b00001) && (opcode_field <= 5'b01011);
    
    // Turing operations: opcodes 10000 - 11111 (16-31)
    assign is_turing_op = opcode_field[4] == 1'b1;
    
    // ========================================================================
    // Church Instruction Decode
    // ========================================================================
    // Format with 3-bit CR fields (CR0-CR7 only for security):
    // CR8-CR15 are protected registers not directly addressable
    //
    // LOAD/SAVE/LOADX/SAVEX:
    //   [21:19] = CRd (3 bits: CR0-CR7)
    //   [18:16] = CRn (3 bits: CR0-CR7)
    //   [15:6]  = Index (10 bits: 1024 entries)
    //   [5:4]   = Reserved
    //   [3:0]   = For SAVEX: DRd result register
    //
    // CALL (I=1 embedded mask):
    //   [21:19] = CRd return (3 bits)
    //   [18:16] = CRn target (3 bits)
    //   [15:6]  = Permission mask (10 bits)
    //   [5:0]   = Reserved
    //   I=0: Use DR15 as 64-bit mask
    //
    // TPERM:
    //   [21:19] = CRd destination (3 bits)
    //   [18:16] = CRs source (3 bits)
    //   [3:0]   = Preset code (4 bits)
    //
    // LDM/STM:
    //   [21:19] = CRn base (3 bits)
    //   [7:0]   = Register list (8 bits: CR0-CR7 only)
    //
    // RETURN:
    //   [21:19] = CRn return capability (3 bits)
    // ========================================================================
    
    assign church_op = church_opcode_t'(opcode_field);
    
    // Common field extraction (3-bit CR fields for security)
    assign cr_dst = operand_field[21:19];
    assign cr_src = operand_field[18:16];
    assign clist_index = operand_field[15:6];
    
    // TPERM preset code
    assign tperm_preset = operand_field[3:0];
    
    // CALL mask (10 bits when I=1, use DR15 when I=0)
    assign call_mask = operand_field[15:6];
    
    // SAVEX result register
    assign excl_result_dr = operand_field[3:0];
    
    // LDM/STM register list (8 bits for CR0-CR7 only)
    assign reg_list = {8'h00, operand_field[7:0]};
    
    // ========================================================================
    // Turing Instruction Decode
    // ========================================================================
    // Format varies by instruction:
    //
    // Arithmetic/Logic (I=0 register mode):
    //   [21:18] = DRd destination (4 bits)
    //   [17:14] = DRn source 1 (4 bits)
    //   [13:10] = DRm source 2 (4 bits)
    //   [9:0]   = Reserved
    //
    // Arithmetic/Logic (I=1 immediate mode):
    //   [21:18] = DRd destination (4 bits)
    //   [17:14] = DRn source 1 (4 bits)
    //   [13:0]  = Immediate value (14 bits, signed)
    //
    // LDI (Load Immediate):
    //   [21:18] = DRd destination (4 bits)
    //   [17:0]  = Immediate value (18 bits)
    //   + I bit extends to 22 bits total with cond field
    //
    // Branch:
    //   [17:0]  = Signed offset (18 bits)
    // ========================================================================
    
    assign turing_op = turing_opcode_t'(opcode_field);
    
    // Data register fields
    assign dr_dst = operand_field[21:18];
    assign dr_src1 = operand_field[17:14];
    assign dr_src2 = operand_field[13:10];
    
    // Immediate value (14 bits for arithmetic)
    assign immediate = operand_field[13:0];
    
    // LDI large immediate (22 bits)
    assign ldi_immediate = operand_field;
    
    // Branch offset (18 bits, sign-extended from operand)
    assign branch_offset = operand_field[17:0];
    
    // ========================================================================
    // Invalid Opcode and TPERM Reserved Code Detection
    // ========================================================================
    
    always_comb begin
        fault_valid = 1'b0;
        fault = FAULT_NONE;
        
        if (instr_valid) begin
            // Check for invalid opcode
            if (!is_church_op && !is_turing_op) begin
                fault_valid = 1'b1;
                fault = FAULT_INVALID_OP;
            end
            // Check for reserved TPERM codes (9, 14, 15 are reserved)
            else if (church_op == OP_TPERM && (tperm_preset == 4'd9 || tperm_preset == 4'd14 || tperm_preset == 4'd15)) begin
                fault_valid = 1'b1;
                fault = FAULT_TPERM_RSV;
            end
        end
    end

endmodule
