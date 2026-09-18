---
name: Named CALL CR6 lookup
description: Unbound named CALL operands compile to indexed CALL through CR6.
---

An unbound named CALL may be written as `CALL Name, Method`, `CALL Name.Method`, or `CALL CR6[Name], Method`. The compiler must emit opcode `CALL` in the `CALL CR6[Name]` indexed form, using the declared c-list row and validated method selector. It must not emit ELOADCALL and must not materialize the capability through CR0.

**Why:** The call selects the E-GT directly from the caller's active CR6 c-list. ELOADCALL or LOAD-to-CR0 changes the architectural operation and loses the required indexed CALL identity. The user explicitly corrected this on 2026-09-18.

**How to apply:** Lower unbound names to one indexed CALL through CR6; reject rows above the indexed row field at compile time. Preserve explicit prior LOAD bindings for intentional register-bound CALLs. Keep exact dotted c-list labels distinct from abstraction.method names.