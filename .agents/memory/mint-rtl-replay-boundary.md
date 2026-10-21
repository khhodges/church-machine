---
name: Mint RTL replay boundary
description: Exact-byte execution evidence and immutable-artifact boundary.
---
Exact-byte replay must use shared compiler output unchanged, never a test-local
encoding conversion or host-selected continuation.

**Why:** Native simulator/reference arithmetic agreement concealed a branch-format
mismatch with the full core. An encoding correction must cover all shared
language emitters and execution profiles; a private test conversion conceals
the interoperability failure rather than correcting it.

**How to apply:** Keep saved binaries immutable and require explicit recompilation
when adopting the current instruction format. RTL success is not synthesis,
timing closure, legal service provisioning, or physical acceptance.
