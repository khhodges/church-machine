---
name: Three-LUMP resident profile
description: Validate the three initial abstractions before slot-lifecycle changes; historical boot profiles do not impose catalog reservations.
---

The three initial abstractions must be confirmed valid before implementing
changes to clearing, reassignment, and reloading.

**Why:** The user explicitly requested this prerequisite for removing legacy
slot restrictions. A correct initial set must be established first, not
assumed from catalog membership.

**How to apply:** Identify the exact initial artifacts from authoritative saved
configuration, then inspect their PetNames, immutable identities, bytes,
structure, and required bindings without modifying them. Missing PetNames
require programmer recompilation. Report evidence and blockers before
continuing; this validates LUMPs, not a capability-invalid state.

An explicit approved boot profile remains distinct from catalog-derived
membership. Historical fixed-slot boot profiles are not a general restriction
on the requested clear/reload lifecycle.

**Why:** Manifest history can contain duplicate or newer-looking artifacts;
neither that history nor old fixed-map conventions may silently choose or
reserve the next Namespace's assignments.

**How to apply:** Preserve exact saved selections and historical approvals.
Keep architecture/hardware profile requirements explicit and separate from
generic Namespace editing.