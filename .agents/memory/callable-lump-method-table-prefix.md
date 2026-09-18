---
name: Callable LUMP method-table prefix
description: Defines the binary-layout requirement for generated artifacts entered through a numbered CALL method.
---

A generated LUMP entered through `CALL` method N must prefix its executable body with canonical opcode-23 BRANCH dispatch entries for every public method. Writing source instructions directly at word 1 is valid only for method-zero entry.

**Why:** A numbered CALL reads the corresponding LUMP word as a dispatch entry. If a builder places the first body instruction there, an unsafe legacy dispatcher can interpret that instruction word as a PC and produce an enormous out-of-memory fetch address.

**How to apply:** When maintaining special-purpose LUMP builders, derive `cw`, hashes, freshness checks, and binary output from `[dispatch table, source body]`, not from source words alone. Dispatch consumers may accept only bounded legacy offsets.