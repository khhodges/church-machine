// ============================================================================
// CTMM Instruction Decoder - Church and Turing Instruction Decode
// ============================================================================
// Decodes 32-bit instructions into control signals
// Instruction format (ARM-style):
//   Bits [31:28] - Condition code
//   Bits [27:22] - Opcode
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
    
    // Church instruction decoded fields
    output church_opcode_t church_op,
    output logic [3:0]  cr_src,           // Source CR
    output logic [3:0]  cr_dst,           // Destination CR
    output logic [7:0]  clist_index,      // C-List index
    output logic [15:0] perm_mask,        // Permission mask for TPERM
    output logic [2:0]  call_crs,         // CALL source CR (3 bits: CR0-CR5)
    output logic [13:0] call_mask,        // CALL preserve mask: [7:0]=DR0-7, [13:8]=CR0-5
    
    // Turing instruction decoded fields
    output turing_opcode_t turing_op,
    output logic [3:0]  dr_src1,          // Source DR 1
    output logic [3:0]  dr_src2,          // Source DR 2
    output logic [3:0]  dr_dst,           // Destination DR
    output logic [15:0] immediate,        // Immediate value
    output logic        use_immediate,    // Use immediate vs register
    output logic [15:0] branch_offset,    // Branch offset
    
    // Fault output
    output fault_type_t fault,
    output logic        fault_valid
);

    // ========================================================================
    // Instruction Field Extraction
    // ========================================================================
    
    logic [3:0] cond_field;
    logic [5:0] opcode_field;
    logic [21:0] operand_field;
    
    assign cond_field = instruction[31:28];
    assign opcode_field = instruction[27:22];
    assign operand_field = instruction[21:0];
    
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
    // Opcode Classification
    // ========================================================================
    
    // Church operations: opcodes 000001 - 000111
    assign is_church_op = (opcode_field[5:3] == 3'b000) && (opcode_field[2:0] != 3'b000);
    
    // Turing operations: opcodes 010000+ and 100000+
    assign is_turing_op = (opcode_field[5:4] == 2'b01) || (opcode_field[5:4] == 2'b10);
    
    // ========================================================================
    // Church Instruction Decode
    // ========================================================================
    
    assign church_op = church_opcode_t'(opcode_field);
    
    // LOAD/SAVE: CR_dst, CR_src, index
    // Bits [21:18] = dst CR
    // Bits [17:14] = src CR (4 bits for LOAD/SAVE)
    // Bits [13:6]  = C-List index
    assign cr_dst = operand_field[21:18];
    assign cr_src = operand_field[17:14];  // 4 bits for LOAD/SAVE; CALL uses [17:15]
    assign clist_index = operand_field[13:6];
    
    // TPERM: CR_src, perm_mask
    // Bits [21:18] = CR to test
    // Bits [15:0]  = permission mask
    assign perm_mask = operand_field[15:0];
    
    // CALL: CR_src, index, mask (uses spare bits for isolation mask)
    // Bits [17:15] = src CR (3 bits: CR0-CR5 only)
    // Bits [13:6]  = C-List index (8 bits = 256 entries)
    // Bits [21:18] = CR preserve mask for CR0-CR3 (4 bits)
    // Bits [14]    = CR preserve for CR4 (1 bit)
    // Bits [5:0]   = DR preserve mask for DR0-DR5 (6 bits)
    // Total: 11 spare bits encode 11 registers
    assign call_crs = operand_field[17:15];
    //
    // call_mask format: [13:8]=CR0-5, [7:0]=DR0-7
    // Encoding: CR[4:0]={[14],[21:18]}, CR5=0, DR[5:0]=[5:0], DR[7:6]=11
    assign call_mask = {1'b0, operand_field[14], operand_field[21:18], 
                        2'b11, operand_field[5:0]};
    
    // ========================================================================
    // Turing Instruction Decode
    // ========================================================================
    
    assign turing_op = turing_opcode_t'(opcode_field);
    
    // Data processing: DR_dst, DR_src1, DR_src2 or immediate
    // Bits [21:18] = dst DR
    // Bits [17:14] = src1 DR
    // Bits [13:10] = src2 DR (if register mode)
    // Bit [9]      = immediate flag
    // Bits [15:0]  = immediate value (if immediate mode)
    assign dr_dst = operand_field[21:18];
    assign dr_src1 = operand_field[17:14];
    assign dr_src2 = operand_field[13:10];
    assign use_immediate = operand_field[9];
    assign immediate = operand_field[15:0];
    
    // Branch instructions
    // Bits [15:0] = signed offset
    assign branch_offset = operand_field[15:0];
    
    // ========================================================================
    // Invalid Opcode Detection
    // ========================================================================
    
    always_comb begin
        fault_valid = 1'b0;
        fault = FAULT_NONE;
        
        if (instr_valid) begin
            if (!is_church_op && !is_turing_op) begin
                fault_valid = 1'b1;
                fault = FAULT_INVALID_OP;
            end
        end
    end

endmodule
