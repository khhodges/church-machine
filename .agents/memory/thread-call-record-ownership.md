---
name: Thread call-record ownership boundary
description: Keep demonstration allocation cooperative and separate from ISA authority.
---

The call-record demonstration must not infer ownership from zero-filled heap
words. Require explicit programmer reservation before allocating inside a pool.

**Why:** Zero words may belong to unrelated software. The requested allocator
must preserve existing CR5 authority and saved LUMPs, so software ownership is
not a new hardware protection or capability-revocation mechanism.

**How to apply:** Keep ownership separate from record contents and make release
semantics explicit. Do not imply that releasing a record revokes already
compiled fixed-offset methods; those still hold the Thread's existing authority.
