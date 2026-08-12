---
name: Wukong RTL generation initializer bottleneck
description: Large initialized memories can make Amaranth RTL conversion impractical before Yosys or Vivado runs.
---

The Wukong FPGA design has a fixed 16,384-word (64 KiB) DMEM; adding the
canonical SelfTest image does not increase the hardware memory depth. It does
increase the sparse hardware-init table substantially, but the observed build
stall occurs during Amaranth conversion before Yosys/Vivado, so it must not be
diagnosed as an FPGA BRAM-capacity failure without timing and artifact checks.

**Why:** A V10 conversion stayed CPU-bound for many minutes with no RTLIL
output, and a synthesis-only empty `LibMemory` initializer did not immediately
remove the stall.

**How to apply:** Separate simulation memory contents from synthesis elaboration,
measure conversion independently from Yosys/Vivado, and require a freshly
generated RTLIL/Verilog artifact before starting a remote bitstream build.