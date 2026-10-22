---
name: Mint DESTROY scope
description: DESTROY releases the object slot and memory, not GT copies.
---
DESTROY deals with the Namespace slot and memory release, not GT garbage
collection.

Current work is focused only on reaching a working Mint V1.

**Why:** The user explicitly requested “stay focused on only that nothing else”
when requesting the merged-work progress summary on 2026-10-22.

**How to apply:** Do not add catalog/UI improvements, unrelated maintenance or
other features while pursuing this goal. Keep deferred FPGA acceptance distinct
from the isolated V1 development scope.

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

Mint always requests memory from the cleaning service. The service owns the
simple advancing allocator and recycling of released memory; neither cursor
management nor arbitrary-block recycling belongs in CREATE.

**Why:** The user refined the design from an exhaustion-only cleaning call to
always using the service, explicitly hiding “hitting the wall” from Mint.

**How to apply:** Distinguish released memory awaiting cleaning from memory
available for allocation. Define the cleaner handoff before implementing it;
do not rewind the allocation cursor across live objects or infer GT collection
as part of this service.

**Service boundary:** Every CREATE memory request goes through the same
service interface. Advancing into unused space versus selecting and cleaning
released space is internal to the service. Returned memory must meet the
request's size/alignment and be safe for reuse. The exact call interface and
unavailable-memory behavior remain to be defined.

The user authorized the existing always-approve verifier only for isolated V1
DESTROY development and tests, together with minimum cleaning-service support.

**Why:** Real destruction authorization is not yet defined and must not be
silently replaced by a test approval.

**How to apply:** Keep V1 source/fixture work separate from saved LUMP
publication, Namespace installation and hardware. Do not describe isolated
acceptance as authorized live destruction.

Changing only a simulator fixture's Namespace slot ordering is not enough to
validate Mint's byte-addressed descriptor profile.

**Why:** The isolated V1 attempt reached CREATE's DATA permission check, where
the legacy simulator treated the byte address as a word address. Bypassing that
check or moving test memory just to pass would conceal a profile mismatch.

**How to apply:** Use a compatible approved execution model for lifecycle
acceptance. Keep passing service/component tests distinct from unproven
CREATE/DESTROY end-to-end behavior.

Instruction-boundary RAM-stop/re-entry tests prove only service reservation
containment, not durable restart safety or the caller's prior invalidation.

**Why:** A direct private Cleaner call can pass all clearing/reuse checks
without executing DESTROY's Namespace/history/queue sequence at all.

**How to apply:** Require separate full-path and persistence evidence. Do not
equate an interrupted service's internal DR1 with successful outward RETURN,
or treat a fresh fixture as retained issuance history.

The user approved closing isolated destruction-safety development with the
unfinished full-path acceptance checks deferred until FPGA testing.

**Why:** The user explicitly chose that testing stage rather than continuing
to block development closure on compatible-model lifecycle acceptance.

**How to apply:** Preserve the unproven gates for FPGA testing; do not reopen
development merely because those gates remain unproven, and never equate
administrative closure with safety acceptance or live-use authorization.
