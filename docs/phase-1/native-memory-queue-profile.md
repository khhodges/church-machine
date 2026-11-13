# Executed native DATA FIFO/TRANSFER profile

This is the isolated implementation of the [queue contract](readable-cloomc-memory-queues.md),
not installation approval. No saved LUMPs, live Namespace bindings, image, RTL
or physical board are changed.

## Boundaries and immutable provisioning

The executable profile has two eight-word DATA blocks, two producer endpoints,
an independent Cleaner Thread and a native scheduler Thread. Both queues have
capacity two, FIFO discipline, DATA/RW/Inform admissibility and TRANSFER mode.
The known immutable Config R capabilities bind the exact slots, placement,
size and capacity. Different sizes/capacities, LIFO and SHARE are not executable
variants of this profile.

Scheduling is **cooperative**: CHANGE is the only context-switch boundary and
timer IRQ preemption is disabled in the disposable fixture. No CHANGE occurs
while the shared transition guard is held. This is the synchronization
precondition, not an assertion that a read/check/write lock works with arbitrary
preemption. These results must not be promoted to a preemptive deployment.

Offline provisioning installs exact compiler output, immutable capabilities,
zeroed inventory, private state, and canonical Thread continuation frames.
After startup, all allocation, version writes, Namespace integrity calculation,
queue operations, clearing and scheduling execute native instructions.
The test guard rejects host manufacturing of pool DATA capabilities. It permits
only existing machine microcode's executable-view and Thread-context/heap-view
reconstruction at CALL/RETURN/CHANGE.

## Sources and authority

| Source under `simulator/cloomc/` | Responsibility |
|---|---|
| `security_monitor_create_data.cloomc` | SecurityMonitor.Create: pack DATA GTvars, DWRITE the private word, set the relevant hardware M, LOAD the GT, clear temporary storage |
| `memory_queue_mint.cloomc` | Public Create/Destroy endpoints; same-scope, single-slot Namespace update; constructor invocation |
| `memory_queue_free_handler.cloomc` | Private lifecycle, reservations, FIFO custody, commit, cancellation and retirement; shared guard coordinates lifecycle and transport |
| `memory_queue_cleaner.cloomc` | Independently scheduled receive/clear/publish loop |
| `memory_queue_scheduler.cloomc` | Native scheduling from persistent ready flags; no host Wait/Signal callback |

Only the Mint endpoints and Cleaner have the private FreeHandler E grant.
Its helper methods preserve internal operands and **must never be exposed as
public APIs**. Mint never exports Config R, Namespace RW, FreeHandler E or
SecurityMonitor E. The fixture producer programs receive only Mint E, scheduler
handoff authority and bounded test controls/observation.

Each phase validates the actual Config R GT against known immutable capabilities.
The resulting DR actor index is merely a private array offset, not an identity
or caller-authored reservation handle. Each endpoint has at most one open
invocation; the public endpoint cannot enter Stage/Commit without its Reserve
path. Other callers cannot select or cancel that reservation.

## Native ABI and names

CR3 carries the private Config R input. Public Destroy receives the old block
in CR2; successful Create returns CR1, with status in DR1. Internal helpers
return scalar results through DR1 or guard-owned private scalar storage:
ordinary CALL restores DR4–DR15 on return. DR5 is preserved throughout.

QueueState/AllocationState are private RW state; QueueEntries is the private LS
custody object. CleanQueue and ReleasedQueue name distinct row ranges of that
same private object, not public grants. Cleaner uses WorkingBlock=CR1,
Offset=DR6 and SizeWords=DR8. The sources explicitly name Head, Tail, ReadyCount,
ReservedCount, Capacity, OldVersion, NewVersion and Status. Each `.pet` is a
compiler-supported, method-local register alias, not a runtime name lookup.
Numeric data, including serialized GT bits, is not capability authority.

## Transition and surrender proof boundary

Reserve validates the old GT's class, exact mapping, Namespace generation and
LIVE eligibility. It charges capacity and records an endpoint-owned reservation.
BeginInvalidate revalidates under serialization and latches irreversible release
**before** returning into Mint's private update block with the guard held.

Mint advances the version once in software, keeps the slot/location/bounds,
and computes the new Namespace integrity word in native code. SecurityMonitor
then constructs the current new-generation GT. Stage verifies it, stores it in
unpublished custody, clears **both** working copies and the validation cell,
and only then records STAGED. Commit never reloads the staged payload.

For this closed native graph, all new-generation copies are enumerated:
constructor word, CR1 result, CR2 validation copy, current Thread homes, validation
cell and queue custody. The constructor clears its word; Stage clears CR1/CR2
and their actual saved homes, then the validation cell. CALL frames contain
continuation/E identity, not restorable working-CR snapshots. Other producer
copies from before release carry the old generation and fail current validation.
Isolated registers contain Thread, heap, window or executable context, never
these eight-word DATA blocks. No general copy detector or arbitrary-producer
surrender claim follows from this restricted program proof.

Cleaner removes the released custody row and validation copy before clearing.
It yields between every clear write with the queue lock released. Its working
GT persists only in its own live/saved Thread state during suspension. Before
clean publication it clears that working GT and its home; the only remaining
copy is protected clean-queue custody.

The tests inspect every publication for remaining working GTs in all live CRs,
every worker's saved CR homes and constructor scratch. This exercises actual
CHANGE restoration during partial clearing, not a host snapshot substitute.

## Publication, accounting and wakeups

Reservation entries and FIFO publication positions are separate arrays.
Commit appends the completed reservation to the publication ring; a later
reservation can therefore publish first. Ready, reserved and staged counts
are maintained separately. Clearing the owned guard after the complete
lifecycle/transport update is the visibility/linearization boundary.

Faults before this boundary strand the owned transition. New entry to a
stranded guard faults; no recovery, retry repair or rollback is implemented.
Cancellation checks ownership, RESERVED phase and an unset irreversible latch.
It faults after irreversible release, after staging, after commit or twice.
Retirement has a distinct finalization path, not cancellation of a destructive
transition.

Empty allocation hard-faults. Empty Cleaner receive clears its runnable flag
under the same serialization as publication, then yields. Publication sets
that flag before releasing the guard. A wakeup arriving before the subsequent
CHANGE is retained in memory: the native scheduler will run the Cleaner again.
The Cleaner does not poll while suspended. FIFO promises neither fairness nor
bounded latency.

The impossible-full guard applies only to this fully provisioned two-block,
single-owner inventory proof, not arbitrary general queues.

## Retirement

The profile preserves the existing conservative Mint policy: version 510 is the
last issued generation; release retires at 511, invalidates the Namespace
descriptor and never publishes a generation-zero or reusable generation-511
token. Retirement preserves the terminal history and removes the block from
circulation. SecurityMonitor's separate construction test at 511 tests encoding,
not allocator eligibility.

## Execution evidence

Run:

```sh
node simulator/test_security_monitor_create_data.js
node simulator/test_native_memory_queues.js
node simulator/test_queue_transfer_aliases.js
node simulator/test_queue_transfer_primitives.js
```

The full test executes exact compiled candidates through the faithful simulator:
allocation, dirtying, versioned release, independent Cleaner execution, complete
zeroing and same-slot/new-generation reallocation; reverse producer completion
order and both FIFO orders; empty-wait-before-publication; stale and duplicate
release/access; exhaustion; last-generation reuse and retirement; permitted
cancellation and forbidden cancellation after irreversible release/staging;
cuts around reservation, version/descriptor construction, staging, retirement
and every clear write. Another 130 candidates cut before and after state/custody writes.
Negative candidates execute the existing compiler's
fail-closed trap; headless diagnostics may label that trap INVALID_OP.

Historical quarantine-only FreeHandler and synchronous Mint/Cleaner probes
remain separate evidence. This profile is not FPGA qualification, a general
preemptive scheduler, production authentication or an activated allocator.
