`timescale 1ns/1ps
// Read-only observations of the implemented netlist; no forces or state writes.
// Boot-complete alone is NOT entry-address, program, or physical acceptance.
module implemented_boot_tb;
  reg clk = 0;
  wire tx, led0, led1;
  integer cycles = 0;
  reg saw_trigger = 0;
  church_wukong_xc7a100t dut(
    .clk(clk), .rst_n(1'b1), .uart_rx_pin(1'b1),
    .uart_tx_pin(tx), .led0(led0), .led1(led1));
  always #10 clk = ~clk;
  always @(posedge clk) begin
    #1;
    cycles = cycles + 1;
    if (dut.boot_triggered === 1'b1 && !saw_trigger) begin
      saw_trigger = 1;
      $display("IMPLEMENTED_BOOT_TRIGGER: time_ns=%0.3f", $realtime);
    end
    if (saw_trigger && dut.fault_valid !== 1'b0)
      $fatal(1, "Fault or unknown fault state after boot trigger");
    if (dut.boot_complete === 1'b1) begin
      if (!saw_trigger) $fatal(1, "Boot complete without observed trigger");
      $display("IMPLEMENTED_BOOT_HANDOFF_OBSERVED: time_ns=%0.3f; entry and program NOT verified", $realtime);
      $finish;
    end
    if ((cycles % 50000) == 0)
      $display("IMPLEMENTED_BOOT_PROGRESS: trigger=%b complete=%b fault=%b",
               dut.boot_triggered, dut.boot_complete, dut.fault_valid);
  end
  initial begin
    #20000000;
    $display("IMPLEMENTED_BOOT_TIMEOUT: trigger=%b complete=%b fault=%b",
             dut.boot_triggered, dut.boot_complete, dut.fault_valid);
    $fatal(1, "No boot completion within 20 ms");
  end
endmodule
