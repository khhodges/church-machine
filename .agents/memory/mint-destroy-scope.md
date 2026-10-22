---
name: Mint DESTROY scope
description: DESTROY releases the object slot and memory, not GT copies.
---
DESTROY deals with the Namespace slot and memory release, not GT garbage
collection.

**Why:** The user explicitly clarified this boundary during the Mint method
review.

**How to apply:** Describe and design DESTROY around authorized slot release
and safe memory reclamation. Do not add GT tracing, copy removal, or a
requirement to prove no outstanding GTs remain. Stale-GT rejection is distinct
from collecting those GTs.

The agreed destruction sequence increments the slot version before releasing
the slot and memory. Terminal version 511 retires the slot; memory must be
cleared before reuse.

**Why:** The user accepted this release model while reviewing DESTROY.

**How to apply:** Reconcile CREATE's existing allocation-time increment and
allocator bookkeeping with release-time version advancement; do not preserve
the conflicting draft comment as authority.

Keep the free-memory pool as a simple advancing allocator. A separate cleaning
service recycles released memory; do not add arbitrary-block recycling to
CREATE.

**Why:** The user explicitly chose a simple advancing freepool with a cleaning
service rather than complicating Mint's allocation path.

**How to apply:** Distinguish released memory awaiting cleaning from memory
available for allocation. Define the cleaner handoff before implementing it;
do not rewind the allocation cursor across live objects or infer GT collection
as part of this service.
