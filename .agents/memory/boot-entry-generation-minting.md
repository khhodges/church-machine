---
name: Namespace reissue generation
description: Immutable capability identity survives INFORM-to-OUTSFORM transitions; destination bindings use the issued slot sequence.
---

Capabilities are never INVALID: they can transition from INFORM to OUTSFORM,
while their pet name and ID remain immutable references.

**Why:** The user explicitly corrected the plan's claim that clearing a slot
invalidates or revokes the capability. Loss of a local binding is not loss of
the capability's identity.

**How to apply:** Clearing/reloading must preserve identity and use the
INFORM/OUTSFORM resolution model. Do not implement permanent invalidation,
identity replacement, or retargeting to a different object. Slot-sequence
checks concern local bindings, not the continued existence of the reference.

Every locally bound GT for a Namespace entry must take its sequence from that entry's
live Word 1. When a cleared slot is reused, the retained next sequence must be
used consistently for the new Namespace authority, compiler-owned SELF,
Thread/boot capabilities, code capabilities, dynamic data aliases, and lazy
name-resolution capabilities.

**Why:** Releasing a slot increments its generation; reissue uses the retained
generation. Hardcoding sequence zero can either create an immediately
nonmatching local binding or incorrectly accept a binding for a different occupant.

**How to apply:** Select the issued sequence once before committing a reused
slot, then propagate that same value through its W1 and every GT minted for it.
After commit, read W1[29:21] as the authority; never treat a slot number as
sufficient identity.

Every slot release increments its version before the memory object returns
to the free pool. Existing immutable GTs cease to grant access through the
released binding; their bits and reference identity are not rewritten.

**Why:** During Mint V1.1 review, the user clarified: “Version is always
incremented if the slot is released so the memory object is not longer
accessable and can retrun to the free pool.”

**How to apply:** Apply the same rule to release by REPLACE or DESTROY.
Increment at release, retain the generation, and do not increment again on
reuse. For V1.1, do not wrap or reset the generation; slot retirement and
memory returning to the free pool are distinct.

Clearing an assignment must preserve its saved LUMP for later explicit
assignment to another eligible slot, including after a restart. Catalog
membership and the previous slot are not authority to prevent that operation.

**Why:** The user requested removal of legacy restrictions so slots can be
cleared and their LUMPs reloaded later in a new slot.

**How to apply:** Separate library artifacts, saved assignments, generated images,
and active machines. Preserve identity and binding-generation history across sessions; rebind through
verified destination-local copies without changing originals or silently
retargeting capabilities held by other objects.

Cleared generations belong to saved Namespace state even while the image
descriptor is four zero words. Design allocation must read the saved table,
not the older executing image. Fail closed on nine-bit generation exhaustion.

**Why:** Removing a catalog assignment must survive reload without skipping the
freed slot or allowing its former local capability to address a replacement.

**How to apply:** Keep the next generation outside empty descriptors, preserve it
through protected Save, and validate it on explicit reissue. Do not use catalog
membership as a reservation or mutate active memory to stage a design removal.
Every document publisher must preserve that history, including unrelated boot
marker and resident-publication writes, not just the Clear/Save endpoint.