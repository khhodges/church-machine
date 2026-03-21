// ============================================================================
// CTMM mLoad - Shared Micro-Routine for Capability Fetching
// ============================================================================
// Trusted micro-routine used by all Church instructions that fetch a capability
// from a C-List: LOAD, CALL, RETURN, CHANGE, SWITCH.
//
// Sequence:
//   1. (optional) Check CRn has L permission and not null
//   2. Check bounds: index < CRn.word2_limit[15:0]
//   3. Fetch GT (32 bits) from CRn[index] in C-List memory
//   4. Check GT.slot_id < CR15.word2_limit[15:0]  (namespace bounds)
//   5. Fetch word1_location from NS[slot_id]
//   6. Fetch word2_limit    from NS[slot_id] + 4
//   7. Fetch word3_seals    from NS[slot_id] + 8
//   8. Validate: GT.gt_seq == seals.gt_seq  (version check)
//   9. Validate: CRC-16/CCITT(location, limit) == seals.seal
//  10. Reset G-bit in namespace entry if set
//  11. Write result capability to CRd
// ============================================================================

module ctmm_mload
    import ctmm_pkg::*;
(
    input  logic        clk,
    input  logic        rst_n,

    // Subroutine interface
    input  logic        sub_start,
    input  logic [3:0]  sub_cr_src,
    input  logic [3:0]  sub_cr_dst,
    input  logic [15:0] sub_index,
    input  logic        sub_direct,       // Direct GT mode (skip C-List fetch)
    input  logic [31:0] sub_direct_gt,    // GT value when sub_direct=1
    input  logic        sub_m_elevated,   // Bypass L perm check if set
    output logic        sub_busy,
    output logic        sub_done,
    output logic        sub_fault,
    output fault_type_t sub_fault_type,

    // Capability register interfaces
    output logic [3:0]      cr_rd_addr,
    input  capability_reg_t cr_rd_data,
    output logic [3:0]      cr_wr_addr,
    output capability_reg_t cr_wr_data,
    output logic            cr_wr_en,

    // CR15 (Namespace)
    input  capability_reg_t cr15_namespace,

    // Memory interface (32-bit words)
    output logic [31:0] mem_addr,
    output logic        mem_rd_en,
    input  logic [31:0] mem_rd_data,
    input  logic        mem_rd_valid,

    // Thread update interface
    output logic        thread_wr_en,
    output logic [3:0]  thread_wr_idx,
    output logic [31:0] thread_wr_data
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
        SUB_FETCH_LOC,
        SUB_FETCH_LIMIT,
        SUB_FETCH_SEALS,
        SUB_CHECK_VERSION,
        SUB_RESET_G,
        SUB_UPDATE_THREAD,
        SUB_COMPLETE,
        SUB_FAULT
    } sub_state_t;

    sub_state_t state, next_state;

    // ========================================================================
    // Latched operands and result capability
    // ========================================================================

    logic [3:0]      cr_src_reg;
    logic [3:0]      cr_dst_reg;
    logic [15:0]     index_reg;
    logic            direct_mode;
    logic [31:0]     direct_gt_reg;
    logic            m_elevated;
    capability_reg_t src_cap;
    capability_reg_t result_cap;
    fault_type_t     fault_type_reg;

    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            cr_src_reg    <= 4'd0;
            cr_dst_reg    <= 4'd0;
            index_reg     <= 16'd0;
            direct_mode   <= 1'b0;
            direct_gt_reg <= 32'd0;
            m_elevated    <= 1'b0;
            fault_type_reg <= FAULT_NONE;
        end else begin
            if (state == SUB_IDLE && sub_start) begin
                cr_src_reg    <= sub_cr_src;
                cr_dst_reg    <= sub_cr_dst;
                index_reg     <= sub_index;
                direct_mode   <= sub_direct;
                direct_gt_reg <= sub_direct_gt;
                m_elevated    <= sub_m_elevated;
                fault_type_reg <= FAULT_NONE;
            end
            // Fault capture
            if (state == SUB_CHECK_L) begin
                if (src_is_null)        fault_type_reg <= FAULT_NULL_CAP;
                else if (!has_l_perm)   fault_type_reg <= FAULT_PERM_L;
            end
            if (state == SUB_CHECK_BOUNDS && !bounds_ok)
                fault_type_reg <= FAULT_BOUNDS;
            if (state == SUB_CHECK_NS && !ns_bounds_ok)
                fault_type_reg <= FAULT_BOUNDS;
            if (state == SUB_CHECK_VERSION) begin
                if (!gt_seq_match) fault_type_reg <= FAULT_VERSION;
                else if (!seal_ok) fault_type_reg <= FAULT_SEAL;
            end
        end
    end

    // ========================================================================
    // Source capability latching
    // ========================================================================

    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n)
            src_cap <= CR_NULL;
        else if (state == SUB_FETCH_SRC)
            src_cap <= cr_rd_data;
    end

    // ========================================================================
    // Result capability building
    // ========================================================================

    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            result_cap <= CR_NULL;
        end else begin
            case (state)
                SUB_IDLE:
                    result_cap <= CR_NULL;
                SUB_FETCH_SRC:
                    if (direct_mode)
                        result_cap.word0_gt <= direct_gt_reg;
                SUB_FETCH_W0:
                    if (mem_rd_valid) result_cap.word0_gt <= mem_rd_data;
                SUB_FETCH_LOC:
                    if (mem_rd_valid) result_cap.word1_location <= mem_rd_data;
                SUB_FETCH_LIMIT:
                    if (mem_rd_valid) result_cap.word2_limit <= mem_rd_data;
                SUB_FETCH_SEALS:
                    if (mem_rd_valid) result_cap.word3_seals <= mem_rd_data;
                default: ;
            endcase
        end
    end

    // ========================================================================
    // Permission and bounds checks
    // ========================================================================

    logic has_l_perm;
    logic src_is_null;
    logic bounds_ok;
    logic ns_bounds_ok;

    assign has_l_perm   = src_cap.word0_gt.perms[PERM_L];
    assign src_is_null  = (src_cap.word0_gt.gt_type == GT_TYPE_NULL);
    assign bounds_ok    = (index_reg < src_cap.word2_limit[15:0]);
    assign ns_bounds_ok = (result_cap.word0_gt.slot_id < cr15_namespace.word2_limit[15:0]);

    // ========================================================================
    // CList address: base + index*4 (32-bit word addressed)
    // ========================================================================

    logic [31:0] clist_gt_addr;
    assign clist_gt_addr = src_cap.word1_location + {14'h0, index_reg, 2'b00};

    // ========================================================================
    // Namespace entry address: base + slot_id*12
    // ========================================================================

    logic [31:0] ns_entry_addr;
    assign ns_entry_addr = cr15_namespace.word1_location +
                           {16'h0, result_cap.word0_gt.slot_id} * 32'd12;

    // ========================================================================
    // CRC-16/CCITT over word1_location + word2_limit (64 bits, MSB first)
    // ========================================================================
    // Combinational 64-stage unrolled CRC for seal validation

    logic [15:0] crc_stage [0:64];
    genvar gi;
    assign crc_stage[0] = CRC16_INIT;
    generate
        for (gi = 0; gi < 64; gi++) begin : crc_loop
            logic data_bit;
            logic top_bit;
            logic [15:0] shifted;
            if (gi < 32) begin
                assign data_bit = result_cap.word1_location[31 - gi];
            end else begin
                assign data_bit = result_cap.word2_limit[63 - gi];
            end
            assign top_bit = crc_stage[gi][15] ^ data_bit;
            assign shifted  = {crc_stage[gi][14:0], 1'b0};
            assign crc_stage[gi+1] = shifted ^ (top_bit ? CRC16_POLY : 16'h0000);
        end
    endgenerate

    logic gt_seq_match;
    logic seal_ok;
    seals_t seals_view;
    assign seals_view   = result_cap.word3_seals;
    assign gt_seq_match = (result_cap.word0_gt.gt_seq == seals_view.gt_seq);
    assign seal_ok      = (crc_stage[64] == seals_view.seal);

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
                if (sub_start) next_state = SUB_FETCH_SRC;

            SUB_FETCH_SRC:
                next_state = direct_mode ? SUB_CHECK_NS : SUB_CHECK_L;

            SUB_CHECK_L:
                if (src_is_null || (!has_l_perm && !m_elevated))
                    next_state = SUB_FAULT;
                else
                    next_state = SUB_CHECK_BOUNDS;

            SUB_CHECK_BOUNDS:
                next_state = bounds_ok ? SUB_FETCH_W0 : SUB_FAULT;

            SUB_FETCH_W0:
                if (mem_rd_valid) next_state = SUB_CHECK_NS;

            SUB_CHECK_NS:
                next_state = ns_bounds_ok ? SUB_FETCH_LOC : SUB_FAULT;

            SUB_FETCH_LOC:
                if (mem_rd_valid) next_state = SUB_FETCH_LIMIT;

            SUB_FETCH_LIMIT:
                if (mem_rd_valid) next_state = SUB_FETCH_SEALS;

            SUB_FETCH_SEALS:
                if (mem_rd_valid) next_state = SUB_CHECK_VERSION;

            SUB_CHECK_VERSION:
                if (!gt_seq_match || !seal_ok)
                    next_state = SUB_FAULT;
                else
                    next_state = SUB_RESET_G;

            SUB_RESET_G:
                next_state = SUB_UPDATE_THREAD;

            SUB_UPDATE_THREAD:
                next_state = SUB_COMPLETE;

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

    // Register read address
    assign cr_rd_addr = cr_src_reg;

    // Register write: direct to destination on completion
    assign cr_wr_addr = cr_dst_reg;
    always_comb begin
        cr_wr_data          = result_cap;
        cr_wr_data.word0_gt.b_flag = 1'b0;  // Always clear B on load
    end
    assign cr_wr_en = (state == SUB_COMPLETE);

    // Memory interface
    always_comb begin
        mem_addr = 32'h0;
        mem_rd_en = 1'b0;
        case (state)
            SUB_FETCH_W0:     begin mem_addr = clist_gt_addr;     mem_rd_en = 1'b1; end
            SUB_FETCH_LOC:    begin mem_addr = ns_entry_addr;     mem_rd_en = 1'b1; end
            SUB_FETCH_LIMIT:  begin mem_addr = ns_entry_addr + 4; mem_rd_en = 1'b1; end
            SUB_FETCH_SEALS:  begin mem_addr = ns_entry_addr + 8; mem_rd_en = 1'b1; end
            default: ;
        endcase
    end

    // Thread update: write GT (B=0) to thread slot
    assign thread_wr_en   = (state == SUB_UPDATE_THREAD) && (cr_dst_reg <= 4'd7);
    assign thread_wr_idx  = cr_dst_reg;
    always_comb begin
        thread_wr_data = result_cap.word0_gt;
        thread_wr_data[31] = 1'b0;  // Clear B flag
    end

endmodule
