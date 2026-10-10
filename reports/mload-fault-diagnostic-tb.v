// Diagnostic replay of the immutable retained shared mLoad module.
// Not a board test or initializer validation. No hardware source changes.
`timescale 1ns/1ps
module tb;
  reg clk = 0;
  always #5 clk = ~clk;
  reg start = 0, clear_all = 1;
  integer limit_value, index_value;
  reg [31:0] data = 0;
  reg valid = 0;
  wire [31:0] addr;
  wire rd, fault, done, wr;
  wire [4:0] fault_type;
  wire [95:0] cap;
  reg [31:0] mem [0:16383];
  integer cycles = 0, clist_reads = 0, ns_reads = 0;
  \top.core.u_shared_mload dut(
    .clk(clk), .clear_all(clear_all), .sub_start(start),
    .sub_cr_src(4'd6), .sub_cr_dst(4'd0), .sub_index(index_value),
    .sub_direct(1'b0), .sub_direct_gt(32'd0), .m_elevated(1'b0),
    .sub_validate_only(1'b0),
    .cr_rd_data(96'h0000000a_00003dd4_1a00000a),
    .cr15_namespace({limit_value[31:0], 32'd0, 32'd0}),
    .mem_rd_data(data), .\mem_rd_valid$25 (valid),
    .mem_addr(addr), .mem_rd_en(rd),
    .sub_fault(fault), .sub_fault_type(fault_type), .sub_done(done),
    .cr_wr_en(wr), .cr_wr_data(cap),
    .outform_done_in(1'b0), .outform_fault_in(1'b0),
    .outform_fault_type_in(5'd0)
  );
  initial begin
    if (!$value$plusargs("LIMIT=%d", limit_value)) $fatal(1, "LIMIT missing");
    if (!$value$plusargs("INDEX=%d", index_value)) $fatal(1, "INDEX missing");
    $readmemh("memory.hex", mem);
    repeat (2) @(negedge clk);
    clear_all = 0;
    @(negedge clk); start = 1;
    @(negedge clk); start = 0;
  end
  always @(posedge clk) begin
    cycles = cycles + 1;
    valid <= rd;
    if (rd) begin
      data <= mem[addr >> 2];
      $display("READ addr=%08h value=%08h", addr, mem[addr >> 2]);
      if (addr == 32'h3dd8) clist_reads = clist_reads + 1;
      if (addr >= 32'h60 && addr <= 32'h6c) ns_reads = ns_reads + 1;
    end
    if (wr) $display("WRITE_CAP %024h", cap);
    if (fault || done) begin
      $display("RESULT limit=%0d index=%0d fault=%0d code=%0d done=%0d clist_reads=%0d ns_reads=%0d",
               limit_value, index_value, fault, fault_type, done, clist_reads, ns_reads);
      if (index_value == 11) begin
        if (!fault || fault_type != 8 || clist_reads != 0 || ns_reads != 0)
          $fatal(1, "source bounds control failed");
      end else if (limit_value == 0) begin
        if (!fault || fault_type != 8 || clist_reads == 0 || ns_reads != 0)
          $fatal(1, "namespace bounds reproduction failed");
      end else begin
        if (fault || !done || clist_reads == 0 || ns_reads == 0)
          $fatal(1, "corrected limit control failed");
      end
      $display("PASS_DIAGNOSTIC");
      $finish;
    end
    if (cycles == 500) $fatal(1, "timeout");
  end
endmodule
