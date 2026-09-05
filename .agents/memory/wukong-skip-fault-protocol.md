---
name: Wukong one-shot Skip Fault protocol
description: Safety and correlation rules for advancing past one expected physical-board fault without bypassing permission checks.
---

Wukong may offer a testing-only one-shot Skip Fault disposition only after the exact reason-2 fault snapshot is durable. The failed instruction is not retried; NIA advances by four while the machine remains step-halted. Permission and M-bit checks still execute normally, and non-Wukong cores retain immediate fault reset.

**Why:** A UART write acknowledgement proves transport, not that the FPGA accepted or completed the skip. Automatic recovery can also race an operator choice, and mutating shared live/history objects can erase the original fault record.

**How to apply:** Leave the board held until an explicit Reboot or Skip choice. Accept completion only from the authenticated bridge and bind it to command ID, incident ID, bridge session, NIA+4, and the CRC-covered FPGA snapshot sequence immediately after the promoted fault snapshot. Keep fault history immutable. Lost correlation is indeterminate and requires reboot.