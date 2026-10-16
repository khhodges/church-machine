# Amobea V1 — Thread Abstraction

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

**Placement remains TBD.** The currently defined protected packed indicator at
Thread word `+17` is already full:

| Bits | Existing field |
|---|---|
| 31–28 | Flags |
| 27–13 | NIA |
| 12 | Frame size indicator |
| 11–0 | Stack offset |

Putting the running bit in this word requires an explicitly reviewed repacking
and corresponding range/format changes; no spare bit may be assumed. Another
protected location is an alternative to review, not an approved extra word.
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

See [Thread heap call-record demonstration](docs/thread-heap-call-record.md)
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
