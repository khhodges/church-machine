---
name: C-list row zero advisory SELF
description: Compiler assistance and save-time validation policy for a C-list owner's Golden Token.
---

When a new C-list is opened, initialize row zero with the symbolic term `SELF`, resolved to the current abstraction's Golden Token once its identity is known. This is compiler assistance, not compiler ownership.

If the programmer later supplies a different row-zero word, preserve it exactly and continue saving. Report the expected and actual words as a warning only. Do not reject, rewrite, auto-fill, or otherwise repair an existing submitted C-list.

**Why:** The programmer controls C-list contents. The sole special convention for row zero is that it should identify the abstraction owning that C-list, and violations are advisory.

**How to apply:** Distinguish creating a new C-list from validating an existing one. Creation may suggest `SELF`; save and validation paths may warn but must not mutate or block because of owner-token mismatch.