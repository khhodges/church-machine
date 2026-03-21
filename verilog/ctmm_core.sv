// ============================================================================
// CTMM Core - Church-Turing Meta-Machine Processor Core
// ============================================================================
// Top-level integration of all CTMM components
// Implements Kenneth James Hamer-Hodges' capability-based architecture
// ============================================================================

module ctmm_core
    import ctmm_pkg::*;
(
    input  logic        clk,
    input  logic        rst_n,
    
    // Instruction Memory Interface
    output logic [31:0] imem_addr,        // Instruction address (NIA)
    input  logic [31:0] imem_data,        // Instruction data
    input  logic        imem_valid,       // Instruction valid
    
    // Namespace Memory Interface
    output logic [31:0] ns_addr,          // Namespace address
    output logic        ns_rd_en,         // Read enable
    input  namespace_entry_t ns_rd_data,  // Namespace entry data
    output namespace_entry_t ns_wr_data,  // Write data
    output logic        ns_wr_en,         // Write enable
    
    // C-List Memory Interface
    output logic [31:0] clist_addr,       // C-List address
    output logic        clist_rd_en,      // Read enable
    input  golden_token_t clist_rd_data,  // C-List entry (GT)
    output golden_token_t clist_wr_data,  // Write data
    output logic        clist_wr_en,      // Write enable
    
    // Data Memory Interface
    output logic [31:0] dmem_addr,        // Data address
    output logic        dmem_rd_en,       // Read enable
    input  logic [31:0] dmem_rd_data,     // Read data (32-bit wide)
    output logic [31:0] dmem_wr_data,     // Write data (32-bit wide)
    output logic        dmem_wr_en,       // Write enable
    
    // Boot Control
    input  logic        boot_start,       // Start boot sequence
    output boot_state_t boot_state,       // Current boot state
    output logic        boot_complete,    // Boot finished
    
    // GC Control
    input  logic        gc_start,         // Start GC cycle
    output logic        gc_busy,          // GC in progress
    output logic [31:0] gc_garbage_count, // Garbage entries found
    
    // Fault Output
    output fault_type_t fault,
    output logic        fault_valid,
    
    // Debug Interface
    output logic [31:0] nia,              // Next Instruction Address
    output condition_flags_t flags        // Current flags
);

    // ========================================================================
    // Internal Signals
    // ========================================================================
    
    // Register file signals
    logic [3:0]  cr_rd_addr, cr_wr_addr;
    golden_token_t cr_rd_data, cr_wr_data;
    logic        cr_wr_en;
    golden_token_t cr6_clist, cr7_cloomc, cr8_thread, cr15_namespace;
    golden_token_t cr6_wr_data, cr7_wr_data, cr8_wr_data, cr15_wr_data;
    golden_token_t cr9_wr_data, cr10_wr_data, cr11_wr_data, cr12_wr_data, cr13_wr_data, cr14_wr_data;
    logic        cr6_wr_en, cr7_wr_en, cr8_wr_en, cr15_wr_en;
    logic        cr9_wr_en, cr10_wr_en, cr11_wr_en, cr12_wr_en, cr13_wr_en, cr14_wr_en;
    
    logic [3:0]  dr_rd_addr1, dr_rd_addr2, dr_wr_addr;
    logic [63:0] dr_rd_data1, dr_rd_data2, dr_wr_data;
    logic        dr_wr_en;
    
    condition_flags_t flags_internal, flags_in;
    logic        flags_wr_en;
    logic        clear_all;
    
    // Decoder signals
    logic        exec_enable, is_church_op, is_turing_op;
    church_opcode_t church_op;
    turing_opcode_t turing_op;
    logic [2:0]  cr_src, cr_dst;
    logic [9:0]  clist_index;
    logic [9:0]  call_mask;
    logic        imm_mode;
    logic [2:0]  switch_target;       // SWITCH target: 0=CR8, 7=CR15
    logic [5:0]  perm_mask;
    
    // SWITCH module signals
    logic        switch_start, switch_busy, switch_complete, switch_fault;
    fault_type_t switch_fault_type;
    
    // Effective CALL mask: I=1 uses embedded 10-bit, I=0 uses DR15
    logic [63:0] effective_call_mask;
    logic [3:0]  dr_src1, dr_src2, dr_dst;
    logic [15:0] immediate;
    logic [21:0] ldi_immediate;
    logic        use_immediate;
    logic [15:0] branch_offset;
    fault_type_t decoder_fault;
    logic        decoder_fault_valid;
    
    // Permission checker signals
    golden_token_t perm_gt;
    logic [5:0]  required_perms;
    logic        perm_check_valid;
    logic [15:0] access_index;
    logic [15:0] limit;
    logic        check_bounds;
    logic [15:0] calculated_seal, stored_seal;
    logic        check_seal;
    logic [6:0]  stored_gt_seq;
    logic        check_version;
    logic        check_domain_purity;
    logic        perm_granted, bounds_ok, version_ok, seal_valid, domain_purity_ok, all_checks_pass;
    fault_type_t perm_fault;
    logic        perm_fault_valid;
    
    // GC unit signals
    logic [31:0] gc_ns_addr;
    logic        gc_ns_rd_en;
    golden_token_t gc_ns_wr_data;
    logic        gc_ns_wr_en;
    logic [31:0] gc_marked_count;
    logic        gc_done;
    logic        g_bit_reset;
    
    // NIA register
    logic [31:0] nia_reg;
    logic [31:0] nia_next;
    logic        nia_wr_en;
    
    // Boot state machine
    boot_state_t boot_state_reg;
    
    // ========================================================================
    // Register File Instantiation
    // ========================================================================
    
    ctmm_registers u_registers (
        .clk            (clk),
        .rst_n          (rst_n),
        .cr_rd_addr     (cr_rd_addr),
        .cr_rd_data     (cr_rd_data),
        .cr_wr_addr     (cr_wr_addr),
        .cr_wr_data     (cr_wr_data),
        .cr_wr_en       (cr_wr_en),
        .cr6_clist      (cr6_clist),
        .cr7_cloomc     (cr7_cloomc),
        .cr8_thread     (cr8_thread),
        .cr15_namespace (cr15_namespace),
        .cr6_wr_data    (cr6_wr_data),
        .cr6_wr_en      (cr6_wr_en),
        .cr7_wr_data    (cr7_wr_data),
        .cr7_wr_en      (cr7_wr_en),
        .cr8_wr_data    (cr8_wr_data),
        .cr8_wr_en      (cr8_wr_en),
        .cr9_wr_data    (cr9_wr_data),
        .cr9_wr_en      (cr9_wr_en),
        .cr10_wr_data   (cr10_wr_data),
        .cr10_wr_en     (cr10_wr_en),
        .cr11_wr_data   (cr11_wr_data),
        .cr11_wr_en     (cr11_wr_en),
        .cr12_wr_data   (cr12_wr_data),
        .cr12_wr_en     (cr12_wr_en),
        .cr13_wr_data   (cr13_wr_data),
        .cr13_wr_en     (cr13_wr_en),
        .cr14_wr_data   (cr14_wr_data),
        .cr14_wr_en     (cr14_wr_en),
        .cr15_wr_data   (cr15_wr_data),
        .cr15_wr_en     (cr15_wr_en),
        .dr_rd_addr1    (dr_rd_addr1),
        .dr_rd_data1    (dr_rd_data1),
        .dr_rd_addr2    (dr_rd_addr2),
        .dr_rd_data2    (dr_rd_data2),
        .dr_wr_addr     (dr_wr_addr),
        .dr_wr_data     (dr_wr_data),
        .dr_wr_en       (dr_wr_en),
        .flags          (flags_internal),
        .flags_in       (flags_in),
        .flags_wr_en    (flags_wr_en),
        .clear_all      (clear_all)
    );
    
    // ========================================================================
    // CALL Mask Selection (I-bit)
    // ========================================================================
    // I=1: Use embedded 10-bit mask (zero-extended)
    // I=0: Use DR15 as full 64-bit mask
    // ========================================================================
    
    logic [63:0] dr15_value;
    assign dr15_value = dr_rd_data2;  // Assumes DR15 is read via dr_rd_addr2
    
    always_comb begin
        if (imm_mode) begin
            // I=1: Embedded 10-bit permission mask, zero-extended
            effective_call_mask = {54'h0, call_mask};
        end else begin
            // I=0: Use DR15 as the full permission mask
            effective_call_mask = dr15_value;
        end
    end
    
    // ========================================================================
    // Instruction Decoder Instantiation
    // ========================================================================
    
    ctmm_decoder u_decoder (
        .clk            (clk),
        .rst_n          (rst_n),
        .instruction    (imem_data),
        .instr_valid    (imem_valid && boot_complete),
        .flags          (flags_internal),
        .exec_enable    (exec_enable),
        .is_church_op   (is_church_op),
        .is_turing_op   (is_turing_op),
        .church_op      (church_op),
        .cr_src         (cr_src),
        .cr_dst         (cr_dst),
        .clist_index    (clist_index),
        .tperm_preset   (),  // Unused for now
        .call_mask      (call_mask),
        .imm_mode       (imm_mode),
        .switch_target  (switch_target),
        .turing_op      (turing_op),
        .dr_src1        (dr_src1),
        .dr_src2        (dr_src2),
        .dr_dst         (dr_dst),
        .immediate      (immediate),
        .ldi_immediate  (ldi_immediate),
        .use_immediate  (use_immediate),
        .branch_offset  (branch_offset),
        .fault          (decoder_fault),
        .fault_valid    (decoder_fault_valid)
    );
    
    // ========================================================================
    // Permission Checker Instantiation
    // ========================================================================
    
    ctmm_perm_check u_perm_check (
        .gt_in                (perm_gt),
        .required_perms       (required_perms),
        .check_valid          (perm_check_valid),
        .access_index         (access_index),
        .limit                (limit),
        .check_bounds         (check_bounds),
        .stored_gt_seq        (stored_gt_seq),
        .check_version        (check_version),
        .calculated_seal      (calculated_seal),
        .stored_seal          (stored_seal),
        .check_seal           (check_seal),
        .check_domain_purity  (check_domain_purity),
        .perm_granted         (perm_granted),
        .bounds_ok            (bounds_ok),
        .version_ok           (version_ok),
        .seal_valid           (seal_valid),
        .domain_purity_ok     (domain_purity_ok),
        .all_checks_pass      (all_checks_pass),
        .fault_type           (perm_fault),
        .fault_valid          (perm_fault_valid)
    );
    
    // ========================================================================
    // GC Unit Instantiation
    // ========================================================================
    
    ctmm_gc_unit u_gc_unit (
        .clk            (clk),
        .rst_n          (rst_n),
        .gc_start       (gc_start),
        .gc_mark_en     (1'b1),
        .gc_sweep_en    (1'b1),
        .gc_busy        (gc_busy),
        .gc_done        (gc_done),
        .ns_addr        (gc_ns_addr),
        .ns_rd_en       (gc_ns_rd_en),
        .ns_rd_data     (clist_rd_data), // Reuse C-List interface for GC
        .ns_wr_data     (gc_ns_wr_data),
        .ns_wr_en       (gc_ns_wr_en),
        .ns_start_addr  (32'h0),
        .ns_end_addr    (32'h1000),
        .marked_count   (gc_marked_count),
        .garbage_count  (gc_garbage_count),
        .access_addr    (clist_addr),
        .valid_key_access(all_checks_pass && is_church_op && (church_op == OP_LOAD)),
        .is_namespace_access(is_namespace_access),
        .g_bit_reset    (g_bit_reset)
    );
    
    // ========================================================================
    // NIA (Next Instruction Address) Register
    // ========================================================================
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            nia_reg <= 32'h0;
        end else if (clear_all) begin
            nia_reg <= 32'h0;
        end else if (nia_wr_en) begin
            nia_reg <= nia_next;
        end else if (exec_enable) begin
            nia_reg <= nia_reg + 32'h4; // Advance to next instruction
        end
    end
    
    assign imem_addr = nia_reg;
    assign nia = nia_reg;
    assign flags = flags_internal;
    
    // ========================================================================
    // Boot Sequence State Machine
    // ========================================================================
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            boot_state_reg <= BOOT_IDLE;
        end else begin
            case (boot_state_reg)
                BOOT_IDLE: begin
                    if (boot_start)
                        boot_state_reg <= BOOT_FAULT_RST;
                end
                
                BOOT_FAULT_RST: begin
                    // Step 1: Clear all registers
                    boot_state_reg <= BOOT_LOAD_NS;
                end
                
                BOOT_LOAD_NS: begin
                    // Step 2: Load namespace into CR15
                    boot_state_reg <= BOOT_INIT_THRD;
                end
                
                BOOT_INIT_THRD: begin
                    // Step 3: Initialize thread in CR8
                    boot_state_reg <= BOOT_LOAD_NUC;
                end
                
                BOOT_LOAD_NUC: begin
                    // Step 4: Load nucleus
                    boot_state_reg <= BOOT_COMPLETE;
                end
                
                BOOT_COMPLETE: begin
                    // Stay in complete state
                    boot_state_reg <= BOOT_COMPLETE;
                end
                
                default: boot_state_reg <= BOOT_IDLE;
            endcase
        end
    end
    
    assign boot_state = boot_state_reg;
    assign boot_complete = (boot_state_reg == BOOT_COMPLETE);
    assign clear_all = (boot_state_reg == BOOT_FAULT_RST);
    
    // Boot sequence register loading
    always_comb begin
        cr6_wr_en = 1'b0;  cr6_wr_data = GT_NULL;
        cr7_wr_en = 1'b0;  cr7_wr_data = GT_NULL;
        cr8_wr_en = 1'b0;  cr8_wr_data = GT_NULL;
        cr9_wr_en = 1'b0;  cr9_wr_data = GT_NULL;
        cr10_wr_en = 1'b0; cr10_wr_data = GT_NULL;
        cr11_wr_en = 1'b0; cr11_wr_data = GT_NULL;
        cr12_wr_en = 1'b0; cr12_wr_data = GT_NULL;
        cr13_wr_en = 1'b0; cr13_wr_data = GT_NULL;
        cr14_wr_en = 1'b0; cr14_wr_data = GT_NULL;
        cr15_wr_en = 1'b0; cr15_wr_data = GT_NULL;
        
        case (boot_state_reg)
            BOOT_LOAD_NS: begin
                cr15_wr_en = 1'b1;
                cr15_wr_data = '{
                    b_flag:  1'b0,
                    perms:   PERM_MASK_L,
                    gt_type: GT_TYPE_REAL,
                    gt_seq:  7'h0,
                    slot_id: 16'h0000
                };
            end
            
            BOOT_INIT_THRD: begin
                cr8_wr_en = 1'b1;
                cr8_wr_data = '{
                    b_flag:  1'b0,
                    perms:   PERM_MASK_L,
                    gt_type: GT_TYPE_REAL,
                    gt_seq:  7'h0,
                    slot_id: 16'h0003
                };
            end
            
            BOOT_LOAD_NUC: begin
                cr6_wr_en = 1'b1;
                cr6_wr_data = '{
                    b_flag:  1'b0,
                    perms:   PERM_MASK_L | PERM_MASK_S | PERM_MASK_E,
                    gt_type: GT_TYPE_REAL,
                    gt_seq:  7'h0,
                    slot_id: 16'h0002
                };
                cr14_wr_en = 1'b1;
                cr14_wr_data = '{
                    b_flag:  1'b0,
                    perms:   PERM_MASK_X,
                    gt_type: GT_TYPE_REAL,
                    gt_seq:  7'h0,
                    slot_id: 16'h0001
                };
            end
            
            default: begin
                // No boot writes after completion
            end
        endcase
        
        // Runtime SWITCH/CHANGE instruction handling (after boot)
        // NOTE: This simplified implementation assumes single-cycle memory access.
        // Production silicon would require:
        // 1. Dedicated execution pipeline stage parallel to LOAD/SAVE
        // 2. Memory read stall/handshake for I=1 C-List lookup
        // 3. Full CR9-CR14 register storage paths
        // Current scope captures architectural concepts for simulation.
        if (boot_complete && exec_enable && is_church_op && all_checks_pass &&
            (church_op == OP_SWITCH || church_op == OP_CHANGE)) begin
            // SWITCH: Copy capability to target CR8-CR15
            // CHANGE: Create new thread GT and load to CR8 (target=0)
            // Source: I=0 uses cr_rd_data, I=1 uses clist_rd_data
            // For CHANGE, target is always 0 (CR8)
            
            // Route write to target system register based on switch_target[2:0]
            // CHANGE always targets CR8 (target=0)
            case (church_op == OP_CHANGE ? 3'b000 : switch_target)
                3'b000: begin cr8_wr_en = 1'b1;  cr8_wr_data = imm_mode ? clist_rd_data : cr_rd_data; end
                3'b001: begin cr9_wr_en = 1'b1;  cr9_wr_data = imm_mode ? clist_rd_data : cr_rd_data; end
                3'b010: begin cr10_wr_en = 1'b1; cr10_wr_data = imm_mode ? clist_rd_data : cr_rd_data; end
                3'b011: begin cr11_wr_en = 1'b1; cr11_wr_data = imm_mode ? clist_rd_data : cr_rd_data; end
                3'b100: begin cr12_wr_en = 1'b1; cr12_wr_data = imm_mode ? clist_rd_data : cr_rd_data; end
                3'b101: begin cr13_wr_en = 1'b1; cr13_wr_data = imm_mode ? clist_rd_data : cr_rd_data; end
                3'b110: begin cr14_wr_en = 1'b1; cr14_wr_data = imm_mode ? clist_rd_data : cr_rd_data; end
                3'b111: begin cr15_wr_en = 1'b1; cr15_wr_data = imm_mode ? clist_rd_data : cr_rd_data; end
            endcase
        end
    end
    
    // ========================================================================
    // Fault Aggregation
    // ========================================================================
    
    always_comb begin
        if (decoder_fault_valid) begin
            fault = decoder_fault;
            fault_valid = 1'b1;
        end else if (perm_fault_valid) begin
            fault = perm_fault;
            fault_valid = 1'b1;
        end else begin
            fault = FAULT_NONE;
            fault_valid = 1'b0;
        end
    end
    
    // ========================================================================
    // Memory Interface Multiplexing
    // ========================================================================
    
    // Namespace/C-List address multiplexing
    assign clist_addr = gc_busy ? gc_ns_addr : 
                        (is_church_op ? {cr_rd_data.slot_id, 6'h0} + {22'h0, clist_index} : 32'h0);
    assign clist_rd_en = gc_busy ? gc_ns_rd_en :
                         (exec_enable && is_church_op && 
                          ((church_op == OP_LOAD) || 
                           (imm_mode && (church_op == OP_SWITCH || church_op == OP_CHANGE))));
    assign clist_wr_data = gc_busy ? gc_ns_wr_data : cr_rd_data;
    assign clist_wr_en = gc_busy ? gc_ns_wr_en :
                         (exec_enable && is_church_op && (church_op == OP_SAVE) && all_checks_pass);
    
    // Permission check setup for LOAD operation
    assign cr_rd_addr = cr_src;
    assign perm_gt = cr_rd_data;
    assign required_perms = (church_op == OP_LOAD) ? PERM_MASK_L :
                            (church_op == OP_SAVE) ? PERM_MASK_S :
                            (church_op == OP_CALL) ? PERM_MASK_E :
                            (church_op == OP_SWITCH) ? PERM_MASK_L :
                            (church_op == OP_CHANGE) ? PERM_MASK_L :
                            6'h0;
    assign perm_check_valid = exec_enable && is_church_op;
    assign access_index = {24'h0, clist_index};
    assign limit = ns_rd_data.word2_limit;
    assign check_bounds = 1'b1;
    assign calculated_mac = 64'h0; // Simplified - would compute MAC in real impl
    assign stored_mac = ns_rd_data.word3_seals;
    assign check_mac = 1'b0; // Disabled for now
    
    // CR write for LOAD operation
    assign cr_wr_addr = cr_dst;
    assign cr_wr_data = clist_rd_data;
    assign cr_wr_en = exec_enable && is_church_op && (church_op == OP_LOAD) && all_checks_pass;
    
    // DR interface for Turing operations
    assign dr_rd_addr1 = dr_src1;
    assign dr_rd_addr2 = dr_src2;
    assign dr_wr_addr = dr_dst;
    
    // ALU operation (simplified)
    always_comb begin
        dr_wr_data = 64'h0;
        dr_wr_en = 1'b0;
        flags_in = flags_internal;
        flags_wr_en = 1'b0;
        nia_wr_en = 1'b0;
        nia_next = nia_reg;
        
        if (exec_enable && is_turing_op) begin
            case (turing_op)
                OP_MOV: begin
                    dr_wr_data = use_immediate ? {48'h0, immediate} : dr_rd_data2;
                    dr_wr_en = 1'b1;
                end
                
                OP_ADD: begin
                    dr_wr_data = dr_rd_data1 + (use_immediate ? {48'h0, immediate} : dr_rd_data2);
                    dr_wr_en = 1'b1;
                    flags_in.Z = (dr_wr_data == 64'h0);
                    flags_in.N = dr_wr_data[63];
                    flags_wr_en = 1'b1;
                end
                
                OP_SUB: begin
                    dr_wr_data = dr_rd_data1 - (use_immediate ? {48'h0, immediate} : dr_rd_data2);
                    dr_wr_en = 1'b1;
                    flags_in.Z = (dr_wr_data == 64'h0);
                    flags_in.N = dr_wr_data[63];
                    flags_wr_en = 1'b1;
                end
                
                OP_AND: begin
                    dr_wr_data = dr_rd_data1 & (use_immediate ? {48'h0, immediate} : dr_rd_data2);
                    dr_wr_en = 1'b1;
                    flags_in.Z = (dr_wr_data == 64'h0);
                    flags_in.N = dr_wr_data[63];
                    flags_wr_en = 1'b1;
                end
                
                OP_ORR: begin
                    dr_wr_data = dr_rd_data1 | (use_immediate ? {48'h0, immediate} : dr_rd_data2);
                    dr_wr_en = 1'b1;
                    flags_in.Z = (dr_wr_data == 64'h0);
                    flags_in.N = dr_wr_data[63];
                    flags_wr_en = 1'b1;
                end
                
                OP_CMP: begin
                    logic [63:0] cmp_result;
                    cmp_result = dr_rd_data1 - (use_immediate ? {48'h0, immediate} : dr_rd_data2);
                    flags_in.Z = (cmp_result == 64'h0);
                    flags_in.N = cmp_result[63];
                    flags_wr_en = 1'b1;
                end
                
                OP_B: begin
                    nia_next = nia_reg + {{46{branch_offset[17]}}, branch_offset};
                    nia_wr_en = 1'b1;
                end
                
                OP_LDI: begin
                    // Load Immediate: 22-bit value zero-extended to 64 bits
                    dr_wr_data = {42'h0, ldi_immediate};
                    dr_wr_en = 1'b1;
                end
                
                default: begin
                    // No operation
                end
            endcase
        end
    end
    
    // Data memory interface (for data operations)
    assign dmem_addr = dr_rd_data1[31:0];
    assign dmem_rd_en = 1'b0;  // Simplified
    assign dmem_wr_data = dr_rd_data2;
    assign dmem_wr_en = 1'b0;  // Simplified
    
    // Namespace memory interface
    assign ns_addr = {16'h0, cr_rd_data.slot_id};
    assign ns_rd_en = perm_check_valid;
    assign ns_wr_data = '{default: '0};
    assign ns_wr_en = 1'b0;

    // ========================================================================
    // CALL and RETURN Module Instantiation
    // ========================================================================
    
    // CR5 call stack for nested CALL/RETURN support (synchronized with architectural call stack)
    localparam CR5_STACK_DEPTH = 256;
    golden_token_t cr5_stack [0:CR5_STACK_DEPTH-1];
    logic [7:0]    cr5_stack_ptr;
    golden_token_t saved_cr5_gt_wire;
    golden_token_t cr5_stack_top;
    logic          cr5_stack_empty;
    logic          cr5_stack_full;
    
    assign cr5_stack_empty = (cr5_stack_ptr == '0);
    assign cr5_stack_full  = (cr5_stack_ptr == CR5_STACK_DEPTH[7:0]);
    assign cr5_stack_top   = cr5_stack_empty ? '0 : cr5_stack[cr5_stack_ptr - 1];
    
    always_ff @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            cr5_stack_ptr <= '0;
        end else if (call_complete_sig && !call_fault_sig && !cr5_stack_full) begin
            cr5_stack[cr5_stack_ptr] <= saved_cr5_gt_wire;
            cr5_stack_ptr <= cr5_stack_ptr + 1;
        end else if (ret_complete_sig && !ret_fault_valid_sig && !cr5_stack_empty) begin
            cr5_stack_ptr <= cr5_stack_ptr - 1;
        end
    end

    logic        call_start_sig, call_busy_sig, call_complete_sig, call_fault_sig;
    fault_type_t call_fault_type;
    logic [3:0]  call_cr_rd_addr;
    capability_reg_t call_cr_rd_data_in;
    logic [3:0]  call_cr_wr_addr;
    capability_reg_t call_cr_wr_data;
    logic        call_cr_wr_en;
    logic [31:0] call_mem_addr;
    logic        call_mem_rd_en;
    logic        call_thread_wr_en;
    logic [3:0]  call_thread_wr_idx;
    logic [31:0] call_thread_wr_data;
    logic        call_nia_set;
    logic [31:0] call_nia_value;
    logic [15:0] call_dr_clear_mask;
    logic [15:0] call_cr_clear_mask;

    ctmm_call u_call (
        .clk            (clk),
        .rst_n          (rst_n),
        .call_start     (call_start_sig),
        .cr_src         (cr_src),
        .index          ({6'h0, clist_index}),
        .mask           (call_mask),
        .call_busy      (call_busy_sig),
        .call_complete  (call_complete_sig),
        .call_fault     (call_fault_sig),
        .fault_type     (call_fault_type),
        .cr_rd_addr     (call_cr_rd_addr),
        .cr_rd_data     (call_cr_rd_data_in),
        .cr_wr_addr     (call_cr_wr_addr),
        .cr_wr_data     (call_cr_wr_data),
        .cr_wr_en       (call_cr_wr_en),
        .cr15_namespace (cr15_namespace),
        .mem_addr       (call_mem_addr),
        .mem_rd_en      (call_mem_rd_en),
        .mem_rd_data    (dmem_rd_data[31:0]),
        .mem_rd_valid   (1'b1),
        .thread_wr_en   (call_thread_wr_en),
        .thread_wr_idx  (call_thread_wr_idx),
        .thread_wr_data (call_thread_wr_data),
        .saved_cr5_gt   (saved_cr5_gt_wire),
        .nia_set        (call_nia_set),
        .nia_value      (call_nia_value),
        .dr_clear_mask  (call_dr_clear_mask),
        .cr_clear_mask  (call_cr_clear_mask)
    );

    assign call_start_sig = exec_enable && is_church_op && (church_op == OP_CALL) && all_checks_pass;

    logic        ret_start_sig, ret_busy_sig, ret_complete_sig, ret_fault_valid_sig;
    fault_type_t ret_fault_type;
    logic [3:0]  ret_cr_rd_addr;
    logic [3:0]  ret_cr_wr_addr;
    capability_reg_t ret_cr_wr_data;
    logic        ret_cr_wr_en;
    logic        ret_nia_set;
    logic [31:0] ret_nia_value;
    logic        ret_clear_m_bit;
    logic [31:0] ret_mem_addr;
    logic        ret_mem_rd_en;
    logic        ret_thread_wr_en;
    logic [3:0]  ret_thread_wr_idx;
    logic [31:0] ret_thread_wr_data;

    ctmm_return u_return (
        .clk            (clk),
        .rst_n          (rst_n),
        .return_start   (ret_start_sig),
        .cr_src         (cr_src),
        .busy           (ret_busy_sig),
        .complete       (ret_complete_sig),
        .fault_valid    (ret_fault_valid_sig),
        .fault_type     (ret_fault_type),
        .cr_rd_addr     (ret_cr_rd_addr),
        .cr_rd_data     (call_cr_rd_data_in),
        .cr_wr_addr     (ret_cr_wr_addr),
        .cr_wr_data     (ret_cr_wr_data),
        .cr_wr_en       (ret_cr_wr_en),
        .nia_set        (ret_nia_set),
        .nia_value      (ret_nia_value),
        .clear_m_bit    (ret_clear_m_bit),
        .cr15_namespace (cr15_namespace),
        .mem_addr       (ret_mem_addr),
        .mem_rd_en      (ret_mem_rd_en),
        .mem_rd_data    (dmem_rd_data[31:0]),
        .mem_rd_valid   (1'b1),
        .thread_wr_en   (ret_thread_wr_en),
        .thread_wr_idx  (ret_thread_wr_idx),
        .thread_wr_data (ret_thread_wr_data),
        .saved_cr5_gt   (cr5_stack_top)
    );

    assign ret_start_sig = exec_enable && is_church_op && (church_op == OP_RETURN) && all_checks_pass;

endmodule
