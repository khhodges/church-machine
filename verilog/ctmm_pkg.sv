// ============================================================================
// CTMM Package - Church-Turing Meta-Machine Hardware Definitions
// ============================================================================
// Implements Kenneth James Hamer-Hodges' capability-based architecture
// with 32-bit Golden Tokens for failsafe security
// ============================================================================

package ctmm_pkg;

    // ========================================================================
    // Golden Token (GT) Structure - 32-bit capability descriptor (Word 0 of CR)
    // ========================================================================
    // Bits [15:0]  - slot_id: Index into Namespace Table (16 bits)
    // Bits [22:16] - gt_seq:  Generation sequence counter (7 bits)
    // Bits [24:23] - gt_type: Capability type (2 bits)
    // Bits [30:25] - perms:   Permission flags R,W,X,L,S,E (6 bits)
    // Bit  [31]    - b_flag:  Bound flag (sealed to clist entry)
    // ========================================================================

    // Permission bit positions (6-bit GT permission field: R,W,X,L,S,E)
    typedef enum logic [2:0] {
        PERM_R = 3'd0,   // Read - load data from object
        PERM_W = 3'd1,   // Write - store data to object
        PERM_X = 3'd2,   // Execute - load code into CR14
        PERM_L = 3'd3,   // Load - copy capability from C-List
        PERM_S = 3'd4,   // Save/Store - store capability to C-List
        PERM_E = 3'd5    // Enter - switch namespace or call procedure
    } perm_bit_t;

    // Permission masks (6-bit)
    localparam logic [5:0] PERM_MASK_R = 6'b000001;
    localparam logic [5:0] PERM_MASK_W = 6'b000010;
    localparam logic [5:0] PERM_MASK_X = 6'b000100;
    localparam logic [5:0] PERM_MASK_L = 6'b001000;
    localparam logic [5:0] PERM_MASK_S = 6'b010000;
    localparam logic [5:0] PERM_MASK_E = 6'b100000;

    // Data permission category (R, W, X)
    localparam logic [5:0] DATA_PERMS = PERM_MASK_R | PERM_MASK_W | PERM_MASK_X;

    // Capability permission category (L, S, E)
    localparam logic [5:0] CAP_PERMS = PERM_MASK_L | PERM_MASK_S | PERM_MASK_E;

    // GT type encoding
    localparam logic [1:0] GT_TYPE_NULL     = 2'b00;  // NULL/invalid token
    localparam logic [1:0] GT_TYPE_INFORM   = 2'b01;  // Inform (concrete local object)
    localparam logic [1:0] GT_TYPE_OUTFORM  = 2'b10;  // Outform (remote/abstract-library object)
    localparam logic [1:0] GT_TYPE_ABSTRACT = 2'b11;  // Abstract (PassKey/value)

    // Golden Token structure (Word 0) - 32 bits, packed LSB-first
    typedef struct packed {
        logic        b_flag;     // Bit [31]    - Bound flag
        logic [5:0]  perms;      // Bits [30:25] - Permission flags (R,W,X,L,S,E)
        logic [1:0]  gt_type;    // Bits [24:23] - GT type
        logic [6:0]  gt_seq;     // Bits [22:16] - Generation sequence counter
        logic [15:0] slot_id;    // Bits [15:0]  - Namespace slot index
    } golden_token_t;

    // Null Golden Token (all zeros, type=NULL)
    localparam golden_token_t GT_NULL = '{
        b_flag: 1'b0,
        perms:  6'h00,
        gt_type: GT_TYPE_NULL,
        gt_seq:  7'h0,
        slot_id: 16'h0000
    };

    // ========================================================================
    // Word 2 of CR / NS entry - 32 bits
    // ========================================================================
    // Bits [20:0]  - limit_offset: Size/bounds of namespace region (21 bits)
    // Bits [27:21] - gt_seq:       Generation sequence counter (7 bits)
    // Bits [31:28] - spare:        Reserved, must be zero
    // ========================================================================

    typedef struct packed {
        logic [3:0]  spare;        // Bits [31:28] - Reserved
        logic [6:0]  gt_seq;       // Bits [27:21] - GT generation sequence
        logic [20:0] limit_offset; // Bits [20:0]  - Region size/limit
    } word2_t;

    // ========================================================================
    // Word 3 of CR / NS entry - 32 bits
    // ========================================================================
    // Bits [15:0]  - crc:   CRC-16/CCITT over GT[24:0] + word1 + word2 (89 bits)
    // Bit  [16]    - g_bit: GC mark bit (1 = not yet touched since last mark)
    // Bits [31:17] - spare: Reserved, must be zero
    // ========================================================================

    typedef struct packed {
        logic [14:0] spare; // Bits [31:17] - Reserved
        logic        g_bit; // Bit  [16]    - GC mark bit
        logic [15:0] crc;   // Bits [15:0]  - CRC-16/CCITT seal
    } word3_t;

    // CRC-16/CCITT constants (poly=0x1021, init=0xFFFF)
    localparam logic [15:0] CRC16_POLY = 16'h1021;
    localparam logic [15:0] CRC16_INIT = 16'hFFFF;

    // ========================================================================
    // Capability Register (CR) Structure - 4 x 32-bit words (128 bits)
    // ========================================================================
    // Word 0: Golden Token (32 bits - permissions, type, sequence, slot)
    // Word 1: Location - Physical address/base pointer (32 bits)
    // Word 2: Limit - Size/bounds for access checking (32 bits)
    // Word 3: Seals - CRC-16 validation (32 bits)
    // ========================================================================

    typedef struct packed {
        word3_t        word3_w3;       // Word 3: GC g_bit + CRC-16 seal
        word2_t        word2_w2;       // Word 2: gt_seq + limit_offset
        logic [31:0]   word1_location; // Word 1: Physical location/base address
        golden_token_t word0_gt;       // Word 0: Golden Token (32 bits)
    } capability_reg_t;

    // Null Capability Register (all zeros)
    localparam capability_reg_t CR_NULL = '{
        word3_w3:       '{spare: 15'h0, g_bit: 1'b0, crc: 16'h0},
        word2_w2:       '{spare: 4'h0, gt_seq: 7'h0, limit_offset: 21'h0},
        word1_location: 32'h0,
        word0_gt:       GT_NULL
    };

    // Number of Capability Registers
    localparam int NUM_CAP_REGS = 16;

    // Special Capability Register indices
    localparam logic [3:0] CR_CLIST     = 4'd6;   // CR6: Current C-List
    localparam logic [3:0] CR_NUCLEUS   = 4'd7;   // CR7: Nucleus (reserved for stack)
    localparam logic [3:0] CR_THREAD    = 4'd8;   // CR8: Suspended Thread State
    localparam logic [3:0] CR_INTERRUPT = 4'd9;   // CR9: Interrupt Thread
    localparam logic [3:0] CR_DFAULT    = 4'd10;  // CR10: Double Fault Recovery Thread
    localparam logic [3:0] CR_CLOOMC    = 4'd14;  // CR14: CLOOMC Code (Function Abstraction)
    localparam logic [3:0] CR_NAMESPACE = 4'd15;  // CR15: Namespace root

    // ========================================================================
    // Namespace Entry - 3 x 32-bit words (96 bits) in memory
    // ========================================================================
    // Word 0 (+0):  word0_location - code base address (32-bit pointer)
    // Word 1 (+4):  word1_w2       - gt_seq[6:0] | limit_offset[20:0]  (WORD2_T)
    // Word 2 (+8):  word2_w3       - spare[14:0] | g_bit | crc[15:0]   (WORD3_T)
    //
    // Stride = slot_id * 12  (12 bytes per entry)
    // The lump header lives at Mem[slot_id × SLOT_SIZE] word 0 — it is NOT
    // a 4th word inside the NS table.
    //
    // CRC-16/CCITT input (89 bits, MSB first):
    //   GT[24:0]  (lower 25 bits of GT word 0, no b_flag/upper perms)
    //   location  (word0_location, 32 bits)
    //   word1_w2  (32 bits)
    // ========================================================================

    typedef struct packed {
        word3_t      word2_w3;       // g_bit + CRC-16 seal
        word2_t      word1_w2;       // gt_seq + limit_offset
        logic [31:0] word0_location; // Code base address
    } namespace_entry_t;

    // Namespace entry stride = 12 bytes (3 x 32-bit words)
    localparam int NS_ENTRY_STRIDE = 12;

    // ========================================================================
    // LUMP Header structure — standalone type for decoding lump header words.
    // MSB-first packed struct matching LUMP_HEADER_LAYOUT in layouts.py.
    //
    // Bits  [7:0]  - cc:        c-list slot count (0..255); for typ=10 thread
    //                           lump repurposed as heapWords (IDE-set max heap)
    // Bits  [9:8]  - typ:       object type: 00=lump 01=data 10=thread 11=outform
    // Bits [22:10] - cw:        code word count (0..8191); for thread lump: sw
    //                           (stack word budget; CALL stack-bound validation)
    // Bits [26:23] - n_minus_6: lumpSize = 2^(val+6); valid 0..8
    // Bits [31:27] - magic:     always 0x1F; traps if executed as instruction
    // ========================================================================

    typedef struct packed {
        logic [4:0]  magic;      // Bits [31:27] — signature; always 0x1F
        logic [3:0]  n_minus_6;  // Bits [26:23] — lumpSize = 2^(val+6)
        logic [12:0] cw;         // Bits [22:10] — code/stack word count
        logic [1:0]  typ;        // Bits  [9:8]  — object type
        logic [7:0]  cc;         // Bits  [7:0]  — c-list slot count / heapWords
    } lump_header_t;

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
    // Instruction Format (Standardized 32-bit)
    // ========================================================================
    // Bits [31:27] - Opcode (5 bits)
    // Bits [26:23] - Condition code (4 bits)
    // Bits [22:0]  - Operands (instruction-specific)
    // ========================================================================

    // ========================================================================
    // Church Instructions (Capability Operations) - 5-bit opcodes
    // ========================================================================

    typedef enum logic [4:0] {
        OP_LOAD        = 5'b00000,   // Load capability from C-List
        OP_SAVE        = 5'b00001,   // Save capability to C-List
        OP_CALL        = 5'b00010,   // Call procedure via E-capability
        OP_RETURN      = 5'b00011,   // Return from procedure
        OP_CHANGE      = 5'b00100,   // Change thread identity
        OP_SWITCH      = 5'b00101,   // Switch namespace
        OP_TPERM       = 5'b00110,   // Transfer/restrict permissions
        OP_LAMBDA      = 5'b00111,   // Bind lambda (mark CR as abstract code)
        OP_ELOADCALL   = 5'b01000,   // Fused ELoad + Call
        OP_XLOADLAMBDA = 5'b01001    // Fused XLoad + Lambda
    } church_opcode_t;

    // ========================================================================
    // Turing Instructions (Data Operations) - 5-bit opcodes
    // ========================================================================

    typedef enum logic [4:0] {
        OP_DREAD  = 5'b10000,   // Data Read
        OP_DWRITE = 5'b10001,   // Data Write
        OP_BFEXT  = 5'b10010,   // Bit Field Extract
        OP_BFINS  = 5'b10011,   // Bit Field Insert
        OP_MCMP   = 5'b10100,   // Memory Compare
        OP_IADD   = 5'b10101,   // Integer Add
        OP_ISUB   = 5'b10110,   // Integer Subtract
        OP_BRANCH = 5'b10111,   // Branch
        OP_SHL    = 5'b11000,   // Shift Left
        OP_SHR    = 5'b11001    // Shift Right
    } turing_opcode_t;

    // ========================================================================
    // TPERM Preset Masks (4-bit code for common permission combinations)
    // ========================================================================

    typedef enum logic [3:0] {
        TPERM_CLEAR  = 4'd0,    // No permissions (revoke all)
        TPERM_R      = 4'd1,    // Read only
        TPERM_RW     = 4'd2,    // Read + Write
        TPERM_X      = 4'd3,    // Execute code only
        TPERM_RX     = 4'd4,    // Read + Execute
        TPERM_RWX    = 4'd5,    // Read + Write + Execute (full data)
        TPERM_L      = 4'd6,    // Load capability
        TPERM_S      = 4'd7,    // Save capability
        TPERM_E      = 4'd8,    // Enter abstraction
        TPERM_LS     = 4'd9,    // Load + Save
        TPERM_RSV3   = 4'd10,   // Reserved — E isolation (LE invalid)
        TPERM_RSV4   = 4'd11,   // Reserved — E isolation (SE invalid)
        TPERM_RSV5   = 4'd12,   // Reserved — E isolation (LSE invalid)
        TPERM_RSV2   = 4'd13,   // Reserved — cross-domain (invalid)
        TPERM_RSV0   = 4'd14,   // RESERVED - causes FAULT
        TPERM_RSV1   = 4'd15    // RESERVED - causes FAULT
    } tperm_preset_t;

    // TPERM preset mask values (actual permission bits to AND with)
    function automatic logic [5:0] get_tperm_mask(tperm_preset_t preset);
        case (preset)
            TPERM_CLEAR:  return 6'b000000;
            TPERM_R:      return PERM_MASK_R;
            TPERM_RW:     return PERM_MASK_R | PERM_MASK_W;
            TPERM_X:      return PERM_MASK_X;
            TPERM_RX:     return PERM_MASK_R | PERM_MASK_X;
            TPERM_RWX:    return PERM_MASK_R | PERM_MASK_W | PERM_MASK_X;
            TPERM_L:      return PERM_MASK_L;
            TPERM_S:      return PERM_MASK_S;
            TPERM_E:      return PERM_MASK_E;
            TPERM_LS:     return PERM_MASK_L | PERM_MASK_S;
            default:      return 6'b000000;  // RSV — E isolation / cross-domain / reserved
        endcase
    endfunction

    // ========================================================================
    // Fault Types
    // ========================================================================

    // 5-bit fault_type_t to accommodate FAULT_STACK_OVERFLOW (0x10) and
    // FAULT_STACK_CORRUPT (0x12) per hardware/hw_types.py FaultType enum.
    typedef enum logic [4:0] {
        FAULT_NONE          = 5'h00,
        FAULT_PERM_R        = 5'h01,  // Read permission denied
        FAULT_PERM_W        = 5'h02,  // Write permission denied
        FAULT_PERM_X        = 5'h03,  // Execute permission denied
        FAULT_PERM_L        = 5'h04,  // Load permission denied
        FAULT_PERM_S        = 5'h05,  // Save permission denied
        FAULT_PERM_E        = 5'h06,  // Enter permission denied
        FAULT_NULL_CAP      = 5'h07,  // Null capability access
        FAULT_BOUNDS        = 5'h08,  // Bounds check failed
        FAULT_VERSION       = 5'h09,  // GT sequence mismatch
        FAULT_SEAL          = 5'h0A,  // CRC-16 seal validation failed
        FAULT_INVALID_OP    = 5'h0B,  // Invalid opcode
        FAULT_TPERM_RSV     = 5'h0C,  // Reserved TPERM code used
        FAULT_DOMAIN_PURITY = 5'h0D,  // Mixed data+capability permissions
        FAULT_BIND          = 5'h0E,  // Bind (B flag) constraint violated
        FAULT_F_BIT         = 5'h0F,  // F flag constraint violated
        FAULT_STACK_OVERFLOW= 5'h10,  // STO < sp_min: stack would overflow zone floor
        FAULT_STACK_CORRUPT = 5'h12   // STO > sp_max: stack pointer corrupted
    } fault_type_t;

    // ========================================================================
    // Boot Sequence States
    // ========================================================================

    typedef enum logic [2:0] {
        BOOT_IDLE       = 3'd0,
        BOOT_FAULT_RST  = 3'd1,  // Step 1: Clear all registers
        BOOT_LOAD_NS    = 3'd2,  // Step 2: Load namespace into CR15
        BOOT_INIT_THRD  = 3'd3,  // Step 3: Initialize thread in CR8
        BOOT_INIT_CLIST = 3'd4,  // Step 4: Initialize C-List in CR6
        BOOT_LOAD_NUC   = 3'd5,  // Step 5: Load nucleus into CR14
        BOOT_COMPLETE   = 3'd6
    } boot_state_t;

endpackage
