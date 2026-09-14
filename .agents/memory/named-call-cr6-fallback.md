---
name: Named CALL CR6 lookup
description: Named CALL operands use readable CR6 C-list lookup syntax while retaining opcode-2 CALL semantics.
---

An unbound named CALL may be written as `CALL Name, Method`, `CALL Name.Method`, or `CALL CR6[Name], Method`. The assembler materializes the capability with a normal LOAD and emits opcode-2 CALL; it must not silently substitute ELOADCALL. A prior LOAD binding remains authoritative, and explicit ELOADCALL remains available.

**Why:** CALL and ELOADCALL are distinct ISA instructions. Named lookup is compiler syntax, so it should not change the selected machine instruction or use ELOADCALL's narrower 5-bit row encoding.

**How to apply:** Preserve explicit loaded-CR bindings first; lower unbound names through CR6 lookup to LOAD + CALL; keep exact dotted C-list labels distinct from abstraction.method names. Keep `church_sim/assembler.js` as the compatibility shim.