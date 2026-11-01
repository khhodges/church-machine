---
name: Thread design draft boundary
description: Independent Thread drafts must not become global boot geometry.
---

Keep per-Thread design intent separate from the legacy shared boot layout.
Do not migrate the old unassigned tuple list into every Namespace Thread.

**Why:** The boot configuration endpoint accepts one common generated Thread
geometry, not independent layouts. Sending the currently selected individual
draft there would silently change other Threads.

**How to apply:** Retain explicit review for global geometry. Individual design
adoption needs a separately reviewed build contract; editing and selecting
drafts must not install artifacts or touch hardware. Keep drafts across
artifact revisions within the same binding generation, but do not give a
replacement slot occupant (even with the same name) the previous occupant's
reservations. Namespace and Thread sequence generations are ownership inputs.
