---
name: Declared C-list B-flag rule
description: B-set Inform Golden Tokens are not valid materializations of declared LUMP capabilities.
---

Declared capability C-list rows must clear the Golden Token B flag, even when all
other fields (Inform type, target namespace, and permissions) appear valid.

**Why:** A browser-only validator that accepts B-set tokens creates a run and
Code-view discrepancy with the server trust boundary, allowing a malformed
persisted token to look like its declared capability.

**How to apply:** Keep all compile, save, saved-LUMP load/run, and Code-view
checks on the shared capability-token validation path, and test B-set rows
alongside NULL, pending, wrong-target, and wrong-permission cases.