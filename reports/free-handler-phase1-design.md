# FreeHandler — Phase 1 design

Status: design only. No compiled LUMP, runtime change, image installation,
Namespace binding, or hardware operation is included.

The approved inventory is eight Inform Data RW objects in one aligned
1024-word formation. FreeHandler is one resident abstraction with four public
methods and private variables. It distributes prepared capabilities; it does
not create descriptors or convert data words into capabilities.

## Four public methods

The four methods are Free64, Free128, Free256 and Release. Preserve the
Free# naming: each provides an RW object of the stated size. Release relinquishes
an issued object to the service.

Names follow the Church Architecture's functional abstraction boundary:
describe the service, not how it is implemented. Queue representation,
C-list placement and future refill scheduling are private design details,
not part of the public method names. Changing those mechanisms must not
require callers to change their vocabulary or calling contract.

| Method | Method index | Inputs | Success |
| --- | ---: | --- | --- |
| Free64 | 0 | Passkey in CR1, ignored for this profile | 64-word RW GT in CR1; DR1=0 |
| Free128 | 1 | Passkey in CR1, ignored for this profile | 128-word RW GT in CR1; DR1=0 |
| Free256 | 2 | Passkey in CR1, ignored for this profile | 256-word RW GT in CR1; DR1=0 |
| Release | 3 | Passkey in CR1, ignored; object GT in CR2 | NULL CR1; DR1=0 |

No allocation-size or permissions input is needed: the selected method fixes
the exact size and RW rights. These are a new FreeHandler interface, not a
silent rewrite of the saved Mint.CREATE ABI. A later CREATE adapter may choose
a size method, but is not a fifth method in this design. Method indices above
are API indices, not raw encoded CALL selectors.

Proposed status values for this new interface:

| DR1 | Meaning |
| ---: | --- |
| 0 | OK |
| 1 | EMPTY: selected free queue has no available object |
| 2 | INVALID_OBJECT: Release target is not an exact current issued inventory GT |
| 3 | NOT_ISSUED: exact inventory target is already free, returned, or retired |

All ordinary failures return NULL CR1 without modifying queue state. Hard faults
remain hard faults: malformed private bookkeeping, impossible capacities,
failed capability loading and hardware validation failures are not converted
into ordinary statuses. A stale GT may fault in the caller before Release is
entered; this API does not promise to catch that fault as INVALID_OBJECT.

## Standard eight-object formation

Base B must be aligned to 1024 words. Offsets are in words, not bytes.

| Object | Offset | Words | Inclusive limit | Initial class |
| --- | ---: | ---: | ---: | --- |
| 0 | 0 | 64 | 63 | Free64 |
| 1 | 64 | 64 | 63 | Free64 |
| 2 | 128 | 64 | 63 | Free64 |
| 3 | 192 | 64 | 63 | Free64 |
| 4 | 256 | 128 | 127 | Free128 |
| 5 | 384 | 128 | 127 | Free128 |
| 6 | 512 | 256 | 255 | Free256 |
| 7 | 768 | 256 | 255 | Free256 |

For the checked disposable layout, B=7168 and object slots are 32–39.
The formation is reusable at another aligned base and slot group. GT values
are not universal constants: they depend on the selected slot, version, and
canonical provisioning convention. All eight objects must be zeroed and
validated before their GTs become initially available.

## One abstraction; two storage responsibilities

- A resident executable LUMP contains methods and the C-list.
- One private 64-word state block holds all four queues and variables.

The state block is an implementation backing allocation, not another public
service. One abstraction does not make executable E authority writable.

Proposed C-list:

| Row | Binding |
| ---: | --- |
| 0 | SELF E |
| 1 | private State RW |
| 2–9 | prepared object GTs 0–7 |

Normal CALL establishes CR6.M for C-list LOAD. FreeHandler has no scratch L,
Namespace RW, whole-pool RW, or C-list write grant. The eight object GTs provide
authority over their individual regions; together they still cover the full
inventory, so the handler remains trusted with those objects' data.

No new executable-size claim is made: measure the compiled LUMP before final
placement. Candidate state placement is slot 40 at words [8704,8768), a subset
of the previously checked queue reservation. Slots 41–43 and the remaining
192 queue-reservation words are not required by this representation.
This supersedes the four separate queue-state descriptors.

## Private variables: one 64-word block

| Words | Contents |
| --- | --- |
| 0–2 | Free64 head, tail, count |
| 3–5 | Free128 head, tail, count |
| 6–8 | Free256 head, tail, count |
| 9–11 | Returned head, tail, count |
| 12–15 | Free64 ring: object indices 0,1,2,3 |
| 16–17 | Free128 ring: object indices 4,5 |
| 18–19 | Free256 ring: object indices 6,7 |
| 20–27 | Returned ring: capacity 8; initially zero, count zero |
| 28–35 | objectState[8] |
| 36–43 | objectVersion[8], matching actual provisioned GTs |
| 44–63 | Reserved, zero |

Initial free queues have head=tail=0 and counts 4,2,2. Returned has head=tail=
count=0. Count distinguishes a full ring from an empty one; zero is a valid
object index, not an empty sentinel.

State values: FREE=0, ISSUED=1, RETURNED=2, RETIRED=3. Initially all are FREE.
Versions must come from verified bindings, never guessed from vacant slots.
For the approved fresh disposable origin, generation zero may be provisioned.
Capacities and class membership are constants in code.

## Free64 / Free128 / Free256

Each method invokes the same internal operation with fixed class parameters:

1. Clear the ignored passkey from CR1.
2. Check private head/tail/count geometry. Empty returns EMPTY.
3. Read the head index; check class membership and FREE state.
4. Select the corresponding fixed C-list row and LOAD its GT into CR1.
   Use an eight-way fixed-row dispatch initially, not an assumed dynamic-index
   LOAD encoding. Verify the selected GT matches the retained object identity
   and version using supported instructions before committing state.
5. Mark ISSUED, advance head modulo capacity, decrement count.
6. Return CR1 and DR1=OK, clearing private working capabilities on return.

Do not invoke Cleaner or Mint, alter descriptors or versions, split blocks,
borrow another size class, or silently retry failed operations.

## Release

1. Clear the ignored passkey from CR1; inspect CR2 as a capability, not a
   caller-supplied numeric slot/address.
2. Match an inventory object's exact current identity (including GT kind,
   domain, RW permissions, slot and version); reject foreign, attenuated or
   stale identities. Do not re-load the same previously issued object through
   a data-write/LOAD scratch mechanism merely to inspect it.
3. Require ISSUED state. A repeated exact return is NOT_ISSUED and changes
   nothing.
4. Validate Returned queue geometry and available capacity. If an ISSUED object
   exists while all eight return entries are occupied, private state is corrupt:
   hard fault instead of dropping an object.
5. Append the object index, mark RETURNED, advance tail and increment count.
6. Return NULL CR1 and DR1=OK; do not retain CR2 in the handler's output registers.

Release accepts return by a holder of the exact issued capability; no per-caller
ownership ledger or authenticated-owner claim is introduced in this profile.

Release is NOT immediate revocation. Copies of the old GT may still work until
the later version transition is enforced. The object is quarantined: it never
enters a free queue, gets cleared for another owner, or is delivered again
merely because Release returned OK. Finite-inventory Phase 1 permits release
but does not refill. This distinction must appear in caller documentation.

## Execution, fault and recovery boundary

The first execution profile is exclusive single-caller synchronous operation.
No internal CALLs, CHANGE, or explicit yields occur during queue mutation.
That does not prove immunity to preemption or concurrent Threads. Before
multi-caller use, establish an actual serialization mechanism.

The state writes are not atomic hardware transactions. A fault during mutation
is fail-stop. Never reset/reseed the free lists in the same continuing
generation merely to recover availability; an earlier caller may hold a GT.
Reconcile interrupted state or establish a separately approved fresh universe.

Return-mask and private-register clearing must be verified in implementation:
do not leak State RW, a different object's GT, or retained input capabilities.

## Later background Mint refill

Background Mint will consume RETURNED objects, advance versions without wrap,
zero the storage, publish matching descriptors and update the corresponding
retained GT through a protected interface, then enqueue FREE last.
The foreground handler's read-only C-list cannot update itself.

The background publication protocol, ownership during refill, stale cached-GT
revocation checks and exhausted-generation retirement are deferred. No fifth
public method, refill authority grant, or Thread activation is authorized here.

## Implementation acceptance checklist

- Allocate all eight objects; get distinct correct-size, zeroed regions.
- Exhaust each class independently with no cross-class fallback.
- Validate successful CR1/DR1 returns and NULL results on ordinary failures.
- Release each issued object exactly once; Returned grows, free counts do not.
- Reject duplicate, foreign, wrong-version and attenuated releases without
  mutation; distinguish caller-side hardware faults from API statuses.
- Check ring wrap, full/empty discrimination, class bounds, version mismatch,
  invalid state, impossible count, and failure before/during commit.
- Demonstrate that private grants are not returned to callers.
- Verify no descriptor write, version bump, or raw-data GT conversion occurs
  on these foreground methods.
- Prove instruction behavior with exact compiled bytes on the frozen profile
  before claiming runtime acceptance. A host-language queue model alone does
  not prove capability enforcement.

These are planned checks, not passing results. Design review does not constitute
compiler, simulator, RTL, or physical-board execution.
