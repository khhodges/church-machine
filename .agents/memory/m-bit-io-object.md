---
name: M-bit I/O object
description: Canonical representation and custody rule for CR M state.
---

M is represented by one 32-bit Namespace-table I/O object at fixed NS slot 13. Bits 0–15 map
directly to CR0.M–CR15.M; a full-word write sets and clears all sixteen states,
and bits 16–31 are reserved.

**Why:** Separate target-bound ports incorrectly modeled per-register M state
as four hidden capabilities and omitted the required hardware object from the
Namespace table.

**How to apply:** Keep one Inform RW descriptor in the boot Namespace catalog,
issue it only to Namespace, and require Namespace execution identity for both
DREAD and DWRITE. Reads return bits 0–15 zero-extended; writes replace all 16 M
states. In the Namespace UI, classify its Source as “Resident I/O register” and
never offer LUMP Source/Identity controls. SWITCH tests and consumes its
destination bit. Preserve generated
Thread#2 and Thread#3 at slots 11 and 12; later generated Threads skip slot 13.