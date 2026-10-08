---
name: Configuration memory capacity units
description: Vivado write_cfgmem capacity uses MiB, unlike flash device marketing capacities in Mbit.
---

Use `write_cfgmem -size 8` for the Wukong N25Q064 (64 Mbit / 8 MiB),
not `-size 64`.

**Why:** The retained build Tcl used 64 while describing a 64 Mbit device.
AMD UG908 explicitly states that `-size` uses megabytes rather than megabits.
This mismatch must not be copied into corrected-file packaging.

**How to apply:** Keep SPIx4 and address zero for this board. Verify Intel HEX
record checksums, EOF, and address bounds against 8 MiB. Do not confuse these
format checks with a physical flash test or full program validation.

Reference: https://docs.amd.com/r/en-US/ug908-vivado-programming-debugging/Creating-a-Configuration-Memory-File-for-FPGA-Devices
