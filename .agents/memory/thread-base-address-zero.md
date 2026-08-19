---
name: Thread base address zero
description: The resident Thread LUMP can begin at word zero, so its location cannot double as a presence test.
---

A non-null CR12 whose location is `0` is an active Thread capability. Code that needs
to distinguish it from a missing Thread must use an explicit sentinel for absence, not
a truthiness check on the location.

**Why:** The boot Thread is canonically resident at address zero. Treating that value
as absent silently drops DR/capability home updates and frame persistence, or raises a
false null-capability fault during a device write.

**How to apply:** Route execution paths that need the current Thread base through the
simulator's shared active-Thread lookup. Keep null-CR12 faults explicit for operations
that require a valid Thread home.