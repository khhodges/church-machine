---
name: Case-insensitive metadata aliases
description: Rules for safely normalizing abstraction registries and suppressing duplicate diagnostics.
---

When a registry retains both canonical display names and normalized lookup aliases, treat every case-equivalent key as one atomic equivalence class. A later registration through any spelling must replace the value observed through every spelling.

**Why:** Updating only the spelling supplied by the latest caller can leave canonical and normalized lookups pointing at different method metadata. Broad diagnostic suppression has a related failure mode: it can hide legitimate errors on later source lines while trying to remove duplicate messages from one invalid instruction.

**How to apply:** Normalize incoming registrations before merging, then rewrite every retained alias from the winning normalized value. Scope diagnostic deduplication to the source location and normalized entity, not the whole compilation.