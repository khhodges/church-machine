// ============================================================================
// CTMM mSave Micro-Routine - Shared Trusted Code for GT Saving
// ============================================================================
// Single trusted microcode for all GT saving operations.
//
// mSave Steps:
//   Step 1: Verify destination has B (Bind) flag set
//   Step 2: Verify destination has S (Save) permission
//   Step 3: Verify index < destination.word2_w2.limit_offset[15:0]  (CAP_REG word2_w2)
//   Step 4: Validate source GT against 3 words of NS entry:
//             word0_location (+0)  : code base address (32 bits)
//             word1_w2       (+4)  : limit_offset[20:0] | gt_seq[6:0] | spare[3:0]
//             word2_w3       (+8)  : crc[15:0] | g_bit | spare[14:0]
//           89-bit CRC over GT[24:0] + location + word1_w2; match against word2_w3.crc
//           gt_seq from word1_w2.gt_seq must match src_gt.gt_seq
//   Step 5: Write GT to Destination.Location + index*4 (32-bit words)
//
// NS entry stride: slot_id * 12 (×12 bytes = 3 words)
//
// FAULT conditions:
//   - Destination lacks B flag (FAULT_BIND)
//   - Destination lacks S permission (FAULT_PERM_S)
//   - index >= limit (FAULT_BOUNDS)
//   - gt_seq mismatch (FAULT_VERSION)
//   - CRC seal mismatch (FAULT_SEAL)
// ============================================================================

module ctmm_msave
    import ctmm_pkg::*;
(
    input  logic        clk,
    input  logic        rst_n,

    // Subroutine interface
    input  logic             sub_start,
    input  capability_reg_t  sub_dst_cap,  // Destination C-List capability
    input  logic [31:0]      sub_src_gt,   // Source Golden Token (32 bits)
    input  logic [15:0]      sub_index,    // C-List index
    output logic             sub_busy,
    output logic             sub_done,
    output logic             sub_fault,
    output fault_type_t      sub_fault_type,

    // CR15 (Namespace) interface
    input  capability_reg_t  cr15_namespace,

    // Memory write interface (32-bit)
    output logic [31:0] mem_wr_addr,
    output logic [31:0] mem_wr_data,
    output logic        mem_wr_en,
    input  logic        mem_wr_done,

    // Memory read interface (for NS entry validation)
    output logic [31:0] mem_rd_addr,
    output logic        mem_rd_en,
    input  logic [31:0] mem_rd_data,
    input  logic        mem_rd_valid
);

    // ========================================================================
    // State Machine
    // ========================================================================

    typedef enum logic [3:0] {
        SUB_IDLE,
        SUB_CHECK_BIND,
        SUB_CHECK_S,
        SUB_CHECK_BOUNDS,
        SUB_FETCH_NS_W0,  // NS +0: location
        SUB_FETCH_NS_W1,  // NS +4: word1_w2 (limit | gt_seq)
        SUB_FETCH_NS_W2,  // NS +8: word2_w3 (crc | g_bit)
        SUB_CHECK_VERSION,
        SUB_WRITE_GT,
        SUB_COMPLETE,
        SUB_FAULT
    } sub_state_t;

    sub_state_t state, next_state;

    // ========================================================================
    // Latched inputs
    // ========================================================================

    capability_reg_t dst_cap_reg;
    golden_token_t   src_gt_reg;
    logic [15:0]     index_reg;
    fault_type_t     fault_type_reg;

    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            dst_cap_reg    <= CR_NULL;
            src_gt_reg     <= GT_NULL;
            index_reg      <= 16'd0;
            fault_type_reg <= FAULT_NONE;
        end else begin
            if (state == SUB_IDLE && sub_start) begin
                dst_cap_reg    <= sub_dst_cap;
                src_gt_reg     <= sub_src_gt;
                index_reg      <= sub_index;
                fault_type_reg <= FAULT_NONE;
            end
            if (state == SUB_CHECK_BIND   && !dst_has_bind)    fault_type_reg <= FAULT_BIND;
            if (state == SUB_CHECK_S      && !dst_has_s_perm)  fault_type_reg <= FAULT_PERM_S;
            if (state == SUB_CHECK_BOUNDS && !index_in_bounds) fault_type_reg <= FAULT_BOUNDS;
            if (state == SUB_CHECK_VERSION) begin
                if (!gt_seq_match) fault_type_reg <= FAULT_VERSION;
                else if (!seal_ok) fault_type_reg <= FAULT_SEAL;
            end
        end
    end

    // ========================================================================
    // Checks
    // ========================================================================

    logic dst_has_bind;
    logic dst_has_s_perm;
    logic index_in_bounds;

    assign dst_has_bind    = dst_cap_reg.word0_gt.b_flag;
    assign dst_has_s_perm  = dst_cap_reg.word0_gt.perms[PERM_S];
    assign index_in_bounds = (index_reg < {11'h0, dst_cap_reg.word2_w2.limit_offset});

    // Write address: base + index*4 (32-bit words)
    logic [31:0] write_addr;
    assign write_addr = dst_cap_reg.word1_location + {14'h0, index_reg, 2'b00};

    // ========================================================================
    // Namespace entry address and 3-word entry validation
    // ========================================================================
    // NS stride: slot_id * 12  (3 words × 4 bytes = 12 bytes per entry)

    logic [31:0] ns_entry_addr;
    assign ns_entry_addr = cr15_namespace.word1_location +
                           ({16'h0, src_gt_reg.slot_id} * 32'd12);

    // NS entry registers (3 words needed for validation):
    //   ns_w0_reg: NS +0  = word0_location (code base address)
    //   ns_w1_reg: NS +4  = word1_w2       (limit_offset[20:0] | gt_seq[6:0] | spare[3:0])
    //   ns_w2_reg: NS +8  = word2_w3       (crc[15:0] | g_bit | spare[14:0])
    logic [31:0] ns_w0_reg;
    logic [31:0] ns_w1_reg;
    logic [31:0] ns_w2_reg;

    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            ns_w0_reg <= 32'd0;
            ns_w1_reg <= 32'd0;
            ns_w2_reg <= 32'd0;
        end else begin
            if (state == SUB_FETCH_NS_W0 && mem_rd_valid) ns_w0_reg <= mem_rd_data;
            if (state == SUB_FETCH_NS_W1 && mem_rd_valid) ns_w1_reg <= mem_rd_data;
            if (state == SUB_FETCH_NS_W2 && mem_rd_valid) ns_w2_reg <= mem_rd_data;
        end
    end

    // 89-bit CRC-16/CCITT over:
    //   Bits  0-24: GT[24:0]   — lower 25 bits of src_gt_reg (the GT being saved)
    //   Bits 25-56: location   — ns_w0_reg (NS +0 = word0_location)
    //   Bits 57-88: word1_w2   — ns_w1_reg (NS +4 = limit | gt_seq)
    logic [15:0] crc_stage [0:89];
    genvar gi;
    assign crc_stage[0] = CRC16_INIT;
    generate
        for (gi = 0; gi < 89; gi++) begin : crc_loop
            logic data_bit;
            logic top_bit;
            logic [15:0] shifted;
            if (gi < 25) begin
                assign data_bit = src_gt_reg[24 - gi];   // GT[24:0], MSB first
            end else if (gi < 57) begin
                assign data_bit = ns_w0_reg[56 - gi];   // location[31:0], MSB first
            end else begin
                assign data_bit = ns_w1_reg[88 - gi];   // word1_w2[31:0], MSB first
            end
            assign top_bit         = crc_stage[gi][15] ^ data_bit;
            assign shifted         = {crc_stage[gi][14:0], 1'b0};
            assign crc_stage[gi+1] = shifted ^ (top_bit ? CRC16_POLY : 16'h0000);
        end
    endgenerate

    // View NS +4 (word1_w2) as word2_t to extract gt_seq
    word2_t ns_w1_view;
    assign ns_w1_view = ns_w1_reg;

    // View NS +8 (word2_w3) as word3_t to extract crc
    word3_t ns_w2_view;
    assign ns_w2_view = ns_w2_reg;

    logic gt_seq_match;
    logic seal_ok;
    assign gt_seq_match = (src_gt_reg.gt_seq == ns_w1_view.gt_seq);
    assign seal_ok      = (crc_stage[89] == ns_w2_view.crc);

    // ========================================================================
    // State Register
    // ========================================================================

    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) state <= SUB_IDLE;
        else        state <= next_state;
    end

    // ========================================================================
    // Next State Logic
    // ========================================================================

    always_comb begin
        next_state = state;
        case (state)
            SUB_IDLE:
                if (sub_start) next_state = SUB_CHECK_BIND;
            SUB_CHECK_BIND:
                next_state = dst_has_bind ? SUB_CHECK_S : SUB_FAULT;
            SUB_CHECK_S:
                next_state = dst_has_s_perm ? SUB_CHECK_BOUNDS : SUB_FAULT;
            SUB_CHECK_BOUNDS:
                next_state = index_in_bounds ? SUB_FETCH_NS_W0 : SUB_FAULT;
            SUB_FETCH_NS_W0:                        // +0: location
                if (mem_rd_valid) next_state = SUB_FETCH_NS_W1;
            SUB_FETCH_NS_W1:                        // +4: word1_w2 (limit | gt_seq)
                if (mem_rd_valid) next_state = SUB_FETCH_NS_W2;
            SUB_FETCH_NS_W2:                        // +8: word2_w3 (crc | gbit)
                if (mem_rd_valid) next_state = SUB_CHECK_VERSION;
            SUB_CHECK_VERSION:
                if (!gt_seq_match || !seal_ok)
                    next_state = SUB_FAULT;
                else
                    next_state = SUB_WRITE_GT;
            SUB_WRITE_GT:
                if (mem_wr_done) next_state = SUB_COMPLETE;
            SUB_COMPLETE:
                next_state = SUB_IDLE;
            SUB_FAULT:
                next_state = SUB_IDLE;
            default: next_state = SUB_IDLE;
        endcase
    end

    // ========================================================================
    // Output Logic
    // ========================================================================

    assign sub_busy       = (state != SUB_IDLE);
    assign sub_done       = (state == SUB_COMPLETE);
    assign sub_fault      = (state == SUB_FAULT);
    assign sub_fault_type = fault_type_reg;

    // Memory read (NS entry validation — 3-word entry, stride ×12)
    // NS layout: +0=location, +4=word1_w2(limit|gt_seq), +8=word2_w3(crc|gbit)
    always_comb begin
        mem_rd_addr = 32'h0;
        mem_rd_en   = 1'b0;
        case (state)
            SUB_FETCH_NS_W0: begin mem_rd_addr = ns_entry_addr;      mem_rd_en = 1'b1; end  // +0: location
            SUB_FETCH_NS_W1: begin mem_rd_addr = ns_entry_addr + 4;  mem_rd_en = 1'b1; end  // +4: word1_w2
            SUB_FETCH_NS_W2: begin mem_rd_addr = ns_entry_addr + 8;  mem_rd_en = 1'b1; end  // +8: word2_w3
            default: ;
        endcase
    end

    // Memory write
    assign mem_wr_en   = (state == SUB_WRITE_GT);
    assign mem_wr_addr = write_addr;
    assign mem_wr_data = src_gt_reg;

endmodule
