# Review disposition — pre-provisioned memory and GT queues

**Status:** Finalized Phase 1 review disposition, 2026-10-23. Incorporates the
submitted reviewer notes and subsequent qualifications into the
[design proposal](mint-cleaner-gt-queues-proposal.md).

Document review is complete; implementation mechanisms and proof obligations
are not. No tests or safety acceptance are claimed by this note.

## P1 — Cleaner retained GT (§7): mechanism required before acceptance

**Incorporated.** Publish-then-clear is prohibited. The Cleaner must surrender
usable working authority before or atomically with publication to the
clean/free queue, following the [authority-handoff rule](cm-authority-handoff-rule.md).

`LOAD NULL` alone is not proof of surrender: the protocol must account for other
registers, saved Thread state and scratch storage. An unpublished queue entry
can hold the GT in custody only while consumers cannot obtain it.

Fail-closed loss after surrender is permitted; a block becoming reusable while
Cleaner retains working authority is not. The exact approved-ISA mechanism
and fault/scheduling evidence remain implementation gates.

## P2 — Release ordering (§6): reserve before version advancement

**Incorporated.** Authorize/validate, reserve a specific queue position,
revalidate under serialization, advance the version, fill the unpublished
position, then commit surrender/publication.

Qualification: reservation prevents failure **because the queue is full**,
not every possible fault. A fault after version advancement may strand the
block. It must stay unavailable; no implicit rollback, restart recovery or
reintroduction to a free queue is assumed.

## P3 — Empty allocation queue (§5): hard fault for Phase 1

**Resolved as a Phase 1 design policy.** Mint performs a synchronized
nonblocking dequeue. Empty or unsupported size/alignment requests hard fault,
without waiting, automatic expansion or a fallback size class.

Cleaner may block waiting for messages on an empty release queue. These are
different operations. Even with an independent Cleaner Thread, waiting for a
clean block can self-deadlock when all blocks of that class remain live in the
requester's own call chain.

Queue-capacity backpressure still needs an explicit scheduling contract.

## P4 — Copyable GTs (§7/§13): single owner of record

**Incorporated.** Exactly one queue or active service owner of record accounts
for a block, including reserved/unpublished and fault-stopped states. A copied
GT cannot move it contrary to that synchronized state.

GTs remain the sole memory reference. Lifecycle bookkeeping is not a second
memory identity or generation scheme. Tests must distinguish valid access
authority from permission to perform a lifecycle transition.

## Preserved design decisions

- Pre-provision exact-size memory blocks and Namespace slots.
- Carry GTs, not replacement handles or address/length records.
- Retain each reusable slot with its block; do not also free that slot.
- Advance the version once at release; software advances, hardware checks.
- Retire version-511 slots rather than wrap them.
- Clear asynchronously in an independent Thread; never hold the queue lock
  for the clearing loop.
- Do not pretend a one-bit DijkstraFlag is a counting semaphore.
- Do not treat ordinary Send pseudocode as an authority-surrender mechanism.

## Evidence required

Prove the success path and fault/scheduling cuts around reservation, version
advancement, GT staging, surrender, publication and dequeue. Include duplicate
release/publication, saved-state copies, allocation exhaustion and terminal
version behavior. These are required checks, not passing results.

The common handoff rule is restricted to boundaries requiring surrender or
exclusive transfer; intentional sharing remains valid. Reusing a proof pattern
does not transfer correctness from Cleaner to Amobea or M3, or vice versa.
