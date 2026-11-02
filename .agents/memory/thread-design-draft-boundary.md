---
name: Thread design draft boundary
description: Independent Thread drafts must not become global boot geometry.
---

Keep per-Thread design intent separate from the legacy shared boot layout.
Do not migrate the old unassigned tuple list into every Namespace Thread.

The Namespace Builder must accept the shared Thread contract's supported sizes
per object; 256 words is a default, not a universal size restriction. Preserve
existing sizes unless explicitly edited, including the agreed 512-word B1 Thread.

**Why:** The user explicitly approved removing Builder's fixed-size restriction
through validation, placement and initialization, not merely weakening validation.

**How to apply:** Derive Thread geometry from each selected allocation. Changing
one draft never authorizes resizing running memory or other Thread objects.

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

The user approved saving the reviewed Alice/Mallory bindings and per-Thread
initialization, separately from adopting an executable image.

**Why:** The reviewed preparation explicitly preserved Boot.Thread and left
the current image and hardware untouched; saving inputs is not activation.

**How to apply:** Keep generated-candidate inspection separate from the
committed-image tabs. Carry environment-local approved inputs across merges
only when the exact reviewed Namespace and unchanged target designs still match.
