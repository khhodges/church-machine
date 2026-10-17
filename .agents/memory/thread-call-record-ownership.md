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

Moving the call-record action to Thread design is navigation only, not approval
for a saved-design heap editor or automatic Thread preparation.

**Why:** The user explicitly distinguished the Builder design page from the
runtime Thread inspector and required read-only opening against an already
active, paused simulator Thread. The location must not imply new authority.

**How to apply:** Keep future convenience changes explicit: do not auto-enter a
Thread, select a target, provision records, save/build a design, or use hardware
merely because the dialog is opened from Builder.
