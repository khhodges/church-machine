---
name: M-bit I/O object
description: Canonical representation and custody rule for CR M state.
---

M is represented by one 32-bit Namespace-table I/O object. Bits 0–15 map
directly to CR0.M–CR15.M; a full-word write sets and clears all sixteen states,
and bits 16–31 are reserved.

**Why:** Separate target-bound ports incorrectly modeled per-register M state
as four hidden capabilities and omitted the required hardware object from the
Namespace table.

**How to apply:** Keep one Inform RW descriptor in the boot Namespace catalog,
issue it only to Namespace, require Namespace execution identity for hardware
writes, and have SWITCH test and consume its destination bit.