// ============================================================================
// CTMM CLOAD — Code Load (CR14 + CR6 Rebuild)
// ============================================================================
// SystemVerilog equivalent of hardware/cload.py.
//
// Takes an original Mint-issued E-GT (32-bit Word 0 only), validates it
// against the NS table, then writes the transient capabilities:
//
//     CR14 — code capability  (X-only, M=1, B=0)
//     CR6  — c-list capability (original E-GT in W0, reduced view in W1–W3)
//
// CALL target type acceptance matrix (matches simulator.js lines 1616-1619):
//     GT_TYPE_NULL     (0) → REJECT  (fault PERM_E)
//     GT_TYPE_INFORM   (1) → ACCEPT  (concrete lump)
//     GT_TYPE_OUTFORM  (2) → REJECT  (fault PERM_E)
//     GT_TYPE_ABSTRACT (3) → ACCEPT  (PassKey / value)
//
// FSM: IDLE → CHECK_TYPE → NS_FETCH_LOC → NS_FETCH_W2 → NS_FETCH_W3
//           → NS_CHECK_VER → FETCH_HDR → WRITE_CR14 → WRITE_CR6 → DONE
//           → FAULT (any error)
//
// Callers:
//     CALL   — e_gt latched from Phase 1 mLoad (c-list slot Word 0)
//     RETURN — e_gt read from Mem[thread_base + (STO-1)×4]
//     CHANGE — e_gt read from Zone 1 slot 6 of incoming thread lump
// ============================================================================

module ctmm_cload
    import ctmm_pkg::*;
(
    input  logic        clk,
    input  logic        rst_n,

    input  logic        cload_start,
    output logic        cload_busy,
    output logic        cload_done,
    output logic        cload_fault,
    output fault_type_t cload_fault_type,

    input  logic [31:0] e_gt,

    input  capability_reg_t cr15_namespace,

    output logic [3:0]       cr_wr_addr,
    output capability_reg_t  cr_wr_data,
    output logic             cr_wr_en,

    output logic [31:0] mem_addr,
    output logic        mem_rd_en,
    input  logic [31:0] mem_rd_data,
    input  logic        mem_rd_valid
);

    // ========================================================================
    // State Machine
    // ========================================================================

    typedef enum logic [3:0] {
        CL_IDLE,
        CL_CHECK_TYPE,
        CL_NS_FETCH_LOC,
        CL_NS_FETCH_W2,
        CL_NS_FETCH_W3,
        CL_NS_CHECK_VER,
        CL_FETCH_HDR,
        CL_WRITE_CR14,
        CL_WRITE_CR6,
        CL_DONE,
        CL_FAULT
    } cload_state_t;

    cload_state_t state, next_state;

    // ========================================================================
    // Latched Registers
    // ========================================================================

    logic [31:0]   e_gt_latched;
    golden_token_t e_gt_view;
    assign e_gt_view = e_gt_latched;

    fault_type_t fault_type_reg;

    logic [31:0] raw_base;
    logic [31:0] raw_w2;
    logic [31:0] raw_w3;

    logic [7:0]  cc_reg;
    logic [12:0] cw_reg;
    logic [3:0]  n_minus_6_reg;
    logic [14:0] lump_size_reg;

    // ========================================================================
    // Type Validation
    // ========================================================================
    // CALL target type acceptance matrix (matches simulator.js lines 1616-1619):
    //   GT_TYPE_NULL     (0) → REJECT  (fault PERM_E)
    //   GT_TYPE_INFORM   (1) → ACCEPT  (concrete lump)
    //   GT_TYPE_OUTFORM  (2) → REJECT  (fault PERM_E)
    //   GT_TYPE_ABSTRACT (3) → ACCEPT  (PassKey / value)

    logic is_valid_type;
    assign is_valid_type = (e_gt_view.gt_type == GT_TYPE_INFORM) |
                           (e_gt_view.gt_type == GT_TYPE_ABSTRACT);

    logic has_e_perm;
    assign has_e_perm = e_gt_view.perms[PERM_E];

    // ========================================================================
    // NS Entry Address (3-word entries, stride = 12 bytes)
    // ========================================================================

    logic [31:0] ns_entry_addr;
    assign ns_entry_addr = cr15_namespace.word1_location +
                           ({16'h0, e_gt_view.slot_id} * 32'd12);

    logic ns_bounds_ok;
    assign ns_bounds_ok = (e_gt_view.slot_id < cr15_namespace.word2_w2.limit_offset[15:0]);

    // ========================================================================
    // Version / Seal Check
    // ========================================================================

    word2_t raw_w2_view;
    assign raw_w2_view = raw_w2;

    word3_t raw_w3_view;
    assign raw_w3_view = raw_w3;

    logic gt_seq_match;
    assign gt_seq_match = (e_gt_view.gt_seq == raw_w2_view.gt_seq);

    // CRC-16/CCITT over GT[24:0] + NS_location + NS_word1_w2 (89 bits, MSB first)
    logic [15:0] crc_stage [0:89];
    genvar gi;
    assign crc_stage[0] = CRC16_INIT;
    generate
        for (gi = 0; gi < 89; gi++) begin : crc_loop
            logic data_bit;
            logic top_bit;
            logic [15:0] shifted;

            if (gi < 25)
                assign data_bit = e_gt_latched[24 - gi];
            else if (gi < 57)
                assign data_bit = raw_base[56 - gi];
            else
                assign data_bit = raw_w2[88 - gi];

            assign top_bit = crc_stage[gi][15];
            assign shifted = {crc_stage[gi][14:0], 1'b0};
            assign crc_stage[gi+1] = (top_bit ^ data_bit) ? (shifted ^ CRC16_POLY) : shifted;
        end
    endgenerate

    logic seal_ok;
    assign seal_ok = (crc_stage[89] == raw_w3_view.crc);

    // ========================================================================
    // Lump header decode
    // ========================================================================

    lump_header_t hdr_view;
    assign hdr_view = mem_rd_data;

    // ========================================================================
    // CR14 build (X-only, B=0)
    // ========================================================================

    capability_reg_t cr14_out;
    always_comb begin
        cr14_out.word0_gt.slot_id = e_gt_view.slot_id;
        cr14_out.word0_gt.gt_seq  = e_gt_view.gt_seq;
        cr14_out.word0_gt.gt_type = e_gt_view.gt_type;
        cr14_out.word0_gt.perms   = PERM_MASK_X;
        cr14_out.word0_gt.b_flag  = 1'b0;
        cr14_out.word1_location   = raw_base + 32'd4;
        cr14_out.word2_w2.limit_offset = {8'd0, cw_reg} - 21'd1;
        cr14_out.word2_w2.gt_seq  = e_gt_view.gt_seq;
        cr14_out.word2_w2.spare   = 4'd0;
        cr14_out.word3_w3         = raw_w3;
    end

    // ========================================================================
    // CR6 build (original E-GT in W0, c-list view)
    // ========================================================================

    capability_reg_t cr6_out;
    always_comb begin
        cr6_out.word0_gt          = e_gt_latched;
        cr6_out.word1_location    = raw_base + (({17'd0, lump_size_reg} - {7'd0, cc_reg}) << 2);
        cr6_out.word2_w2.limit_offset = {13'd0, cc_reg} - 21'd1;
        cr6_out.word2_w2.gt_seq   = e_gt_view.gt_seq;
        cr6_out.word2_w2.spare    = 4'd0;
        cr6_out.word3_w3          = raw_w3;
    end

    // ========================================================================
    // State Register
    // ========================================================================

    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) state <= CL_IDLE;
        else        state <= next_state;
    end

    // ========================================================================
    // Datapath Registers
    // ========================================================================

    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            e_gt_latched   <= 32'd0;
            raw_base       <= 32'd0;
            raw_w2         <= 32'd0;
            raw_w3         <= 32'd0;
            cc_reg         <= 8'd0;
            cw_reg         <= 13'd0;
            n_minus_6_reg  <= 4'd0;
            lump_size_reg  <= 15'd0;
            fault_type_reg <= FAULT_NONE;
        end else begin
            case (state)
                CL_IDLE: begin
                    if (cload_start) begin
                        e_gt_latched   <= e_gt;
                        raw_base       <= 32'd0;
                        raw_w2         <= 32'd0;
                        raw_w3         <= 32'd0;
                        cc_reg         <= 8'd0;
                        cw_reg         <= 13'd0;
                        n_minus_6_reg  <= 4'd0;
                        lump_size_reg  <= 15'd0;
                        fault_type_reg <= FAULT_NONE;
                    end
                end

                CL_CHECK_TYPE: begin
                    if (!is_valid_type || !has_e_perm)
                        fault_type_reg <= FAULT_PERM_E;
                    else if (!ns_bounds_ok)
                        fault_type_reg <= FAULT_BOUNDS;
                end

                CL_NS_FETCH_LOC: begin
                    if (mem_rd_valid)
                        raw_base <= mem_rd_data;
                end

                CL_NS_FETCH_W2: begin
                    if (mem_rd_valid)
                        raw_w2 <= mem_rd_data;
                end

                CL_NS_FETCH_W3: begin
                    if (mem_rd_valid)
                        raw_w3 <= mem_rd_data;
                end

                CL_NS_CHECK_VER: begin
                    if (!gt_seq_match)
                        fault_type_reg <= FAULT_VERSION;
                    else if (!seal_ok)
                        fault_type_reg <= FAULT_SEAL;
                end

                CL_FETCH_HDR: begin
                    if (mem_rd_valid) begin
                        cc_reg        <= hdr_view.cc;
                        cw_reg        <= hdr_view.cw;
                        n_minus_6_reg <= hdr_view.n_minus_6;
                        lump_size_reg <= 15'd1 << (hdr_view.n_minus_6 + 4'd6);
                    end
                end

                default: ;
            endcase
        end
    end

    // ========================================================================
    // Next State Logic
    // ========================================================================

    always_comb begin
        next_state = state;
        case (state)
            CL_IDLE:
                if (cload_start) next_state = CL_CHECK_TYPE;

            CL_CHECK_TYPE:
                if (!is_valid_type || !has_e_perm || !ns_bounds_ok)
                    next_state = CL_FAULT;
                else
                    next_state = CL_NS_FETCH_LOC;

            CL_NS_FETCH_LOC:
                if (mem_rd_valid) next_state = CL_NS_FETCH_W2;

            CL_NS_FETCH_W2:
                if (mem_rd_valid) next_state = CL_NS_FETCH_W3;

            CL_NS_FETCH_W3:
                if (mem_rd_valid) next_state = CL_NS_CHECK_VER;

            CL_NS_CHECK_VER:
                if (!gt_seq_match || !seal_ok)
                    next_state = CL_FAULT;
                else
                    next_state = CL_FETCH_HDR;

            CL_FETCH_HDR:
                if (mem_rd_valid) next_state = CL_WRITE_CR14;

            CL_WRITE_CR14:
                next_state = CL_WRITE_CR6;

            CL_WRITE_CR6:
                next_state = CL_DONE;

            CL_DONE:
                next_state = CL_IDLE;

            CL_FAULT:
                next_state = CL_IDLE;

            default: next_state = CL_IDLE;
        endcase
    end

    // ========================================================================
    // Output Logic
    // ========================================================================

    assign cload_busy       = (state != CL_IDLE);
    assign cload_done       = (state == CL_DONE);
    assign cload_fault      = (state == CL_FAULT);
    assign cload_fault_type = fault_type_reg;

    always_comb begin
        cr_wr_addr = 4'd0;
        cr_wr_data = CR_NULL;
        cr_wr_en   = 1'b0;
        mem_addr   = 32'd0;
        mem_rd_en  = 1'b0;

        case (state)
            CL_NS_FETCH_LOC: begin
                mem_addr  = ns_entry_addr;
                mem_rd_en = 1'b1;
            end

            CL_NS_FETCH_W2: begin
                mem_addr  = ns_entry_addr + 32'd4;
                mem_rd_en = 1'b1;
            end

            CL_NS_FETCH_W3: begin
                mem_addr  = ns_entry_addr + 32'd8;
                mem_rd_en = 1'b1;
            end

            CL_FETCH_HDR: begin
                mem_addr  = raw_base;
                mem_rd_en = 1'b1;
            end

            CL_WRITE_CR14: begin
                cr_wr_addr = CR_CLOOMC;
                cr_wr_data = cr14_out;
                cr_wr_en   = 1'b1;
            end

            CL_WRITE_CR6: begin
                cr_wr_addr = CR_CLIST;
                cr_wr_data = (cc_reg == 8'd0) ? CR_NULL : cr6_out;
                cr_wr_en   = 1'b1;
            end

            default: ;
        endcase
    end

endmodule
