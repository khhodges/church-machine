---
name: Phase 1 reduced clock
description: Approved isolated 25 MHz candidate before separate memory-integrity work.
---

The user approved reducing the Phase 1 candidate to 25 MHz first; parity or
other GT memory-integrity protection follows separately.

**Why:** Phase 1 prioritizes functional and protection testing over speed.
This supersedes the earlier requirement to keep every experimental candidate
at 50 MHz, not the requirement for truthful clock constraints or passing gates.

**How to apply:** Change the actual internal clock using FPGA clocking
resources, preserve the board input-clock constraint, and adjust clock-derived
UART/counter timing. Keep exact image inputs and security behavior unchanged.
Require new routed setup/hold/pulse-width and DRC evidence. Neither reduced
frequency nor candidate preparation grants permission to program hardware or
waive unresolved functional failures. Keep 50 MHz closure separately pending.
