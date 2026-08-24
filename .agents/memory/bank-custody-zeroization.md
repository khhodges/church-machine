---
name: Bank custody zeroization
description: Security invariant for dynamic Bank lockbox backing storage and Namespace visibility.
---

Bank lockbox backing memory must be zeroized across the complete allocated
region before it is released to the dynamic allocator, on both withdrawal and
revocation. The backing Namespace entry is a private Outform record. Protection
must apply to the full physical range—not merely its original Namespace
index—so aliased registrations are rejected and memory resolution cannot
bypass custody.

**Why:** Releasing populated custody memory allows a later dynamic allocation
to expose the prior valuable through a fresh capability, defeating the lockbox
confidentiality guarantee.

**How to apply:** Any future Bank lifecycle path that retires, replaces, moves,
or reclaims backing storage must wipe it first, preserve the private range guard
until the entry is removed, and include forced-allocation-reuse plus
Namespace-alias regression tests. A same-instance simulator reset must wipe
Bank state, credentials, allocator bookkeeping, and private range/slot guards
together.