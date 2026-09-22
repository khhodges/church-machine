---
name: Callable LUMP method-table prefix
description: Defines the binary-layout requirement for generated artifacts entered through a numbered CALL method.
---

A generated LUMP entered through `CALL` method N must prefix its executable body with canonical opcode-23 BRANCH dispatch entries for every public method. Writing source instructions directly at word 1 is valid only for method-zero entry. Calls into these legacy direct-entry LUMPs must specify method zero explicitly; an omitted method operand defaults to method one.

**Why:** A numbered CALL reads the corresponding LUMP word as a dispatch entry. If a builder places the first body instruction there, the dispatcher reads ordinary code as a method-table entry and faults (or an unsafe legacy dispatcher can interpret it as an enormous PC).

**How to apply:** When maintaining special-purpose LUMP builders, either generate `[dispatch table, source body]` or compile every direct-entry call with explicit method zero. Dispatch consumers may accept only bounded legacy offsets.

Legacy bare entries include the header in their LUMP-word offset; convert to logical PC by subtracting one. Canonical BRANCH entries retain PC-relative semantics.

**Why:** Treating WukongCallHome's bare entry 2 as logical PC 2 skipped its first LOAD, leaving BTN_DEV in CR3 and causing the subsequent LED DWRITE permission fault. A manually installed test context bypassed the erroneous CALL path and initially concealed the cause.

**How to apply:** Test through real CALL entry and instruction stepping, not a manually selected body PC. Keep CALL, any legacy dispatch consumers, and displayed method targets consistent.