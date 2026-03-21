// ============================================================================
// CTMM LOAD Church-Instruction (CLOOMC)
// ============================================================================
// Implements the LOAD instruction by invoking the shared mLoad micro-routine.
// mLoad writes directly to the destination register (single bus transfer).
// ============================================================================

module ctmm_load
    import ctmm_pkg::*;
(
    input  logic        clk,
    input  logic        rst_n,

    // Control interface
    input  logic        load_start,
    input  logic [3:0]  cr_src,
    input  logic [3:0]  cr_dst,
    input  logic [15:0] index,
    output logic        load_busy,
    output logic        load_complete,
    output logic        load_fault,
    output fault_type_t fault_type,

    // Capability register read interface
    output logic [3:0]       cr_rd_addr,
    input  capability_reg_t  cr_rd_data,

    // Capability register write interface
    output logic [3:0]       cr_wr_addr,
    output capability_reg_t  cr_wr_data,
    output logic             cr_wr_en,

    // CR15 (Namespace) interface
    input  capability_reg_t  cr15_namespace,

    // Memory interface (32-bit)
    output logic [31:0] mem_addr,
    output logic        mem_rd_en,
    input  logic [31:0] mem_rd_data,
    input  logic        mem_rd_valid,

    // Thread update interface
    output logic        thread_wr_en,
    output logic [3:0]  thread_wr_idx,
    output logic [31:0] thread_wr_data
);

    typedef enum logic [1:0] {
        LOAD_IDLE,
        LOAD_START_SUB,
        LOAD_WAIT_ACK,
        LOAD_CALL_SUB
    } load_state_t;

    load_state_t state, next_state;

    logic        sub_start;
    logic        sub_busy;
    logic        sub_done;
    logic        sub_fault;
    fault_type_t sub_fault_type;

    ctmm_mload u_mload (
        .clk            (clk),
        .rst_n          (rst_n),
        .sub_start      (sub_start),
        .sub_cr_src     (cr_src),
        .sub_cr_dst     (cr_dst),
        .sub_index      (index),
        .sub_direct     (1'b0),
        .sub_direct_gt  (32'd0),
        .sub_m_elevated (1'b0),
        .sub_busy       (sub_busy),
        .sub_done       (sub_done),
        .sub_fault      (sub_fault),
        .sub_fault_type (sub_fault_type),
        .cr_rd_addr     (cr_rd_addr),
        .cr_rd_data     (cr_rd_data),
        .cr_wr_addr     (cr_wr_addr),
        .cr_wr_data     (cr_wr_data),
        .cr_wr_en       (cr_wr_en),
        .cr15_namespace (cr15_namespace),
        .mem_addr       (mem_addr),
        .mem_rd_en      (mem_rd_en),
        .mem_rd_data    (mem_rd_data),
        .mem_rd_valid   (mem_rd_valid),
        .thread_wr_en   (thread_wr_en),
        .thread_wr_idx  (thread_wr_idx),
        .thread_wr_data (thread_wr_data)
    );

    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) state <= LOAD_IDLE;
        else        state <= next_state;
    end

    always_comb begin
        next_state = state;
        sub_start  = 1'b0;
        case (state)
            LOAD_IDLE:
                if (load_start) next_state = LOAD_START_SUB;
            LOAD_START_SUB: begin
                sub_start  = 1'b1;
                next_state = LOAD_WAIT_ACK;
            end
            LOAD_WAIT_ACK: begin
                sub_start = 1'b1;
                if (sub_busy) next_state = LOAD_CALL_SUB;
            end
            LOAD_CALL_SUB:
                if (sub_done || sub_fault) next_state = LOAD_IDLE;
            default: next_state = LOAD_IDLE;
        endcase
    end

    assign load_busy     = (state != LOAD_IDLE);
    assign load_complete = (state == LOAD_CALL_SUB) && sub_done;
    assign load_fault    = (state == LOAD_CALL_SUB) && sub_fault;
    assign fault_type    = sub_fault_type;

endmodule
