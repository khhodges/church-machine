---
name: Callable LUMP method-table prefix
description: Defines the binary-layout requirement for generated artifacts entered through a numbered CALL method.
---

The simulator's canonical numbered-method format prefixes executable bodies with opcode-23 BRANCH dispatch entries. Do not assume the hardware consumer implements that format before validating it. Writing source instructions directly at word 1 is valid only for method-zero entry. An omitted method operand defaults to method one.

**Why:** A numbered CALL reads the corresponding LUMP word as a dispatch entry. If a builder places the first body instruction there, the dispatcher reads ordinary code as a method-table entry and faults (or an unsafe legacy dispatcher can interpret it as an enormous PC).

**How to apply:** When maintaining special-purpose LUMP builders, either generate `[dispatch table, source body]` or compile every direct-entry call with explicit method zero. Dispatch consumers may accept only bounded legacy offsets.

Legacy bare entries include the header in their LUMP-word offset; convert to logical PC by subtracting one. Canonical BRANCH entries retain PC-relative semantics.

**Why:** Treating WukongCallHome's bare entry 2 as logical PC 2 skipped its first LOAD, leaving BTN_DEV in CR3 and causing the subsequent LED DWRITE permission fault. A manually installed test context bypassed the erroneous CALL path and initially concealed the cause.

**How to apply:** Test through real CALL entry and instruction stepping, not a manually selected body PC. Keep CALL, any legacy dispatch consumers, and displayed method targets consistent.

Never classify a saved bare entry of 2 as inherently corrupt, or promote a BRANCH-entry replacement based on the builder alone.

**Why:** An isolated SelfTest candidate probe found hardware interpreting the BRANCH instruction as a raw word offset, producing an out-of-range NIA before body entry. The exact same bytes completed the body and returned successfully through method zero. This is a consumer-format mismatch, not evidence that the old bare entry was bad.

**How to apply:** Require a numbered CALL hardware-model trace before adopting a candidate. Keep direct-entry success distinct from method-table compatibility, and keep simulation evidence distinct from physical-board release evidence.