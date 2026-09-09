---
name: C-list row zero advisory SELF
description: Compiler assistance and save-time validation policy for a C-list owner's Golden Token.
---

`SELF` is a universal, case-insensitive contextual pet name. `SELF`, mixed-case spellings, and the internal `__SELF__` spelling all resolve to the current abstraction's Golden Token. Normalize them to exactly one symbolic row-zero owner entry once identity is known. This is compiler assistance, not shared universal authority.

If the programmer later supplies a different row-zero word, preserve it exactly and continue saving. Report the expected and actual words as a warning only. Do not reject, rewrite, auto-fill, or otherwise repair an existing submitted C-list.

**Why:** Programmers need one stable name analogous to `self` or `this`, while every abstraction must retain a distinct identity. The programmer controls C-list contents; the row-zero owner convention remains advisory for existing concrete entries.

**How to apply:** Normalize symbolic SELF aliases in compiler, viewer, Run, Audit, and save-validation paths; never send SELF through the external Namespace/device-registry resolver. Restrict it to row zero and E-only. Existing concrete validation may warn but must not rewrite.

ISA `SAVE` may never target c-list row zero through any target CR. Reject statically known row-zero saves in the assembler/compiler and fault `IMMUTABLE_SELF_CAP` before M-bit, permission, Namespace, or memory checks in simulator and hardware.