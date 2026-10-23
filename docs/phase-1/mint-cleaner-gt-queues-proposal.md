# Phase 1 proposal — pre-provisioned memory and GT queues

**Status:** Proposal for review; not an implementation specification or approval
to change saved LUMPs, Namespace bindings, bootstrap, or hardware.  
**Date:** 2026-10-23  
**Scope:** Mint allocation and release, an independent Cleaner Thread, and
Dijkstra message queues carrying Golden Tokens (GTs).

## 1. Objective

Avoid repeated memory-allocation setup by pre-provisioning blocks of required
sizes. Recycle each block together with its Namespace slot, advancing its
version on release. Clean released memory asynchronously, so CREATE normally
receives already-clean memory.

Memory is identified and accessed through a **GT**. This proposal introduces
no allocation handle, separate generation identifier, replacement memory
reference, or new GT format. Bounds come from the Namespace entry associated
with the GT.

## 2. Proposed arrangement

```text
Initial provisioning
    reserve blocks and Namespace slots
    establish bounds and GTs
    clear blocks
           |
           v
    Clean/free GT queues, one per size class
           |
           | Mint dequeues a suitable GT
           v
    Object initialization and use
           |
           | Authorized DESTROY:
           | advance slot version; enqueue new-version GT
           v
    Released-memory GT queue
           |
           | Independent Cleaner Thread receives GT
           | and clears the complete bounded block
           v
    Corresponding clean/free GT queue
```

The same memory mapping and Namespace slot remain reserved throughout this
cycle. A slot queued for cleaning or available for reuse must **not also be
placed on a general free-slot queue**.

## 3. Responsibilities

| Component | Responsibility |
|---|---|
| Provisioning | Reserve disjoint, aligned blocks; establish Namespace mappings, bounds, permissions and versions; initialize queues; clear initial blocks. |
| Mint | Authorize allocation/destruction, choose the size class, transfer allocation ownership, advance versions at release, and deliver the permitted GT. |
| Release queue | Transfer GT messages from Mint to Cleaner with Dijkstra synchronization. It does not itself revoke or clean memory. |
| Cleaner Thread | Wait for released GTs, clear their complete bounded memory regions, and publish completed blocks to the appropriate clean/free queue. |
| Clean/free queues | Hold GTs for cleared blocks that are available for exclusive allocation. |

Cleaner is an independently scheduled Thread, not an ordinary synchronous CALL
that clears memory in the caller's Thread. It waits when there is no work.

## 4. Initial provisioning

For each configured size class, declare:

- Block capacity, using an explicit word/byte convention.
- Required alignment.
- Number of blocks.
- Reserved memory and Namespace slots.
- Initial valid GTs and the rights needed by the trusted services.
- Queue capacity and the queue's authorized producers and consumers.

Provisioning establishes mappings and clears blocks before publishing their
GTs to a clean/free queue. Initialization must complete before those queues
become available to allocation.

No particular sizes, block counts, slot numbers or physical addresses are
selected by this proposal. They require a reviewed Phase 1 inventory.

Queue and Thread storage must be provisioned independently of the allocator
they enable, avoiding a bootstrap dependency on their own empty queues.

## 5. Allocation

Proposed simplest Phase 1 policy: **exact-size classes**, with no block splitting
or coalescing.

1. Select the queue for the requested capacity and alignment.
2. Atomically dequeue a GT, exclusively removing the block from availability.
3. Establish the intended outward capability rights through the approved Mint
   operations; do not assume all service rights should be passed to the caller.
4. Initialize object-specific contents before exposing a ready object.

The memory is already zeroed. No ordinary allocation-time mapping rebuild,
slot search, clearing pass, or second version increment is needed.

Pre-provisioning does not eliminate object initialization: nonzero headers,
fields and capability contents still depend on the object being created.
Reuse here concerns the backing allocation; it does not equate the identities
or contents of two successive objects.

**Empty queue policy remains open:** wait for cleaning, fail explicitly, or
allow a separately defined expansion path. No fallback allocator or implicit
pool expansion is approved by this proposal. Unsupported sizes must also have
an explicit outcome.

## 6. Release and versioned reuse

For a live block at slot S, version v:

1. Perform the approved destruction authorization and target validation.
2. Ensure there is capacity to publish the release before making an irreversible
   transition. A queue reservation must not expose a message to Cleaner.
3. Advance the Namespace slot version to v+1 through authorized Mint software.
   Old-version GTs cease to authorize access under the normal machine checks.
4. Produce the appropriate new-version GT for the same block and slot.
5. Publish that GT to the release queue and relinquish live allocation ownership.

The hardware checks versions; it does not advance them. The new-version GT,
not the revoked old GT, is the release message.

The version advances once for this release/reuse cycle. Merely moving the
cleaned block into a free queue or allocating it again does not advance it a
second time.

At terminal version 511, the slot must retire rather than wrap. Reclaiming its
memory under another slot is a separate exceptional path requiring a reviewed
authority handoff. It must not silently reintroduce the retired slot into a
size queue.

Exact instruction ordering, queue reservation and interruption behavior remain
review items. A partial release must never advertise a live or dirty block as
clean/free. This proposal does not supply rollback or restart recovery.

## 7. Cleaner operation

1. Receive a GT from the release queue.
2. Access memory through that GT using the ordinary capability checks.
3. Clear the complete block, not merely the portion last used by its owner.
4. Publish the GT to the matching clean/free size queue only after clearing
   completes.
5. Relinquish its working reference and receive the next release.

Cleaner must not hold the queue's synchronization lock while clearing memory.
Queue operations are short; cleaning may take many instructions.

A block has one service-managed allocation owner at a time:

```text
LIVE → RELEASED/QUEUED → CLEANING → CLEAN/FREE → LIVE
```

These are software lifecycle descriptions, not new GT bits or Namespace
descriptor fields. Queues and current service ownership represent the states.

GTs are not assumed to be linear or uncopyable. The trusted services must avoid
duplicate publication and discard working references when handing a block on.
An elevated-version GT retained by Cleaner could still authorize access after
reuse; version advancement alone does not enforce that handoff.

## 8. Dijkstra GT queue abstraction

Proposed conceptual interface:

```text
Send(GT)    — publish one GT; wait if full
Receive()   — remove and return one GT; wait if empty
```

The message payload is a GT, not a raw address/length pair or an allocation
record ID. Size is determined from its authorized memory bounds and matched
to the configured class.

Classical bounded producer–consumer semantics, for capacity Q:

```text
empty = Q       // counting semaphore
ready = 0       // counting semaphore
mutex = 1       // mutual exclusion

Send(GT):
    P(empty)
    P(mutex)
        append complete GT
    V(mutex)
    V(ready)

Receive():
    P(ready)
    P(mutex)
        remove oldest GT
    V(mutex)
    V(empty)
    return GT
```

This is conceptual synchronization pseudocode, not a new ISA or an asserted
CLOOMC calling convention. The release-capacity reservation in section 6 needs
an explicit implementation contract beyond this basic interface.

The documented one-bit DijkstraFlag cannot by itself count multiple pending
messages. Mapping the abstraction to approved synchronization and scheduling
operations must preserve queue counts, atomic publication and wakeups without
lost notifications. Waiting means suspending the Thread, not busy polling.

Queue capacity must be sized against the provisioned inventory, or have an
explicit backpressure policy. An empty clean queue must not cause a waiting
Mint Thread to prevent Cleaner from running or publishing a cleaned block.

## 9. Storage and authority

Cleaner bookkeeping is a candidate for its own reserved Thread heap storage.
That placement is proposed, not an approved heap ABI.

Queue storage has its own authorized access and lifetime. It must not become
arbitrarily writable merely because a caller can send or receive messages.
The specific send/receive capability interfaces remain to be defined.

The object pool is separately managed backing memory, not temporary caller
heap storage. Its blocks must not overlap queue state, service heaps, code,
Threads, C-lists or unrelated allocations.

Receiving a GT does not exempt Cleaner from permissions, bounds or version
checks. Only authorized release producers may publish to its queue; accepting
arbitrary caller-supplied GTs as destruction requests is not proposed.

## 10. Benefits and costs

**Benefits**

- Allocation normally reduces to choosing a size queue and dequeuing a GT.
- Mapping and Namespace-slot setup are reused.
- Background cleaning removes clearing work from ordinary CREATE.
- Fixed-size classes avoid splitting, merging and mixed-size queue searches.
- Memory identity remains entirely GT-based.

**Costs**

- Slots and memory remain reserved even when demand is low.
- One size class can exhaust while another has spare blocks.
- Queue synchronization and Thread scheduling must be implemented correctly.
- Version exhaustion eventually requires slot retirement.
- Initial provisioning and object-specific initialization still exist.

## 11. Relationship to the current prototype

The existing [isolated Mint/Cleaner development](mint-destroy-v1-development.md)
uses separately provisioned CleanerState/CleanerPool views and synchronous
clearing during Allocate. Its released-block search and advancing cursor are
not this proposed queue architecture.

If accepted, this proposal would replace that ordinary allocation path with
pre-provisioned size queues and asynchronous cleaning. It also changes the
earlier release model: reusable blocks retain their Namespace slots rather than
returning them immediately to a general free-slot queue.

Existing prototype evidence must not be cited as proof of concurrent queue
correctness. This document does not authorize migration of live allocations.

See also [Amobea V1](Amobea-V1.md) for the Thread-service design context.

## 12. Review decisions still required

1. Confirm exact-size classes; select capacities, alignments and block counts.
2. Choose behavior for empty queues and unsupported sizes.
3. Define Dijkstra queue operations, scheduling/wakeup behavior, release
   reservation and the CR/DR calling convention using approved ISA operations.
4. Define queue ownership, service GT rights and outward allocation rights.
5. Define Cleaner Thread startup and its private heap layout.
6. Define the interruption boundary and terminal-version retirement path.
7. Confirm Phase 1 object types covered; do not assume arbitrary executable or
   Thread storage can be recycled under the DATA-object release rules.

## 13. Proposed acceptance checks

- Provisioned GT bounds and alignment match each configured size class.
- Each block is exclusively live, queued, being cleaned or clean/free.
- Concurrent operations cannot duplicate a dequeue or lose a publication.
- Old-version GTs fail after release; new-version cleaning GTs work.
- Dirty or partially cleared memory never appears in a clean/free queue.
- Repeated reuse preserves mapping and bounds without a second version bump.
- Queue-full/empty waits do not lose wakeups or deadlock the cleaning pipeline.
- Duplicate or unauthorized release attempts do not erase a live allocation.
- Version 511 never wraps or returns its retired slot to circulation.
- Object-specific initialization is complete before outward publication.

These are proposed checks, not completed test results. Implementation approval,
ISA-model software evidence and FPGA acceptance remain distinct.
