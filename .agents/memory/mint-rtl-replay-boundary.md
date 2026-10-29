---
name: Mint RTL replay boundary
description: Exact-byte execution evidence and immutable-artifact boundary.
---
Exact-byte replay must use shared compiler output unchanged, never a test-local
encoding conversion or host-selected continuation.

On 2026-10-28 the user approved correcting compiler/simulator DREAD/DWRITE
to the ISA sign/magnitude/DR-index format and preparing review-only candidates.
They subsequently approved validation through normal save, binding and admission
in a disposable copy, including simulator and RTL execution. This is not approval
to publish, bind, activate or replace the live saved layout or program hardware.

**Why:** The working older simulator used bit 14 as an immediate-mode selector,
while the approved ISA/RTL uses it as subtraction; identical old words cannot
have both meanings.
**How to apply:** Use newly compiled candidates and explicit adoption. Preserve
old artifacts, but never promise they execute compatibly after the decoder
cutover or introduce a fallback based on guessed intent.

**Why:** Native simulator/reference arithmetic agreement concealed a branch-format
mismatch with the full core. An encoding correction must cover all shared
language emitters and execution profiles; a private test conversion conceals
the interoperability failure rather than correcting it.

**How to apply:** Keep saved binaries immutable and require explicit recompilation
when adopting the current instruction format. RTL success is not synthesis,
timing closure, legal service provisioning, or physical acceptance.
