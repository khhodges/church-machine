---
name: Bitfield width decision
description: User-approved width-zero semantics for Church BFEXT/BFINS.
---

On 2026-10-04 the user selected “Invalid; support widths 1–31” for
BFEXT/BFINS encoded width zero.

**Why:** The simulator rejected zero while a hardware comment claimed zero
meant 32, and the master ISA did not settle the discrepancy. The user chose
to retain the simulator's width range rather than introduce full-width
sentinel semantics.

**How to apply:** Reject width zero consistently when reconciling the compiler,
simulator, and hardware. ARM's different encoding is comparative information, not authority
to change this decision.

The user subsequently approved preserving the simulator bit layout: width in
bits 4:0, lsb in bits 9:5, rejecting fields extending beyond bit 31 without
register or flag changes. **Why:** preserve existing encoded artifacts while
correcting the FPGA, rather than migrate saved instructions.

Phase 1 now permits runtime bit-position indexing in BFEXT/BFINS, using the
previously unused operand bits while retaining width 1–31.

**Why:** The user approved reclaiming five unused bits for a position DR and
separate sign, with DR0/addition preserving existing immediate-position words.

**How to apply:** Do not treat the upper operand bits as universally unused or
reopen width-zero semantics. Compute position without wrapping, check bounds
before register/flag changes, and capture overlapping-register inputs before
writing the destination. Encoding approval is not implementation authorization.