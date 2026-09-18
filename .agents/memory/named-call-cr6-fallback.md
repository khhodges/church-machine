---
name: Named CALL CR6 lookup
description: Unbound named CALL operands compile to one direct CR6 C-list instruction.
---

An unbound named CALL may be written as `CALL Name, Method`, `CALL Name.Method`, or `CALL CR6[Name], Method`. The compiler must emit one CR6-indexed ELOADCALL using the declared C-list row and validated method selector. It must not materialize the capability through a generated `LOAD CR0` followed by `CALL CR0`.

**Why:** The two-instruction expansion discards the named target at the CALL boundary, prevents complete compile-time validation, and can defer an invalid selector/target combination to an `INVALID_OP` runtime fault. The user explicitly corrected this architecture on 2026-09-18.

**How to apply:** Lower unbound names through the active CR6 C-list in one instruction; reject rows above the 5-bit ELOADCALL limit at compile time. Preserve explicit prior LOAD bindings for intentional register-bound CALLs. Keep exact dotted C-list labels distinct from abstraction.method names.