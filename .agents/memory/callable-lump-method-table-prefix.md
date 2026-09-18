---
name: Callable LUMP method-table prefix
description: Defines the binary-layout requirement for generated artifacts entered through a numbered CALL method.
---

A generated LUMP entered through `CALL` method N must prefix its executable body with canonical opcode-23 BRANCH dispatch entries for every public method. Writing source instructions directly at word 1 is valid only for method-zero entry. Calls into these legacy direct-entry LUMPs must specify method zero explicitly; an omitted method operand defaults to method one.

**Why:** A numbered CALL reads the corresponding LUMP word as a dispatch entry. If a builder places the first body instruction there, the dispatcher reads ordinary code as a method-table entry and faults (or an unsafe legacy dispatcher can interpret it as an enormous PC).

**How to apply:** When maintaining special-purpose LUMP builders, either generate `[dispatch table, source body]` or compile every direct-entry call with explicit method zero. Dispatch consumers may accept only bounded legacy offsets.