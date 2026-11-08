---
name: Wukong LED feedback
description: Two-bit CHANGE counter and overriding Hard Fault indication
---

The user selected a two-bit counter on the Wukong user LEDs and required
an indication of any Hard Fault.

**Why:** Provide physical execution feedback without using one of the two LEDs
exclusively for normal fault status.

**How to apply:** Count successful CHANGE completions modulo four. The documented
design uses a latched simultaneous blink to override the count for Hard Faults.
Keep this observation separate from execution/fault recovery and from approval
to build or flash hardware. The blink encoding is an implementation choice,
not a separately user-selected pattern.

The user explicitly requires: “The FPGA must never freeze any working threads
must continue.”

**Why:** A latched fault display must not be confused with a global execution
halt or a requirement to reset the board before unaffected work can continue.

**How to apply:** Latch only the indication. Keep unaffected Threads executing
and the CHANGE counter advancing behind the fault display; never use the LED
fault flag to stall scheduling or gate execution.
