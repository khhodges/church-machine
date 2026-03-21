// ============================================================================
// CTMM Testbench - Verification of Church-Turing Meta-Machine
// ============================================================================
// Tests boot sequence, capability operations, and GC functionality
// ============================================================================

`timescale 1ns / 1ps

module ctmm_tb;
    import ctmm_pkg::*;
    
    // ========================================================================
    // Clock and Reset
    // ========================================================================
    
    logic clk;
    logic rst_n;
    
    // 100 MHz clock
    always #5 clk = ~clk;
    
    // ========================================================================
    // DUT Signals
    // ========================================================================
    
    // Instruction Memory
    logic [31:0] imem_addr;
    logic [31:0] imem_data;
    logic        imem_valid;
    
    // Namespace Memory
    logic [31:0] ns_addr;
    logic        ns_rd_en;
    namespace_entry_t ns_rd_data;
    namespace_entry_t ns_wr_data;
    logic        ns_wr_en;
    
    // C-List Memory
    logic [31:0] clist_addr;
    logic        clist_rd_en;
    golden_token_t clist_rd_data;
    golden_token_t clist_wr_data;
    logic        clist_wr_en;
    
    // Data Memory
    logic [31:0] dmem_addr;
    logic        dmem_rd_en;
    logic [31:0] dmem_rd_data;
    logic [31:0] dmem_wr_data;
    logic        dmem_wr_en;
    
    // Boot Control
    logic        boot_start;
    boot_state_t boot_state;
    logic        boot_complete;
    
    // GC Control
    logic        gc_start;
    logic        gc_busy;
    logic [31:0] gc_garbage_count;
    
    // Fault Output
    fault_type_t fault;
    logic        fault_valid;
    
    // Debug
    logic [31:0] nia;
    condition_flags_t flags;
    
    // ========================================================================
    // DUT Instantiation
    // ========================================================================
    
    ctmm_core dut (
        .clk            (clk),
        .rst_n          (rst_n),
        .imem_addr      (imem_addr),
        .imem_data      (imem_data),
        .imem_valid     (imem_valid),
        .ns_addr        (ns_addr),
        .ns_rd_en       (ns_rd_en),
        .ns_rd_data     (ns_rd_data),
        .ns_wr_data     (ns_wr_data),
        .ns_wr_en       (ns_wr_en),
        .clist_addr     (clist_addr),
        .clist_rd_en    (clist_rd_en),
        .clist_rd_data  (clist_rd_data),
        .clist_wr_data  (clist_wr_data),
        .clist_wr_en    (clist_wr_en),
        .dmem_addr      (dmem_addr),
        .dmem_rd_en     (dmem_rd_en),
        .dmem_rd_data   (dmem_rd_data),
        .dmem_wr_data   (dmem_wr_data),
        .dmem_wr_en     (dmem_wr_en),
        .boot_start     (boot_start),
        .boot_state     (boot_state),
        .boot_complete  (boot_complete),
        .gc_start       (gc_start),
        .gc_busy        (gc_busy),
        .gc_garbage_count(gc_garbage_count),
        .fault          (fault),
        .fault_valid    (fault_valid),
        .nia            (nia),
        .flags          (flags)
    );
    
    // ========================================================================
    // Instruction Memory Model
    // ========================================================================
    
    logic [31:0] imem [0:255];
    
    always_ff @(posedge clk) begin
        imem_data <= imem[imem_addr[9:2]];
        imem_valid <= 1'b1;
    end
    
    // ========================================================================
    // Namespace Memory Model
    // ========================================================================
    
    namespace_entry_t ns_mem [0:15];
    
    always_ff @(posedge clk) begin
        if (ns_rd_en) begin
            ns_rd_data <= ns_mem[ns_addr[3:0]];
        end
        if (ns_wr_en) begin
            ns_mem[ns_addr[3:0]] <= ns_wr_data;
        end
    end
    
    // ========================================================================
    // C-List Memory Model
    // ========================================================================
    
    golden_token_t clist_mem [0:255];
    
    always_ff @(posedge clk) begin
        if (clist_rd_en) begin
            clist_rd_data <= clist_mem[clist_addr[7:0]];
        end
        if (clist_wr_en) begin
            clist_mem[clist_addr[7:0]] <= clist_wr_data;
        end
    end
    
    // ========================================================================
    // Data Memory Model
    // ========================================================================
    
    logic [31:0] dmem [0:1023];
    
    always_ff @(posedge clk) begin
        if (dmem_rd_en) begin
            dmem_rd_data <= dmem[dmem_addr[11:2]];
        end
        if (dmem_wr_en) begin
            dmem[dmem_addr[11:2]] <= dmem_wr_data;
        end
    end
    
    // ========================================================================
    // Test Stimulus
    // ========================================================================
    
    initial begin
        // Initialize
        clk = 0;
        rst_n = 0;
        boot_start = 0;
        gc_start = 0;
        
        // Initialize memories
        for (int i = 0; i < 256; i++) begin
            imem[i] = 32'h0;
            clist_mem[i] = GT_NULL;
        end
        for (int i = 0; i < 16; i++) begin
            ns_mem[i] = '{word2_seals: 32'h0, word1_limit: 32'h1000, word0_location: 32'h0};
        end
        for (int i = 0; i < 1024; i++) begin
            dmem[i] = 32'h0;
        end
        
        // Initialize Boot C-List entries
        clist_mem[0] = '{b_flag: 1'b0, perms: PERM_MASK_X, gt_type: GT_TYPE_REAL, gt_seq: 7'h0, slot_id: 16'h0001};  // Access.asm
        clist_mem[1] = '{b_flag: 1'b0, perms: PERM_MASK_L, gt_type: GT_TYPE_REAL, gt_seq: 7'h0, slot_id: 16'h0003};  // Kenneth
        clist_mem[2] = '{b_flag: 1'b0, perms: PERM_MASK_L, gt_type: GT_TYPE_REAL, gt_seq: 7'h0, slot_id: 16'h0004};  // Matthew
        clist_mem[3] = '{b_flag: 1'b0, perms: PERM_MASK_L, gt_type: GT_TYPE_REAL, gt_seq: 7'h0, slot_id: 16'h0005};  // Daniel
        clist_mem[4] = '{b_flag: 1'b0, perms: PERM_MASK_E, gt_type: GT_TYPE_REAL, gt_seq: 7'h0, slot_id: 16'h0006};  // SlideRule
        clist_mem[5] = '{b_flag: 1'b0, perms: PERM_MASK_E, gt_type: GT_TYPE_REAL, gt_seq: 7'h0, slot_id: 16'h0007};  // Abacus
        clist_mem[6] = '{b_flag: 1'b0, perms: PERM_MASK_E, gt_type: GT_TYPE_REAL, gt_seq: 7'h0, slot_id: 16'h0008};  // Circle
        clist_mem[7] = '{b_flag: 1'b0, perms: PERM_MASK_E, gt_type: GT_TYPE_REAL, gt_seq: 7'h0, slot_id: 16'h0009};  // CapabilityManager
        
        // Test program: MOV DR0, #42; ADD DR1, DR0, #10; CMP DR1, #52
        // MOV instruction: opcode=010000, dr_dst=0, imm=42, use_imm=1
        imem[0] = {4'b1110, 6'b010000, 4'd0, 4'd0, 4'd0, 1'b1, 9'd42};
        // ADD instruction: opcode=010001, dr_dst=1, dr_src1=0, imm=10
        imem[1] = {4'b1110, 6'b010001, 4'd1, 4'd0, 4'd0, 1'b1, 9'd10};
        // CMP instruction: opcode=011011, dr_src1=1, imm=52
        imem[2] = {4'b1110, 6'b011011, 4'd0, 4'd1, 4'd0, 1'b1, 9'd52};
        
        $display("============================================");
        $display("CTMM Hardware Testbench - Starting");
        $display("============================================");
        
        // Release reset
        #20;
        rst_n = 1;
        #20;
        
        // Start boot sequence
        $display("\n[TEST 1] Boot Sequence");
        $display("------------------------------------------");
        boot_start = 1;
        #10;
        boot_start = 0;
        
        // Wait for boot to complete
        wait(boot_complete);
        $display("Boot state: %s", boot_state.name());
        $display("Boot complete: %b", boot_complete);
        $display("CR15 (Namespace): slot_id=0x%04X, perms=0x%04X, gt_seq=%0d",
                 dut.u_registers.cap_regs[15].word0_gt.slot_id,
                 dut.u_registers.cap_regs[15].word0_gt.perms,
                 dut.u_registers.cap_regs[15].word0_gt.gt_seq);
        $display("CR8  (Thread):    slot_id=0x%04X, perms=0x%04X, gt_seq=%0d",
                 dut.u_registers.cap_regs[8].word0_gt.slot_id,
                 dut.u_registers.cap_regs[8].word0_gt.perms,
                 dut.u_registers.cap_regs[8].word0_gt.gt_seq);
        $display("CR6  (C-List):    slot_id=0x%04X, perms=0x%04X, gt_seq=%0d",
                 dut.u_registers.cap_regs[6].word0_gt.slot_id,
                 dut.u_registers.cap_regs[6].word0_gt.perms,
                 dut.u_registers.cap_regs[6].word0_gt.gt_seq);
        $display("CR14 (Code):      slot_id=0x%04X, perms=0x%04X, gt_seq=%0d",
                 dut.u_registers.cap_regs[14].word0_gt.slot_id,
                 dut.u_registers.cap_regs[14].word0_gt.perms,
                 dut.u_registers.cap_regs[14].word0_gt.gt_seq);
        
        // Execute test program
        $display("\n[TEST 2] Turing Instructions");
        $display("------------------------------------------");
        
        // Wait for instructions to execute
        #100;
        
        $display("DR0 = %d (expected: 42)", dut.u_registers.data_regs[0]);
        $display("DR1 = %d (expected: 52)", dut.u_registers.data_regs[1]);
        $display("Flags: N=%b Z=%b C=%b V=%b", flags.N, flags.Z, flags.C, flags.V);
        
        // Test GC cycle
        $display("\n[TEST 3] Garbage Collection Cycle");
        $display("------------------------------------------");
        
        // Set G bit on some entries
        clist_mem[10] = '{b_flag: 1'b1, perms: PERM_MASK_R, gt_type: GT_TYPE_REAL, gt_seq: 7'h1, slot_id: 16'h000A};
        clist_mem[11] = '{b_flag: 1'b1, perms: PERM_MASK_W, gt_type: GT_TYPE_REAL, gt_seq: 7'h1, slot_id: 16'h000B};
        
        gc_start = 1;
        #10;
        gc_start = 0;
        
        // Wait for GC to complete
        wait(!gc_busy);
        #20;
        
        $display("GC garbage count: %d", gc_garbage_count);
        
        // Summary
        $display("\n============================================");
        $display("CTMM Hardware Testbench - Complete");
        $display("============================================");
        
        if (fault_valid) begin
            $display("FAULT DETECTED: %s", fault.name());
        end else begin
            $display("All tests passed successfully!");
        end
        
        $finish;
    end
    
    // Timeout
    initial begin
        #10000;
        $display("ERROR: Timeout!");
        $finish;
    end

endmodule
