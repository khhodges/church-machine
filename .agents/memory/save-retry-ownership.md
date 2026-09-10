---
name: Save retry ownership
description: Safety and user-ownership rules for recovery from LUMP save failures.
---

Automatic save recovery is permitted only when the server explicitly reports that the failed operation did not commit and is safe to repeat. Canonicalization, generated identity, approval binding, and atomic-transition failures are IDE-owned incidents; programmers must never be asked to repair generated tokens, seals, SELF capabilities, or Namespace identity.

**Why:** Retrying an ambiguous mutation can duplicate a successful save, while presenting generated-identity defects as settings errors sends the programmer toward changes that cannot correctly repair the artifact.

**How to apply:** Keep genuine field validation editable and name the exact correction. For IDE-owned failures, preserve source/settings, retry at most through a proven pre-commit path, and otherwise enter a non-editable incident state that reports commit status.