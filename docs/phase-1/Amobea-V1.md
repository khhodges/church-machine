# Amobea V1 — Thread Abstraction

Phase 1 local review copy of repository-root `Amobea-V1.md`, refreshed
2026-10-16. Supporting references are local to this collection.

**Status:** Outline for review, not an implementation specification.  
**Scope:** Phase 1 Thread-local tuple storage and IDE support, within a common
Thread service abstraction that also considers continuation-state services.
CR0 bootstrap binding and rollback contracts remain TBD.

## 1. Purpose

Provide a named `Thread` reference, analogous to `Self`, through which programs
can invoke services belonging to their current Thread.

The Thread abstraction is the “Amoeba” for every Thread. Heap management is
one part of its role, not the whole abstraction. The preferred interface name
is therefore `Thread`, rather than `Heap`.

The intended model is common service code operating on each Thread's own
state, not a single global heap shared by all Threads. The exact reference
binding and calling convention still require review.

### Phase 1 transaction-template requirement

Mint must be completed in Phase 1 and used to initialize new Threads against
templates for each application transaction used for clean recovery.
Mint primes the Thread with Amoeba; Amoeba owns application initialization
and handoff. This is an operational requirement, not satisfied by preinitialized
test fixtures. The exact template representation, authority, initialization
interface and recovery trigger remain subject to approval.

This fresh-context path is distinct from the continuation rollback proposals
below. It does not imply undoing external effects, retrying the faulting
instruction, discarding fault history or restoring OFFLINE code.
See the [Factory Build specification](factory-build-verified-install-approval.md#required-phase-1-mint-completion-and-transaction-templates)
for the scope, work sequence and acceptance obligations.

## 2. Architectural direction

- A program refers to Thread services by name, as it refers to `Self`.
- Mutable records can use the Thread's existing authorized heap; they do not
  inherently require an additional data GT.
- Callable method authority and authority over the data being accessed remain
  distinct. Naming a method does not grant unrestricted memory access.
- The existing Thread data structure can save machine **continuation state
  without using `CHANGE`**.
- Capturing a continuation and switching execution are separate operations.
- This outline proposes software services, not a new ISA instruction, GT
  format, or replacement Thread-state format.

## 3. Proposed service families

The names below illustrate the interface. They are not yet a frozen API.

| Service family | Illustrative operations | Review requirement |
|---|---|---|
| Thread-local records | Read, store, update, allocate, release | Define record addressing, ownership, bounds, lifetime, and results. |
| Continuation capture | `Thread.Save` | Define the captured state and the continuation point, without requiring `CHANGE`. |
| Retained checkpoints | `Thread.Checkpoint` or a retained form of `Thread.Save` | Decide whether a separate operation is needed and where the retained state lives. |
| Continuation restoration | `Thread.Rollback` | Define which saved state is restored and where execution resumes. |

### Naming issue for review

The discussion began with `Heap.Save` for storage operations, then broadened
to `Thread` and saving continuation state. We must distinguish **record
storage** from **continuation capture** before assigning final method names.
This outline does not assign two ambiguous meanings to `Thread.Save`.

Method names also must not be confused with ISA mnemonics: a method called
`Thread.Save` does not imply that one `SAVE` instruction captures every part
of machine state.

## 4. Continuation capture without CHANGE

The Thread's existing continuation structure is the starting point.
Saving continuation state need not transfer execution to another Thread.

The intended conceptual sequence is:

1. Capture a defined continuation into the Thread's continuation structure.
2. Retain that captured version if later rollback is required.
3. Continue on the current Thread without invoking `CHANGE` merely to save.
4. If explicitly requested, restore a retained continuation through the
   agreed rollback contract.

The detailed capture and restore sequence must respect the existing ISA and
Thread protection rules. This outline does not prescribe register layouts,
instruction sequences, or new write permissions.

### Continuation contract to define

- Which registers, stack/frame state, and other execution state are included?
- Does the saved continuation resume after the save call, or at another
  explicitly defined point?
- How is a restored continuation distinguished from the original return
  from saving, if the caller needs that distinction?
- How is the saved state kept consistent while it is captured?
- Which operations may overwrite the Thread's ordinary saved-state area,
  and how is a retained checkpoint protected from those operations?
- What makes a saved continuation invalid after a Thread reset, replacement,
  or change to its executable or capability bindings?
- Is each retained checkpoint strictly one-shot, and how is its consumed
  state protected against copying, rollback, and repeated restoration?

### 4.1 Running-state requirement

The review requires a machine-maintained **is-it-running** bit in the Thread
data structure, checked and updated by `CHANGE`. Here, running means **active
execution ownership**, not the IDE's Run/Walk status. Pausing or single-stepping
does not relinquish ownership.

The bit must be protected from ordinary application writes. A dormant Thread
has the bit clear; an active Thread has it set. Capture of the current Thread's
own continuation without `CHANGE` leaves it set. An ordinary `RETURN` must not
restore an old ownership value from a saved frame.

**Placement remains TBD.** Inspection of the shared Thread layout and Amaranth
distinguishes the live protected indicator at `+17` from the saved frame:

| Bits | Existing field |
|---|---|
| 31–28 | Flags |
| 27–13 | Reserved zero in the live indicator; NIA in the saved frame |
| 12 | Frame size indicator |
| 11–0 | Stack offset |

The earlier assertion that this live word was full conflated the two formats.
Bit 13 of the live indicator is a candidate for running ownership without
moving the heap or reducing NIA/stack ranges. Assignment remains subject to
approval: current validators reject nonzero reserved bits and current writers
clear them. All writers and validators must be updated together. Saved-frame
bit 13 remains part of NIA; it must never be copied into running ownership.
The running bit is live ownership metadata, not rollback-restorable history.

### 4.2 CHANGE details

**Existing ISA baseline:** `CHANGE CRn` supplies one Thread GT and activates
the destination in CR12. Ordinary CHANGE leaves CR15 unchanged. The operand
GT must have no permissions; internal save/load uses microcode authority, not
programmer R/W permission over protected context. Executed `CHANGE CR13` is
invalid under Phase 1's CR13 reservation. Existing Thread, frame, C-List,
capability, and resume validation must remain in force.

**Proposed running-bit extension:** for current Thread A and distinct target B,
the transition must satisfy the following logical sequence. This is a review
contract, not a finalized bus-cycle schedule or a replacement for existing
validation/fault precedence.

1. **Identify:** Latch the operand and establish the validated identities of A
   and B. Compare Thread identity in its Namespace context, not a bare slot
   number that could name another object after SWITCH.
2. **Check ownership:** Reject B if its running bit is already set. Check that
   A's ownership is consistent with the active machine context. An inconsistent
   bit is not permission to repair the state and proceed.
3. **Save A:** Capture the outgoing continuation, including the defined resume
   point after CHANGE. Do not make A available while its save is incomplete.
4. **Prepare B:** Complete the incoming context checks required by the ISA.
   No application instruction may execute in a partially restored context.
5. **Commit ownership:** Clear A's running bit and set B's as part of the
   controlled handoff to CR12. The ownership check and claim must be serialized
   against every other activation path; a check followed by an independently
   interleavable set is insufficient.
6. **Resume B:** Execute only after B's context and ownership are established.

All errors hard-fault; no silent fallback, automatic retry, or restoration of
an unrelated snapshot. The exact commit point, treatment of failures between
memory writes, and disposition of ownership on fault/reset require a defined
implementation contract. Do not claim that a multiword transfer is atomic
merely because it belongs to one instruction. If a fault leaves partial
internal writes, application execution must remain blocked.

Existing no-permissions failure remains `THREAD_PERMISSIONS` (`0x1E`) and
existing Thread-context validation failure remains `THREAD_CONTEXT` (`0x1D`).
The new ownership-check failure's mapping and precedence must be decided
explicitly; this outline does not allocate a new fault code.

**Self-target exception — preserve the approved ISA:** A CHANGE targeting the
current Thread, including `CHANGE CR12`, is valid despite its set running bit.
Save and restore the newly captured continuation and resume after CHANGE.
Keep ownership continuously held; do not expose a transient dormant state,
restore an older checkpoint, or accumulate frames. A set bit on a *different*
Thread is not this exception.

A condition-skipped CHANGE makes no instruction-driven ownership changes;
independent fetch protection and watchdog behavior remain as specified.

### 4.3 Other paths and capture without CHANGE

Companion review reference (outside this self-contained hardware collection):
`docs/reviews/mint-phase1/namespace-update.md`, “Producer/observer inventory”.
Use that shared Mint/Amobea inventory for activation, external control,
observation and lifecycle coverage. The
ownership actions below and the bit-13 writer checklist remain Amobea-specific
obligations, not an independent claim of a complete activation-path list.
Add newly discovered paths to the shared inventory and assess both ownership
serialization and Mint G3/G4 exclusion; proof of either invariant alone is
insufficient for the other.

- **SWITCH:** Its THREADSAVE/Namespace-load/THREADLOAD sequence must obey the
  same ownership discipline across the outgoing and incoming Namespace
  contexts. This outline does not introduce whole-SWITCH rollback on failure.
- **Bootstrap:** Establish ownership of the first admitted Thread under the
  existing reset admission rules. No invented outgoing Thread save is required.
  The revised Amobea CR0 binding remains TBD.
- **Self capture:** An active Thread may save its own continuation at a defined
  instruction boundary and remain active. A blanket "running means no save"
  check would incorrectly prohibit this operation.
- **External capture/restore:** Do not overwrite or inspect an incoherent live
  continuation merely because the IDE is paused. Define authority and a
  controlled capture/restore boundary. A current Thread's own rollback needs
  an explicit controlled path, not an unrestricted bypass of the running check.
- **Fault/reset/replacement:** Define when ownership may be released or
  reinitialized, including retained RAM. Never clear another active owner's
  bit simply to make activation succeed.

### 4.4 Required ownership evidence

Test A-to-B handoff, rejection of an already-active distinct target,
self-target CHANGE without frame growth, save-without-CHANGE preserving
ownership, and IDE pause/step preserving ownership. Exercise SWITCH Namespace
identity, bootstrap, reset, and injected faults at each save/load/commit phase.
Prove there is no conflicting activation, premature release, or execution
with partially restored state. Bit packing must round-trip all existing fields
without truncation once the physical layout is selected.

#### Bit-13 acceptance checklist

This checklist applies to the proposed assignment of live-indicator bit 13.
It does not itself approve the assignment or claim implementation evidence.
See also the companion review at
`docs/reviews/mint-phase1/context-feasibility.md`, “Protected word +17 and running ownership”:
neither the ownership proposal nor a readable copy of indicator bits grants
Mint/PkVerify caller-attestation or raw protected-stack access.

1. **Specify both formats and transforms.** The live indicator at Thread `+17`
   and the saved continuation frame on the protected stack are distinct memory
   words. They share bit positions, not a physical location.
   - On save, construct the frame from the defined stack metadata, flags, and
     complete 15-bit NIA. Do not copy live ownership into the frame.
   - On restore, extract all 15 NIA bits unchanged. Construct the live indicator
     separately, obtaining ownership from the controlled transition rather
     than from the historical frame.
   - Saved-frame bit 13 is NIA bit 0. Test odd and even resume addresses:
     clearing that bit as if it were ownership would corrupt legitimate NIA.

2. **Enumerate every live-indicator writer.** Audit Amaranth, simulator, and
   initialization/image writers, identifying the intended ownership action for
   every path that writes `+17`. Do not simply change every write to preserve
   the bit: some transitions must establish or release ownership.

   | Writer/path | Required ownership action |
   |---|---|
   | Ordinary CALL / RETURN | Preserve current live ownership |
   | Self-target CHANGE | Preserve continuously; no dormant interval |
   | Distinct-target CHANGE / SWITCH | Release outgoing and acquire incoming under the commit protocol |
   | Bootstrap | Establish initial ownership under reset admission rules |
   | Self capture without CHANGE | Preserve |
   | Checkpoint restoration | Apply the controlled restore ownership contract; never import ownership from checkpoint bytes |
   | Fault/watchdog/reset/replacement | Follow the explicitly defined recovery rule; unresolved cases block qualification |
   | Dormant-image construction | Initialize dormant state; image bytes must not independently claim active ownership |

   Match this writer inventory to the activation-path inventory. Include any
   additional discovered writer before claiming completeness. For each path,
   test both the expected bit update and rejection/fault behavior; ordinary
   writes must not silently clear ownership.

3. **Use format-aware validation.** The proposed live format allows ownership
   at bit 13 and requires bits 14–27 to remain zero. The saved frame uses all
   bits 13–27 for NIA, subject to the existing resume checks. These validators
   differ across the entire field, not "exactly one bit." Use separate
   validators or an explicit format parameter; never loosen a shared mask
   without distinguishing the word being validated.
   - Test both live ownership values in their appropriate contexts.
   - Reject each nonzero live reserved bit in 14–27.
   - Verify saved-frame NIA round trips, including odd/even values and boundary
     values. A correctly encoded NIA must still pass executable-range and
     authority checks before execution.
   - Confirm CALL/RETURN and capture/restore neither derive ownership from NIA
     nor alter NIA because of ownership.

Record the coordinated shared-layout, simulator, and Amaranth results before
presenting regenerated Verilog as implementing this contract. Generated output
alone is not qualification evidence.

## 5. Rollback and IDE-reserved space

`Thread.Rollback` is a proposed Thread service. IDE-reserved space could retain
a checkpoint using the existing continuation representation, rather than
inventing an unrelated IDE-only machine-state format.

“IDE-reserved” must mean an explicitly defined reservation. A zero-filled
region alone does not establish ownership or authorization.

The following remain open:

- Whether the reservation is within the Thread or in another authorized area.
- Its size, bounds, ownership, and lifetime.
- Who creates it and which authority permits capture and restoration.
- Whether V1 retains one checkpoint or supports multiple checkpoints.
- Whether the IDE only prepares the reservation or also participates at runtime.
- Whether the first demonstration is simulator-only, and what is required
  before claiming equivalent hardware behavior.

### Checkpoint authority and one-shot restoration

Capture into retained storage and restoration from it must each be gated by
explicit, validated capability authority. The exact binding remains TBD;
this does not require inventing a new data GT if existing authority suffices.
An IDE label or reservation alone is not authorization to write protected
continuation state.

The recommended V1 restore policy is **one successful restore per captured
checkpoint**, distinct from the Thread's running bit. A second restore of the
same consumed checkpoint hard-faults. A separately authorized new capture may
create a new checkpoint identity; it must not make an old consumed identity
usable again.

Consumed-state bookkeeping must be protected and excluded from the state
restored by rollback. Copying checkpoint bytes must not create another
independently redeemable instance of the same checkpoint.

Validation, consumption, and transfer to the restored continuation need one
defined commit protocol that prevents a resumed checkpoint remaining reusable.
The implementation must define fault/reset outcomes, including whether an
interrupted attempt can consume a checkpoint without resuming. Prefer a
fail-closed outcome over replay; do not promise both automatic retry and
exactly-once resumption without evidence.

The running bit prevents conflicting ownership; the consumed mark prevents
repeated restoration. Neither substitutes for the other. Even the first
rollback can replay effects already performed after capture, so one-shot
restoration does not guarantee exactly-once messages or device operations.
Test duplicate restore, copied checkpoint data, rollback of bookkeeping, and
failure at the consumption/resume boundary.

### Continuation is not all historical data

Restoring a continuation does not by itself restore every mutable word that
the earlier execution could access.

The review must choose whether rollback restores:

1. Continuation state only.
2. Continuation state plus selected Thread-local records.
3. Continuation state plus a defined snapshot of the Thread heap.

The restored execution state and any restored data must be mutually
consistent. External effects are a separate matter: rollback cannot
automatically undo an already established telephone connection, a sent
message, or a device operation.

## 6. Telephony record as the first client

The existing demonstration supplies a concrete use case:

- Caller name and telephone number.
- Routing selection and endpoint.
- Conditions and call state.
- Partial updates as processing advances through methods.

Under this direction, application-specific call processing uses common
Thread services rather than inventing independent heap-management machinery.
The current call-record layout remains a demonstration convention, not a
mandatory format for every Thread record.

JSON import, export, and partial update remain IDE-side operations for the
initial demonstration. A runtime JSON parser is not required by this outline.

See [Thread heap call-record demonstration](thread-heap-call-record.md)
for the original record format and demonstration interface.

### 6.1 Phase 1 tuple storage

Phase 1 includes typed tuple/record storage in the current Thread's authorized
heap. The telephony record is the first example, not the only permitted tuple
shape. This section defines review scope, not a claim of completed delivery.

- **Definition:** Each tuple format specifies its fields, types, lengths,
  version, and word extent. The existing call record is the initial concrete
  format; a general tuple-definition syntax remains to be agreed.
- **Ownership:** Explicitly reserve or allocate bounded storage for each tuple.
  Multiple tuples must not overlap each other, continuation frames, or any
  separately reserved checkpoint space.
- **Operations:** Create, read, update selected fields, and release tuples
  through Thread services. Final method names and argument/result conventions
  remain subject to review.
- **Identity:** Use a defined Thread-local tuple reference. Its representation
  and reuse rules must prevent a stale reference from modifying a later
  allocation; a tuple reference does not itself grant new capability authority.
- **Lifetime:** Preserve records across ordinary calls and returns on the same
  Thread. Define reset, Thread replacement, and release behavior explicitly.
- **Validation:** Reject invalid types, oversized fields, out-of-bounds access,
  and unauthorized access before altering a record. Partial updates retain
  omitted fields.

### 6.2 Phase 1 IDE support

The IDE should provide:

1. A view of the selected Thread's tuple definitions, allocated records, and
   reserved/available heap space.
2. Explicit create/reserve and release actions, with the target Thread and
   affected storage shown before destructive changes.
3. Record inspection and JSON import/export, plus partial field updates that
   preserve omitted fields. JSON conversion remains at the IDE boundary.
4. Validation of the complete proposed edit before publication. Changes to
   the Thread, allocation, or record after review invalidate a pending edit.
5. Paused-simulator editing for the initial demonstration; opening a view or
   selecting a file must not write memory.
6. Callable example source and visible field layouts, so IDE and runtime
   operations can be reviewed against the same tuple definition.

IDE tuple editing does not implicitly save a LUMP, alter an editor draft,
persist runtime state, program hardware, or capture a continuation.

### 6.3 Phase 1 acceptance evidence

Demonstrate multiple non-overlapping tuples, allocation exhaustion and safe
release/reuse; read/write agreement between callable methods and the IDE;
JSON round-tripping and omitted-field preservation; rejection without partial
writes; persistence across calls/returns; and invalidation after Thread reset
or replacement. Confirm that another Thread does not silently acquire access.

The existing call-record demonstration is a starting point. Generic tuple
support and the common `Thread` binding require their own implementation
evidence. Continuation rollback and the revised CR0 bootstrap sequence remain
separate review items, not features claimed by tuple-storage acceptance.

### 6.4 Transaction abstraction — Phase 1 demonstration objective

**Definition:** A Transaction is a purposeful human task carried out by
cooperating abstractions within one Thread, using shared tuples and existing
capabilities. Amobea supplies the Thread services supporting that activity.
The private Namespace is an extension of the individual: the enclosing
environment for their private tasks, not an automatic grant to every service.
“Transaction” is the spelling used here for the earlier “Trasaction” concept.

This is a software demonstration objective, not a new ISA object, security
primitive, or claim of database-style atomicity. No implementation pass is
claimed by this definition.

#### Authority and isolation

- Capabilities remain the sole access-authority foundation. Tuple schemas,
  names, allocation handles, and Transaction identifiers grant no new authority.
- Tuples organize the cooperating Thread's shared working state; they do not
  create abstraction-private compartments or introduce tuple ACLs.
- Namespace encapsulation supplies the enclosing privacy boundary. It does
  not imply mutual privacy for all objects or Threads within that Namespace.
- If state must be isolated from cooperating code in this Thread, use a
  separate Thread and Dijkstra messages under existing capability rules.
  Thread separation must be accompanied by the appropriate existing grants;
  a new Thread name alone does not revoke authority already held.
- Message payloads explicitly select what is disclosed. External services
  receive that payload, not implicit access to the individual's Namespace.
  A Transaction identifier is for correlation, never authorization.
- Checkpoint storage and capture/restore use the existing authority model and
  the separately reviewed continuation contract, not tuple-specific privileges.

#### Proposed service contract

The following are semantic operations for review, not frozen method names,
register assignments, or implemented APIs:

| Operation | Meaning |
|---|---|
| Begin | Establish the task's purpose, owning Thread, input tuples, and declared existing capability requirements; allocate bounded working records without minting new authority. |
| Read / Update | Cooperating methods inspect or update shared tuples through Thread services; validate the complete update before writing and preserve omitted fields. |
| Request / Receive | Communicate with an isolated Thread through Dijkstra messages; correlate request/result and apply only the intended response to the task. Exact messaging ABI requires a referenced, agreed contract. |
| Complete | Record the result and release explicitly disposable working allocations; retain only outputs whose lifetime has been specified. This is not an atomic external commit. |
| Cancel / Fail | Record the actual outcome and performed external effects; release safe disposable allocations. Do not silently retry, undo device effects, or hide a machine fault. |
| Checkpoint / Restore | Optional, gated operations using the Amobea continuation contract. State the retained data scope, authority, validity, and one-shot consumption rules. |

Proposed task statuses are prepared, active, waiting for a reply, completed,
cancelled, and failed. These are application progress, not machine ownership
bits: waiting or IDE pause does not by itself release Thread ownership.
Fault/reset disposition and late/duplicate message handling need explicit
contracts before execution tests can pass.

#### Five representative human Transactions

These are selected for breadth of demonstration, not a statistical ranking of
human activity. The first three preserve the motivating examples.

| ID | Human task | Shared tuple state | Isolated/message interaction | Observable demonstration result |
|---|---|---|---|---|
| TX-1 | Phone Mum — communicate | Selected contact, number, connection request, call state, outcome | Contact/telephone services receive only the fields needed for the authorized operation | Lookup, request, and returned call state agree across cooperating methods; denied authority produces no call request. |
| TX-2 | Make supper — sustain daily life | Recipe, servings, ingredients, ordered steps, timer state | Pantry/timer services; appliance control only with separately granted device authority | Recipe selection and preparation update the same records without changing unrelated tuples; cancellation does not claim to reverse cooking. |
| TX-3 | Ask Claude.ai — learn or solve a problem | Question, explicitly selected context, request identity, answer | Isolated assistant gateway receives the reviewed request payload only | Response is associated with the right question; unselected private context is absent from the outbound payload. |
| TX-4 | Buy groceries — obtain necessities | Shopping list, quantities, quoted prices, spending limit, order status | Shop/payment services are isolated; real purchase requires separate authorization | Review and simulated order result agree; insufficient authority or an unapproved amount produces no purchase request. |
| TX-5 | Arrange an appointment — coordinate time and care | Purpose, candidate times, selected slot, disclosed details, confirmation | Calendar/provider services exchange only the selected availability and details | The chosen slot and returned confirmation match; unrelated calendar details are not disclosed. |

#### Phase 1 demonstration and acceptance

**All TX objectives are not run as defined here.** Existing call-record tests
are supporting evidence only, not passes for these complete human activities.

Start with TX-1 as the vertical demonstration, then exercise the same contract
with TX-2 through TX-5. Use an all-resident, simulator-only fixture with
synthetic contacts, messages, orders, and appointments. External services and
devices are explicitly labelled test doubles: no real phone calls, purchases,
appliance commands, personal-data disclosure, or Claude.ai connection is
authorized by this objective. No two-Namespace networking scope is added.

For each task, demonstrate:

1. The Thread designer shows purpose, tuple schemas/allocations, existing
   capabilities, isolated peer Threads, and Dijkstra message connections.
2. At least two cooperating methods share the same tuple across CALL/RETURN;
   multiple allocations do not overlap and release/reuse rejects stale handles
   under the allocator's lifetime contract, without claiming new GT revocation.
3. Inspection and JSON partial updates agree with runtime values. Invalid
   edits are rejected without partial writes; omitted fields remain unchanged.
4. A capability-denied operation faults/rejects under the existing contract
   before an unauthorized effect. Separate-Thread isolation is exercised
   through real message semantics, not substituted direct shared-memory access.
5. Requests disclose only their declared payload; replies cannot silently
   update another Transaction. Specify and test late/duplicate reply behavior.
6. Completion, cancellation, exhaustion, and failure expose the true outcome,
   preserve unrelated records, and follow declared allocation lifetimes.
7. Invalid source or layout produces an in-IDE diagnostic with source context
   and a correction path, preserving the draft and prior saved LUMP. Alice's
   rejection is the regression example; never silently convert private state
   into a shared tuple.

For checkpoint/rollback, the designer must show the intended retained state
and whether the operation is available. Execution acceptance remains **blocked**
until the capture/resume, consumption, reset, and data-scope contracts are
settled and implemented. Then test restoration of exactly that scope,
duplicate-restore rejection, and no automatic replay or undo of external
effects. A design-only checkpoint view is not a rollback pass.

Record exact source/LUMP and simulator identities, inputs, expected and actual
outcomes, and the message boundary used. Missing messaging implementation is a
blocker, not permission to replace isolation with host-only simulated calls.
Hardware evidence is separate. This objective authorizes no bootstrap change,
saved-artifact migration, vendor build, or flashing.

## 7. Bootstrap and CR0 — TBD

A revised CR0 call during bootstrap may establish or enter the Thread service
environment. Its role and exact sequence have not been agreed.

Review must define:

- How the named `Thread` reference is established.
- Which callable abstraction it resolves to.
- How services are bound to the current Thread's data authority.
- When heap and any checkpoint reservations become valid.
- How bootstrap proceeds to the selected application entry.

This outline does **not** authorize changing CR0, the bootstrap sequence,
resident LUMPs, or hardware images.

## 8. Safety and scope boundaries

- Existing type, permission, and bounds rules remain authoritative.
- Thread-local storage is not automatically private to one application
  abstraction executing on that Thread.
- Another Thread does not automatically acquire access to the first Thread's
  records or continuation.
- Saving live Thread state does not automatically save a LUMP, persist to disk,
  or update repository artifacts.
- Invalid or stale checkpoint handling must be explicit; rollback must not
  silently guess a substitute execution state.
- The retained-checkpoint design must not bypass protected continuation-frame
  rules or manufacture capabilities.

## 9. Review decisions

Before implementation, settle:

1. **Reference:** The precise `Thread` binding, analogous to `Self`.
2. **API:** Record-operation names versus continuation-operation names.
3. **Capture:** The exact saved-state set and resume point.
4. **Retention:** The meaning and ownership of IDE-reserved space, with explicit
   capability gates for capture and restore.
5. **Rollback:** Continuation-only versus continuation plus defined data.
6. **Validity:** Checkpoint lifetime, invalidation, one-shot consumption,
   copy/replay prevention, and interrupted-restore outcomes.
7. **Bootstrap:** The proposed CR0 call and initialization sequence.
8. **Demonstration:** Simulator scope and evidence required before hardware use.
9. **Running state:** Protected bit placement, CHANGE ownership commit and
   failure rules, self-target preservation, and coverage of all activation paths.

The running-state requirement and checkpoint review above do not silently
amend the Master ISA or establish RTL conformance. Layout, microcode, simulator,
and acceptance changes require an explicit coordinated implementation.

The central distinction is already clear: **a Thread can save its continuation
without using `CHANGE`; the Thread abstraction can expose that capability
alongside its data services.**
