# Readable CLOOMC memory queues: contracts and implementation boundary

**Status: isolated native profile implemented.** This note incorporates the
submitted GTQueue review. The contracts below are architectural obligations,
not universal proof for every scheduling model. The
[executed native profile](native-memory-queue-profile.md) supplies the bounded
DATA FIFO/TRANSFER implementation and its explicit cooperative preconditions.
No saved LUMP, Namespace binding, image or FPGA is changed.

**Selected implementation direction, 2026-11-11:** resolve the GTMint interface
first. The user did not select the historical private RW/L result-memory
mechanism for this queue implementation. Preserve its historical evidence,
but do not use it as an implicit fallback.

**Subsequent clarification:** SecurityMonitor.Create(GTvars) packs a DATA word
and reads it back as a GT under monitor M authority. This construction path
now executes inside the native queue lifecycle; no separate port decision is required.

Companions: [proposal](mint-cleaner-gt-queues-proposal.md),
[review disposition](cleaner-queue-review-note.md),
[handoff rule](cm-authority-handoff-rule.md),
[historical synchronous prototype](mint-destroy-v1-development.md),
[quarantine-only FreeHandler](../../simulator/examples/free_handler.md).

## 1. Protected transport contract

`GTQueue(capacity, discipline, admissibility, mode)` has immutable,
offline-provisioned parameters. Capacity counts entries, not bytes.
Discipline is FIFO or LIFO; admissibility checks the permitted GT kind,
rights and bounds/size class, not merely a caller's numerical description.
Mode is TRANSFER or SHARE. Only FIFO/TRANSFER DATA memory pools are in scope.
LIFO and SHARE are extension contracts, **not implemented variants**.

TRANSFER postcondition: **no usable producer working copy remains when
transfer completes, before the entry becomes consumer-visible**.
Queue custody is permitted; producer recovery of that custody copy is not.
SHARE intentionally permits retention. A request/response protocol does not
necessarily require SHARE; its authority requirements choose the mode.

| Private operation | Required behavior |
|---|---|
| ReserveSend | Under serialization, reserve capacity and create an invocation-owned, unforgeable reservation; return no payload. |
| Stage | Validate payload, put it in protected unpublished custody, and complete the protocol's proven surrender before reporting transfer-complete. |
| CommitSend | Publish only a transfer-complete reservation owned by this invocation, once; coordinate lifecycle commit and wakeup. |
| CancelReservation | Accept only an unused, owned reservation before staging **and** before irreversible release/version changes. Fault otherwise. |
| TryReceive | Synchronized removal of one published entry, or empty; no wait and no exposure of staged entries. |
| Receive | Same removal; on empty, atomically arrange suspension relative to publication, with no lost wakeups. |

These are conceptual method names, not new ISA instructions or invented
executable syntax. Ordinary SAVE, LOAD NULL, a mode bit, or a method called
Stage cannot establish surrender. There is no global GT-copy detector.
Separate producer/consumer entry authority must not expose QueueState or
QueueEntries LS/RW grants to public callers. Private reservations are not
caller-chosen integer handles or independently reusable capabilities.

## 2. Memory-pool specialization and responsibilities

Provision `Clean[size]` with capacity equal to that exact class's complete
inventory, and `Released` with capacity equal to all recyclable DATA blocks.
Blocks retain slots, mappings and bounds across reuse. Do not also enqueue
those slots in a general free-slot pool. Exclude Threads, C-lists, executable
objects and all aliases into their storage.

| Component / proposed method | Responsibility |
|---|---|
| Mint.CREATE | Authorize request; choose exact class; call private AcquireClean; initialize nonzero object fields if needed; deliver only outward rights. Empty/unsupported allocation hard-faults. |
| Mint.DESTROY | Authorize target; validate old-generation identity and DATA class; use private release protocol; advance version in software once. |
| FreeHandler.AcquireClean | Serialize clean dequeue and eligibility change to LIVE. GT validity alone is not allocation eligibility. |
| FreeHandler.ReserveRelease | Validate LIVE ownership against **old** generation; reserve Released capacity; revalidate under release serialization. |
| FreeHandler.StageReleased | Record irreversible release before mutation; arrange Mint's version advance and stage the **new** generation in protected queue custody. |
| FreeHandler.CommitRelease | Joint lifecycle/transport commit after proven surrender; no intermediate independently usable owner. |
| FreeHandler.Retire | Permanently exclude terminal slot from circulation; never wrap to generation zero. |
| Cleaner.Run | Independently scheduled Thread: Receive, Clear, PublishClean, repeat; suspend on empty, not busy-poll. |
| Cleaner.Clear | Clear every provisioned word through WorkingBlock; release queue locks before the loop. No publication during partial clearing. |
| Cleaner.PublishClean | Reserve matching clean capacity; stage, surrender and jointly commit clean eligibility/publication. |

FreeHandler owns synchronized lifecycle eligibility; GTQueue owns protected
transport/custody. Their updates are **not automatically one transaction**.
An implementation must define joint linearization and fault-stopped ownership.
Setting CLEAN before making the queue visible, or setting ready before lifecycle
eligibility, is not by itself a proof of safe composition.

Offline provisioning must prepare nonoverlapping code, Threads, queue entries,
state, lifecycle records and exact-size DATA blocks; establish authorized
bindings, initial versions/history and rights; zero initial inventory; initialize
all counters and suspension state; and exclude unintended aliases before initial
publication. It does not execute allocation, release or clearing on behalf of
the native service. Queue/Thread storage must not depend on this allocator.

## 3. Release sequence and irreversible boundaries

1. Check authorization, exact old-generation target, class and LIVE eligibility.
2. Reserve queue capacity against that old generation.
3. Revalidate identity and eligibility under the same serialization used by
   competing allocation/release transitions.
4. Latch irreversible release before descriptor/version changes. Cancellation
   now faults even though Stage has not run.
5. Mint advances v to v+1, retaining the same slot and bounds, and constructs
   the authorized new GT. Hardware checks versions; it does not advance them.
6. Stage the new GT, surrender all producer working authority, then jointly
   commit Released ownership and queue visibility.
7. Cleaner receives, clears, surrenders and publishes clean; CREATE reuses
   this generation without another increment.

At v=511 retire rather than wrap. The retirement protocol must also make the
terminal live target unusable before claiming successful destructive retirement;
mere exclusion from a free queue does not revoke version-511 client copies.
The descriptor invalidation and terminal eligibility writes need their own
fault-cut proof. A 510→511 release may produce a final generation under an
explicit policy; a subsequent release at 511 must never produce generation 0.
No executable terminal policy is accepted by the component tests below.

Cancel after any Stage, after irreversible release, after commit or twice
hard-faults. Cancellation is not recovery, rollback or permission to reissue.
Faults may strand blocks/reservations, never expose them early. Fault-stopped
state remains accounted for and cannot be silently restarted or reseeded.

## 4. Accounting, order and wakeups

For Q entries, `reserved + staged + published <= Q`. These categories are
disjoint; a partially surrendered staged entry still consumes capacity.
Transfer-complete but unpublished entries count as staged. Dequeue removes a
published entry while assigning exclusive consumer custody under serialization.
Counter corruption is a hard fault; a single Dijkstra bit is not a count.

The publication linearization point is the serialized transition that makes a
completed entry eligible to Receive. FIFO orders by **publication**, not
reservation. If A reserves before B but B completes first, B may publish and
be received first. Implementations must not use reservation-index ring order
while claiming publication order. LIFO would choose the newest published
entry; this changes order, not surrender obligations. FIFO alone promises
neither scheduler fairness nor bounded latency.

“Impossible full” is a hard fault only for the fully provisioned memory-pool
profile with its single-owner/counting proof: a block arriving from outside a
queue implies one corresponding capacity unit cannot already be occupied.
This is not a theorem for general GT queues; those require an explicit full
policy. Fault-stranded entries remain charged and cannot be retried as fresh
messages to evade that proof.

Empty allocation hard-faults. Empty Cleaner Receive suspends. Its empty test,
waiter registration and release of serialization must compose with commit's
notification. Test publish-before-register, publish-between-check-and-suspend,
publish-after-suspend, multiple publications, dequeue races and resumption.
A “check, then CHANGE” sequence alone does not establish this property.

## 5. Required transfer evidence

Enumerate every working/custody copy: CR arguments/results/locals, saved
Thread homes, suspended continuations, scratch
C-lists, private manufacturing output and persistent imports. Trace which
operation can reload each after the proposed boundary. Clearing the current
CR does not erase an older saved home or remove authority to LOAD a queue row.
Ordinary CALL frames retain caller E authority and continuation, not hidden
working-CR snapshots. RETURN's keep mask can retain current working copies;
Thread restoration is a separate path requiring its own proof. Do not invent
caller-register restoration as an ordinary RETURN effect.

Inject cuts before/after reservation, irreversible latch, each version and
descriptor write, materialization, staging, every working-copy removal,
lifecycle write, publication, notification and dequeue. Also cut every clear
write and restore saved-state paths. For each cut, identify owner of record,
usable working authority, charged capacity and consumer visibility.
Serialization alone does not suppress faults or authorize a recovery path.

Required end-to-end evidence remains: allocation, dirtying, versioned release,
independent Cleaner scheduling, complete zeroing, same-slot reallocation,
stale access/release, duplicate release, exhaustion, terminal retirement,
publication-order races and wakeup interleavings. All must execute exact native
compiled words in the faithful simulator, with no host service callbacks.

## 6. Readable names and ABI

CLOOMC's native-method frontend now accepts method-local
`.pet WorkingBlock CR2` and `.pet SizeWords DR2` declarations before use.
They emit no instructions, apply only to that method, and leave global
conventions unchanged. CR0–CR11 and DR0–DR15 are accepted; duplicate names,
reserved opcode/register names and invalid register numbers are errors.
Do not reuse an alias as a branch label or C-list binding name.
Numeric DR values remain data, never capability identities.

The actual component ABI is explicit:

| Component | Local names | Rights / clobbers |
|---|---|---|
| ClearBlock | WorkingBlock=CR2, SizeWords=DR2, Offset=DR4, Status=DR1 | CR2 W required; DR1/DR4 written, CR2 cleared; CR1 passkey unused in isolated fixture. |
| CancelUnusedReservation | QueueState=CR2, Phase=DR4, ReservedCount=DR5, Status=DR1 | Private CR2 RW; DR1/DR4/DR5 written, CR2 cleared. |

The [full native profile](native-memory-queue-profile.md) supplies the complete
ABI, actual capability bindings, clobber rules and method-local aliases. It
coordinates lifecycle and transport within one private service boundary:
CleanQueue/ReleasedQueue denote private custody row ranges rather than
separately exposed E interfaces. Assigning names alone establishes no authority.
The source documents phase constants UNUSED=0, RESERVED=1, STAGED=2,
PUBLISHED=3 and the irreversible latch. These are software data, not GT bits.

## 7. Executable evidence and precise remaining blockers

**Updated evidence:** [The complete isolated native profile](native-memory-queue-profile.md)
now executes the lifecycle. Run `node simulator/test_native_memory_queues.js`.
The component-only assessment below is retained as historical evidence of
the earlier incomplete state, not the current implementation status.

The subsequent [native M-conformance work](native-queue-m-conformance.md)
corrects LOAD's one-use M handling under the already-defined ISA. It is a
machine prerequisite, not proof of the queue lifecycle.

Run:

```sh
node simulator/test_queue_transfer_aliases.js
node simulator/test_queue_transfer_primitives.js
```

[Native source](../../simulator/cloomc/queue_transfer_primitives.cloomc) implements
only full-count clearing and cancellation guards for a private, already
serialized invocation record. The fixture supplies the exact block size;
ClearBlock is not a public API accepting an untrusted partial size. It has no
publication operation and does not pretend to be an independently running
Cleaner. Components stop at authored RETURN; CALL-frame restoration is not
covered. They are not installed services.

Tests compare aliased and raw-register instruction words, preserve readable
source mappings, execute the exact compiled component words, test clearing and
cancellation write cuts, reject cancellation after staging or irreversible
release, and check zero/out-of-bounds sizes. A native counterexample SAVE plus
LOAD NULL leaves another CR able to write the block: this **disproves that
sequence as sufficient**, not all possible structural surrender protocols.
Fixtures do no runtime allocation, revocation, queue service or cleanup.

The full native fixture resolves those component-only gaps without invoking
the JavaScript DijkstraFlag services: native scheduler readiness implements
waiting/wakeup; SecurityMonitor constructs the new-generation GT; private Stage
and shared commit cover the closed program's working/saved copies and custody.
Its acceptance test passes reuse, stale/duplicate release, exhaustion,
retirement, independent Cleaner execution and wakeup interleavings, including
130 before/after state/custody-write cuts and every partial-clear boundary.

These results apply to the documented cooperative profile and private
capability graph. Arbitrary preemption, arbitrary producer programs, automatic
custody recovery and production installation remain outside that proof.
Historical quarantine and synchronous prototype evidence remains distinct.
