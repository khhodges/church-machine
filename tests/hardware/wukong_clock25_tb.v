`timescale 1ns/1ps
// Runs against Vivado UNISIM, not a hand-written divider substitute.
module clock25_tb;
  reg clk_in = 0;
  wire clk_out, locked;
  integer edges = 0;
  realtime previous_edge = 0;
  clock25 dut (.clk_in(clk_in), .clk_out(clk_out), .locked(locked));
  always #10 clk_in = ~clk_in;
  always @(posedge clk_out) begin
    if (locked !== 1'b1) $fatal(1, "User clock edge before MMCM lock");
    if (edges > 0 &&
        (($realtime - previous_edge < 39.999) ||
         ($realtime - previous_edge > 40.001)))
      $fatal(1, "Incorrect 25 MHz period");
    previous_edge = $realtime;
    edges = edges + 1;
    if (edges == 201) begin
      $display("CLOCK25_PASS: 200 stable cycles at 25 MHz after lock");
      $finish;
    end
  end
  initial begin
    #100000;
    $fatal(1, "Timeout: missing lock or output clock");
  end
endmodule
