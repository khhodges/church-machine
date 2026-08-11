---
name: Wukong physical Halt and reboot isolation
description: Full-top UART simulation proves Halt and reboot NIA behavior; physical failures require current-bitstream and board-side verification.
---

The Wukong `h` and `f` commands pass a full-top Amaranth simulation using the
real UART receiver and 8N1 frames. Halt changes `(step_mode, step_halted)` from
`(0, 0)` to `(1, 1)`. Reboot restarts the retired-NIA sequence at
`0x00000000 → 0x00000004 → 0x00000008 → 0x00000704`; a prior loop address must
not survive into the first abstraction.

If physical Halt still fails while Reboot works, first verify the programmed
bitstream identity and capture direct board-side evidence. A successful
source/full-top simulation does not prove that the board is running that source
revision or that the UART byte was electrically received and applied.

**Why:** A bridge serial-write ACK only proves that the host accepted the byte;
the full-top simulation separates source/RTL correctness from FPGA programming
and physical UART application. Build metadata can identify an older source
commit even when the board reports a current-looking build number.

**How to apply:** Before promoting Halt/Step/Run or reboot-entry hardware tests,
program a bitstream built from the current source, verify its sentinel/build
identity, and require a direct board-side trace or command echo. Do not promote
hardware tests based on bridge ACKs alone.