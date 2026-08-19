---
name: Canonical T vs lookup aliases
description: Trust rule for historical LUMP lookup tokens and canonical Word 3 cache values.
---

Historical manifest tokens may remain usable as lookup aliases so old catalogues can still find bytes, but an alias is never the canonical 32-bit cache value and must never drive Outform promotion.

**Why:** Existing catalog records can carry slot-derived or otherwise historical tokens that differ from the issue-blind Number recomputed from canonical dot name and exact binary bytes. Treating the lookup key as trusted T would turn legacy metadata into an unauthenticated promotion path.

**How to apply:** Verify full external identity and exact binary hash first, recompute canonical T independently, classify alias-key responses untrusted for promotion, and write only the recomputed T into resident W3.