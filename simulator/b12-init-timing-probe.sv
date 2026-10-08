// Diagnostic only. No passing marker and no release approval.
// Observe stable inputs before the next rising edge and the physical RAM clock.
`timescale 1ns/1ps
module tb_probe;
  reg clk=0, rst_n=0;
  wire tx, led0, led1, boot, fault_valid;
  wire [31:0] nia, fault;
  church_wukong_xc7a100t dut(
    .clk(clk), .rst_n(rst_n), .uart_rx_pin(1'b1),
    .uart_tx_pin(tx), .led0(led0), .led1(led1),
    .dbg_boot_complete(boot), .dbg_fault_valid(fault_valid),
    .dbg_nia(nia), .dbg_fault(fault));
  always #10 clk=~clk;
  initial begin
    #1000 rst_n=1;
    #200;
    $display("TIMING_PROBE_FINISHED_NOT_A_PASS");
    $finish;
  end
  // These values have settled for half a clock cycle.
  always @(negedge clk) begin
    if ($time >= 300 && $time <= 600)
      $display("STABLE t=%t ready=%b done=%b rom_addr=%h rom_en=%b rom_regce=%b rom_out=%h ram_addr=%h ram_en=%b ram_we=%h ram_low6=%h",
        $time, dut.\initializer.ready , dut.\initializer.done ,
        dut.p_1_out_0.ADDRARDADDR, dut.p_1_out_0.ENARDEN,
        dut.p_1_out_0.REGCEAREGCE, dut.p_1_out_0.DOADO,
        dut.dmem_reg_1_0.ADDRARDADDR, dut.dmem_reg_1_0.ENARDEN,
        dut.dmem_reg_1_0.WEA,
        {dut.dmem_reg_1_2.DIADI[1:0],dut.dmem_reg_1_1.DIADI[1:0],dut.dmem_reg_1_0.DIADI[1:0]});
  end
  // Observe the actual write-port clock, not the top-level clock input.
  always @(posedge dut.dmem_reg_1_0.CLKARDCLK) begin
    if ($time >= 300 && $time <= 600)
      $display("RAM_EDGE t=%t ready=%b addr=%h en=%b we=%h low6=%h",
        $time, dut.\initializer.ready ,
        dut.dmem_reg_1_0.ADDRARDADDR, dut.dmem_reg_1_0.ENARDEN,
        dut.dmem_reg_1_0.WEA,
        {dut.dmem_reg_1_2.DIADI[1:0],dut.dmem_reg_1_1.DIADI[1:0],dut.dmem_reg_1_0.DIADI[1:0]});
  end
endmodule
