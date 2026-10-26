`timescale 1ns/1ps
// Exact generated top + UNISIM. No internal writes or substitute clock model.
module wukong_25mhz_boot_tb;
  reg clk = 0;
  wire tx, led0, led1;
  integer cycles = 0;
  realtime previous_edge = 0;
  church_wukong_xc7a100t dut(
    .clk(clk), .rst_n(1'b1), .uart_rx_pin(1'b1),
    .uart_tx_pin(tx), .led0(led0), .led1(led1));
  always #10 clk = ~clk;
  // Rising edges can advance real state: never ignore an unlocked rising edge.
  always @(posedge dut.\boot_rom.clk ) begin
    if (dut.\phase1_clock.locked !== 1'b1)
      $fatal(1, "User rising clock edge without lock");
  end
  always @(negedge dut.\boot_rom.clk ) begin
    // UNISIM initializes its output X->0 at time zero, which Verilog reports
    // as a negedge. It is not an executed cycle. Ignore only that startup
    // settling event, not edges before lock at any later simulation time.
    if ($realtime > 0.0) begin
    if (dut.\phase1_clock.locked !== 1'b1)
      $fatal(1, "User clock without lock");
    if (cycles > 0 &&
        (($realtime - previous_edge < 39.999) ||
         ($realtime - previous_edge > 40.001)))
      $fatal(1, "Full-top user clock period mismatch");
    previous_edge = $realtime;
    cycles = cycles + 1;
    if (dut.hw_init_done === 1'b1) begin
      if (dut.\core.fault_valid !== 1'b0)
        $fatal(1, "Fault or unknown control before boot handoff");
      if ((^dut.\core.nia ) === 1'bx || (tx !== 1'b0 && tx !== 1'b1))
        $fatal(1, "Unknown NIA or UART output");
      if (dut.\core.boot_complete === 1'b1) begin
        if (dut.\core.nia !== 32'h3504)
          $fatal(1, "Unexpected boot entry: %h", dut.\core.nia );
        $display("BOOT25_PASS: entry=00003504 cycle=%0d; boot only, not program or upload proof", cycles);
        $finish;
      end
    end
    if ((cycles % 50000) == 0)
      $display("BOOT25_PROGRESS: cycle=%0d init=%b boot=%b nia=%h",
        cycles, dut.hw_init_done, dut.\core.boot_complete , dut.\core.nia );
    end
  end
  initial begin
    #80000000;
    $fatal(1, "Boot handoff timeout");
  end
endmodule
