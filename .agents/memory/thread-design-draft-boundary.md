---
name: Thread design draft boundary
description: Independent Thread drafts must not become global boot geometry.
---

Keep per-Thread design intent separate from the legacy shared boot layout.
Do not migrate the old unassigned tuple list into every Namespace Thread.

**Why:** The legacy global geometry action changes multiple Threads. Individual
design approval is a separate contract; it must not silently repurpose that action.

**How to apply:** Retain explicit review for global geometry. Individual design
adoption uses explicit per-binding approval followed by a separate build action;
editing and selecting drafts must not install artifacts or touch hardware. Keep drafts across
artifact revisions within the same binding generation, but do not give a
replacement slot occupant (even with the same name) the previous occupant's
reservations. Namespace and Thread sequence generations are ownership inputs.

Approved initial designs own fresh generated bodies, including initialized
registers and tuple values. Do not restore an older prepared continuation over
an explicitly authored initial state. Immutable selected Thread LUMPs require
a new revision, not in-place alteration.

**Why:** Designer values must reach the actual build, while unchanged immutable
artifacts and unrelated Threads retain their ownership boundaries.
