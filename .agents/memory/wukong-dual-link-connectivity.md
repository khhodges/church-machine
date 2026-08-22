---
name: Wukong dual-link connectivity
description: The physical connection split between FPGA programming and Church Machine runtime communication.
---

The Wukong setup has two distinct host connections: JTAG is for loading the FPGA bitstream, while USB-UART is for the bridge, trace packets, commands, and boot-image upload.

**Why:** Treating the programming interface as the trace serial port leads to selecting the wrong device and makes a correctly programmed board appear disconnected.

**How to apply:** Label the programming path as JTAG and the runtime path as USB-UART. Describe COM3 as a common Windows assignment, never a guaranteed port; on ChromeOS, the third FT4232H picker entry is the USB-UART path when all four interfaces are shown.