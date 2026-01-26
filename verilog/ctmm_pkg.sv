// ============================================================================
// CTMM Package - Church-Turing Meta-Machine Hardware Definitions
// ============================================================================
// Implements Kenneth James Hamer-Hodges' capability-based architecture
// with 64-bit Golden Tokens for failsafe security
// ============================================================================

package ctmm_pkg;

    // ========================================================================
    // Golden Token (GT) Structure - 64-bit capability key (Word 0 of CR)
    // ========================================================================
    // Bits [31:0]  - Offset: Index into Namespace Table
    // Bits [47:32] - Spare: Reserved for future use
    // Bits [63:48] - Permissions: 16-bit permission flags
    // ========================================================================
    
    // Permission bit positions
    typedef enum logic [3:0] {
        PERM_R = 4'd0,   // Read - load data from object
        PERM_W = 4'd1,   // Write - store data to object
        PERM_X = 4'd2,   // Execute - load code into CR7 (Nucleus)
        PERM_L = 4'd3,   // Load - copy capability from C-List
        PERM_S = 4'd4,   // Save/Store - store capability to C-List
        PERM_E = 4'd5,   // Enter - switch namespace or call procedure
        PERM_B = 4'd6,   // Bind - save token to namespace DNA
        PERM_M = 4'd7,   // Meta-Machine - hardware-level access
        PERM_F = 4'd8,   // Far - remote URL location
        PERM_G = 4'd9    // Garbage - deterministic GC flag
    } perm_bit_t;
    
    // Permission masks
    localparam logic [15:0] PERM_MASK_R = 16'h0001;
    localparam logic [15:0] PERM_MASK_W = 16'h0002;
    localparam logic [15:0] PERM_MASK_X = 16'h0004;
    localparam logic [15:0] PERM_MASK_L = 16'h0008;
    localparam logic [15:0] PERM_MASK_S = 16'h0010;
    localparam logic [15:0] PERM_MASK_E = 16'h0020;
    localparam logic [15:0] PERM_MASK_B = 16'h0040;
    localparam logic [15:0] PERM_MASK_M = 16'h0080;
    localparam logic [15:0] PERM_MASK_F = 16'h0100;
    localparam logic [15:0] PERM_MASK_G = 16'h0200;
    
    // Data permission category (R, W, X)
    localparam logic [15:0] DATA_PERMS = PERM_MASK_R | PERM_MASK_W | PERM_MASK_X;
    
    // Capability permission category (L, S, E, B)
    localparam logic [15:0] CAP_PERMS = PERM_MASK_L | PERM_MASK_S | PERM_MASK_E | PERM_MASK_B;
    
    // Meta permission category (M, F, G)
    localparam logic [15:0] META_PERMS = PERM_MASK_M | PERM_MASK_F | PERM_MASK_G;
    
    // Golden Token structure (Word 0)
    typedef struct packed {
        logic [15:0] perms;     // Bits [63:48] - Permission flags
        logic [15:0] spare;     // Bits [47:32] - Reserved
        logic [31:0] offset;    // Bits [31:0]  - Namespace offset
    } golden_token_t;
    
    // Null Golden Token (all zeros)
    localparam golden_token_t GT_NULL = '{perms: 16'h0000, spare: 16'h0000, offset: 32'h0000};
    
    // ========================================================================
    // Capability Register (CR) Structure - 4 x 64-bit words (256 bits)
    // ========================================================================
    // Word 0: Golden Token (Permissions + Offset)
    // Word 1: Location - Physical address/base pointer
    // Word 2: Limit - Size/bounds for access checking  
    // Word 3: Seals/MAC - Security validation hash
    // ========================================================================
    
    typedef struct packed {
        logic [63:0] word3_seals;    // Word 3: MAC/Seals for validation
        logic [63:0] word2_limit;    // Word 2: Size limit for bounds checking
        logic [63:0] word1_location; // Word 1: Physical location/base address
        golden_token_t word0_gt;     // Word 0: Golden Token (64 bits)
    } capability_reg_t;
    
    // Null Capability Register (all zeros)
    localparam capability_reg_t CR_NULL = '{
        word3_seals: 64'h0,
        word2_limit: 64'h0,
        word1_location: 64'h0,
        word0_gt: GT_NULL
    };
    
    // Number of Capability Registers
    localparam int NUM_CAP_REGS = 16;
    
    // Special Capability Register indices
    localparam logic [3:0] CR_CLIST     = 4'd6;   // CR6: Current C-List
    localparam logic [3:0] CR_NUCLEUS   = 4'd7;   // CR7: Nucleus (kernel)
    localparam logic [3:0] CR_THREAD    = 4'd8;   // CR8: Thread identity
    localparam logic [3:0] CR_NAMESPACE = 4'd15;  // CR15: Namespace root
    
    // ========================================================================
    // Namespace Entry - 3-word descriptor (192 bits) in memory
    // ========================================================================
    // Word 1: Location - physical address/pointer
    // Word 2: Limit - size/bounds for access checking
    // Word 3: Seals/MAC - security validation hash
    // ========================================================================
    
    typedef struct packed {
        logic [63:0] word3_seals;    // MAC/Seals for validation
        logic [63:0] word2_limit;    // Size limit for bounds checking
        logic [63:0] word1_location; // Physical location
    } namespace_entry_t;
    
    // ========================================================================
    // Condition Codes (ARM-style)
    // ========================================================================
    
    typedef struct packed {
        logic N;  // Negative
        logic Z;  // Zero
        logic C;  // Carry
        logic V;  // Overflow
    } condition_flags_t;
    
    // Condition code encodings
    typedef enum logic [3:0] {
        COND_EQ = 4'b0000,  // Equal (Z=1)
        COND_NE = 4'b0001,  // Not Equal (Z=0)
        COND_CS = 4'b0010,  // Carry Set (C=1)
        COND_CC = 4'b0011,  // Carry Clear (C=0)
        COND_MI = 4'b0100,  // Minus/Negative (N=1)
        COND_PL = 4'b0101,  // Plus/Positive (N=0)
        COND_VS = 4'b0110,  // Overflow Set (V=1)
        COND_VC = 4'b0111,  // Overflow Clear (V=0)
        COND_HI = 4'b1000,  // Higher (C=1 and Z=0)
        COND_LS = 4'b1001,  // Lower or Same (C=0 or Z=1)
        COND_GE = 4'b1010,  // Greater or Equal (N=V)
        COND_LT = 4'b1011,  // Less Than (N!=V)
        COND_GT = 4'b1100,  // Greater Than (Z=0 and N=V)
        COND_LE = 4'b1101,  // Less or Equal (Z=1 or N!=V)
        COND_AL = 4'b1110,  // Always
        COND_NV = 4'b1111   // Never (reserved)
    } cond_code_t;
    
    // ========================================================================
    // Church Instructions (Capability Operations)
    // ========================================================================
    
    typedef enum logic [5:0] {
        OP_LOAD   = 6'b000001,  // Load capability from C-List
        OP_SAVE   = 6'b000010,  // Save capability to C-List
        OP_CALL   = 6'b000011,  // Call procedure via capability
        OP_RETURN = 6'b000100,  // Return from procedure
        OP_CHANGE = 6'b000101,  // Change thread identity
        OP_SWITCH = 6'b000110,  // Switch namespace
        OP_TPERM  = 6'b000111   // Test permissions
    } church_opcode_t;
    
    // ========================================================================
    // Turing Instructions (Data Operations)
    // ========================================================================
    
    typedef enum logic [5:0] {
        OP_MOV    = 6'b010000,  // Move data
        OP_ADD    = 6'b010001,  // Add
        OP_SUB    = 6'b010010,  // Subtract
        OP_MUL    = 6'b010011,  // Multiply
        OP_DIV    = 6'b010100,  // Divide
        OP_AND    = 6'b010101,  // Bitwise AND
        OP_ORR    = 6'b010110,  // Bitwise OR
        OP_EOR    = 6'b010111,  // Bitwise XOR
        OP_LSL    = 6'b011000,  // Logical Shift Left
        OP_LSR    = 6'b011001,  // Logical Shift Right
        OP_ASR    = 6'b011010,  // Arithmetic Shift Right
        OP_CMP    = 6'b011011,  // Compare
        OP_TST    = 6'b011100,  // Test bits
        OP_B      = 6'b100000,  // Branch
        OP_BL     = 6'b100001   // Branch with Link
    } turing_opcode_t;
    
    // ========================================================================
    // Fault Types
    // ========================================================================
    
    typedef enum logic [3:0] {
        FAULT_NONE        = 4'h0,
        FAULT_PERM_R      = 4'h1,  // Read permission denied
        FAULT_PERM_W      = 4'h2,  // Write permission denied
        FAULT_PERM_X      = 4'h3,  // Execute permission denied
        FAULT_PERM_L      = 4'h4,  // Load permission denied
        FAULT_PERM_S      = 4'h5,  // Save permission denied
        FAULT_PERM_E      = 4'h6,  // Enter permission denied
        FAULT_PERM_M      = 4'h7,  // Meta permission denied
        FAULT_NULL_CAP    = 4'h8,  // Null capability access
        FAULT_BOUNDS      = 4'h9,  // Bounds check failed
        FAULT_MAC         = 4'hA,  // MAC validation failed
        FAULT_INVALID_OP  = 4'hB   // Invalid opcode
    } fault_type_t;
    
    // ========================================================================
    // Boot Sequence States
    // ========================================================================
    
    typedef enum logic [2:0] {
        BOOT_IDLE       = 3'd0,
        BOOT_FAULT_RST  = 3'd1,  // Step 1: Clear all registers
        BOOT_LOAD_NS    = 3'd2,  // Step 2: Load namespace into CR15
        BOOT_INIT_THRD  = 3'd3,  // Step 3: Initialize thread in CR8
        BOOT_LOAD_NUC   = 3'd4,  // Step 4: Load nucleus
        BOOT_COMPLETE   = 3'd5
    } boot_state_t;
    
    // ========================================================================
    // LOAD Instruction Microcode States
    // ========================================================================
    // LOAD CRd, [CRn + Index]
    // Fetches a capability from the C-List pointed to by CRn at Index
    // and loads it into destination register CRd
    // ========================================================================
    
    typedef enum logic [3:0] {
        LOAD_IDLE       = 4'd0,   // Waiting for LOAD instruction
        LOAD_FETCH_SRC  = 4'd1,   // Step 1: Read source CR (CRn) to get C-List pointer
        LOAD_CHECK_L    = 4'd2,   // Step 2: Check L permission on CRn
        LOAD_CALC_ADDR  = 4'd3,   // Step 3: Calculate address: CRn.Location + (Index * 32)
        LOAD_CHECK_BOUNDS=4'd4,   // Step 4: Check Index < CRn.Limit
        LOAD_FETCH_W0   = 4'd5,   // Step 5: Fetch Word 0 (GT) from memory
        LOAD_FETCH_W1   = 4'd6,   // Step 6: Fetch Word 1 (Location) from memory
        LOAD_FETCH_W2   = 4'd7,   // Step 7: Fetch Word 2 (Limit) from memory
        LOAD_FETCH_W3   = 4'd8,   // Step 8: Fetch Word 3 (Seals) from memory
        LOAD_CHECK_MAC  = 4'd9,   // Step 9: Validate MAC (Seals vs calculated hash)
        LOAD_RESET_G    = 4'd10,  // Step 10: Reset G bit if namespace access (M or L set)
        LOAD_WRITE_DST  = 4'd11,  // Step 11: Write all 4 words to destination CRd
        LOAD_COMPLETE   = 4'd12,  // Step 12: Instruction complete, advance NIA
        LOAD_FAULT      = 4'd13   // Fault occurred - transfer to fault handler
    } load_state_t;

endpackage
