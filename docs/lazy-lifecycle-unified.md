# Unified LUMP Lifecycle — Phase 2 FPGA Design

## Status and scope

This document records the current design direction: a preconfigured SYSTEM
Thread designated by CR13 handles UNAVAILABLE and later delivery events,
one event at a time, to completion. It replaces the earlier USER-side
Wait/CHANGE handoff proposal in this document.

This is a proposed architectural revision, not a claim of installed hardware
support. The current Phase 1 ISA reserves CR13 as NULL and untouched; ordinary
`CHANGE CR13` faults. This proposal therefore requires explicit reconciliation
with that ISA and the installed bitstream before implementation. No RTL edits,
uploads, resets, flashing or new instruction encodings are authorized here.

The user supplied the PP250 precedent: CR13 identifies a SYSTEM Thread that
runs to completion. This document uses that precedent as a design model, not
as independently verified historical or current-FPGA behavior.

Namespace-type LUMPs remain excluded from lazy loading.

## Agreed startup and Thread roles

The existing **Boot.Thread becomes the SYSTEM Thread** in this Phase 2 design.
It is not replaced by an additional dedicated SYSTEM Thread. **Thread 1 and
Thread 2 remain available for user programs.** These are Thread designations,
not an assignment of Namespace slot numbers.

CR13 designates this Boot/SYSTEM Thread for the proposed event-entry mechanism.
Its two responsibilities are:

1. **Startup:** run first and validate the setup before normal USER execution.
2. **Runtime:** handle UNAVAILABLE, delivery and lifecycle events serially,
   with each handler running to completion.

The approved startup sequence is:

- Minimal boot establishes enough resident SYSTEM context and capabilities
  for hardware to enter it safely.
- Boot/SYSTEM checks the setup and performs in-handler hardware checks.
- It finishes that activation and hands off to a prepared resident test Thread
  to exercise a real valid-but-unavailable CALL.
- Subsequent serialized activations test the event, request, completion and
  original-operation resumption paths. No test interrupts a running handler.
- Release normal USER execution only after the required checks pass. A failed
  check hard-faults rather than silently continuing startup.

Boot/SYSTEM remains the same Thread across these roles; startup validation is
not repeated on every event. How entry distinguishes startup from later events
belongs to the event ABI still to be defined.

The earlier Phase 1 simplicity rules below are carried into this Phase 2 design:
no parallel/preemptive handlers and any unblocked resident Thread is an
acceptable next choice. The existing Phase 1 ISA is not changed by this document.
Whether SYSTEM may replace CR13 after startup remains undecided; the Thread-role
mapping does not imply permission to do so.

## 1. Execution and authority model

### Three distinct GT roles

| GT | Purpose | Must not be confused with |
|---|---|---|
| Original target abstraction GT | Authorizes USER's CALL to the user-programmed target and method. Retained with the pending operation. | SYSTEM's execution authority. |
| CR13 SYSTEM Thread GT | Identifies the configured SYSTEM context for hardware event entry. | A service abstraction's executable GT, or an ordinary `CHANGE CR13` instruction. |
| SYSTEM's abstraction GTs | Authorize SYSTEM's own CALLs, such as FreeHandler and flag operations. | The original USER target GT or permissions. |

Normal CALL enters another abstraction **within the same Thread**. When its
valid target is unavailable, the FPGA instead preserves the pending operation
and activates SYSTEM through the proposed event-entry mechanism. USER does not
CALL a system abstraction using the target GT, and hardware does not substitute
a system-service GT into the original CALL.

### Serialized, run-to-completion SYSTEM handling

- Only one event handler executes at a time.
- There is no asynchronous handler preemption, nested event handling or parallel
  Thread/handler execution in this Phase 1 model.
- A second event cannot begin handling until the first handler has finished.
- External bytes may arrive meanwhile. Arrival is not handler execution and
  must not cause re-entry. The ingress retention/acceptance mechanism remains
  to be specified; no particular interrupt, polling or buffering implementation
  is implied.
- SYSTEM finishes registering the pending USER and event before relinquishing
  execution. A DELIVER handler cannot interleave with those updates.
- Multiple outstanding requests may exist after successive handlers finish;
  that is not concurrent execution of their handlers.

**Handler completion is not request completion.** An UNAVAILABLE handler
records the request, sends REQUEST if needed, and finishes without waiting for
the LUMP. A later DELIVER handler installs and signals completion.

After a handler finishes, **any other unblocked resident Thread will do for
Phase 1**. No priority or fairness policy is required. The original USER stays
blocked until its completion condition is satisfied. Behavior when no eligible
Thread exists remains to be defined; do not silently resume a blocked USER.

## 2. Unified numbered charts

IDE remains left, FPGA in the middle, and USER/SYSTEM abstraction execution on
the right. All descriptions are in the fifth text column, with no fifth `|`.
An arrow crossing FPGA does not make FPGA an IDE service recipient.
The OTHER lane in the handler-exit chart means any eligible resident Thread.

U.1–U.8 retain their major roles; substeps now reflect CR13 event entry.
The former USER `CALL Wait` and `CHANGE to SYSTEM` substeps are superseded.

### A. Normal CALL or UNAVAILABLE entry

```text
IDE   FPGA  USER  SYSTEM  COMMENTS
 |     |     |     |
 |     <-----|     |     U.1 USER CALL target method
 |     |     |     |     using original target GT.
 |     |     |     |     Valid and resident:
 |     |---->|     |     U.1a FPGA dispatches target;
 |     |     |     |     still within USER THREAD.
 |     |     |     |     No event or REQUEST.
 |     |     |     |
 |     |     |     |     Valid but unavailable:
 |     |     |     |     U.2 FPGA retains CALL,
 |     |     |     |     target GT, operands/context;
 |     |     |     |     suspends USER execution.
 |     |---------->|     U.2a UNAVAILABLE event entry
 |     |     |     |     activates SYSTEM via CR13.
 |     |     |     |     Not ordinary CHANGE CR13.
 |     |     |     |     U.2b SYSTEM records request,
 |     |     |     |     associates completion F,
 |     |     |     |     registers suspended USER.
 |     |     |     |     No USER CALL Wait(F).
 |     |     |     |     Check local binding.
 |     |     |     |     If ready, use U.5 directly.
 <-----------------|     U.3 SYSTEM REQUEST to IDE.
 |     |     |     |     IDE knows availability.
 |     |     |     |     Ready: send DELIVER now.
 |     |     |     |     Unready: retain REQUEST.
 |     |     |     |     U.3a SYSTEM handler finishes.
 |     |     |     |     USER remains blocked.
 |     |     |     |     Handoff follows chart B.
```

An unauthorized/invalid target is a hard fault, not an UNAVAILABLE request.
For a resolvable non-CALL use, retain that original operation instead of
inventing a target CALL.

### B. Finish an event and run other work

```text
IDE   FPGA  OTHER SYSTEM  COMMENTS
 |     |     |     |
 |     |     |     |     X.1 SYSTEM finishes handler.
 |     |     |     |     Select any unblocked
 |     |     |     |     resident Thread.
 |     <-----------|     X.2 SYSTEM requests handoff
 |     |     |     |     to selected Thread.
 |     |     |     |     CHANGE/context transition:
 |     |     |     |     exact event-exit ABI open.
 |     |---->|     |     X.3 FPGA activates selected
 |     |     |     |     Thread's saved context.
 |     |     |     |     Only then other work runs.
```

X.2 explicitly identifies the required Thread transition. Whether event exit
uses ordinary `CHANGE CRn` or a separately defined event-exit operation is not
yet decided. Do not assume a hidden CR12/CR13 swap, matching swap-back, new
opcode or direct return to the interrupted USER. SYSTEM must remain available
for subsequent serialized events. The exact CR13 preservation/rearming rules
are part of the event-entry/exit ABI still to be specified.

### C. DELIVER and resume the original operation

```text
IDE   FPGA  USER  SYSTEM  COMMENTS
 |     |     |     |
 |---------------->|     U.4 IDE DELIVER to SYSTEM.
 |     |     |     |     Logical message endpoint;
 |     |     |     |     not asynchronous execution.
 |     |     |     |     Prior handler must finish.
 |     |---------->|     U.4e FPGA event entry via CR13
 |     |     |     |     activates delivery handling
 |     |     |     |     at a defined service point.
 |     |     |     |     SYSTEM matches request;
 |     |     |     |     verifies target/evidence.
 |     |     |     |     Resolve local binding.
 |     |     |     |     If a body block is needed:
 |     <-----------|     U.4a SYSTEM CALL FreeN.
 |     |---------->|     U.4b FPGA dispatches FreeHandler
 |     |     |     |     within SYSTEM THREAD.
 |     <-----------|     U.4c FreeHandler RETURN.
 |     |---------->|     U.4d FPGA restores service
 |     |     |     |     caller within SYSTEM.
 |     |     |     |     Install and verify body.
 |     |     |     |     U.5 SYSTEM publishes READY.
 |     <-----------|     U.5s SYSTEM CALL Signal(F).
 |     |---------->|     U.5t Signal executes in SYSTEM;
 |     |     |     |     makes waiting USER runnable;
 |     |     |     |     RETURN stays in SYSTEM.
 |     |     |     |     Handler finishes.
 |     |     |     |     When USER is selected:
 |     <-----------|     U.5a SYSTEM requests handoff;
 |     |     |     |     use event-exit contract X.2.
 |     |---->|     |     U.5b FPGA restores USER.
 |     |---->|     |     U.6 Complete original CALL
 |     |     |     |     with retained target GT;
 |     |     |     |     target executes in USER.
```

U.4e is not an extra IDE forwarding message. It is the hardware activation
required before SYSTEM can process the direct message. The exact service point
and delivery-event admission mechanism are open; no asynchronous interrupt is
introduced by this arrow. Preserve the context of whichever Thread is running
when a permitted event entry occurs.

Signal makes USER eligible; it does not execute CHANGE or promise USER runs
immediately. If another unblocked resident Thread is selected, use chart B
and resume USER at a later selection. There is no USER `RETURN from Wait` on
this path: USER never called Wait.

### D. Retirement in the same serialized service

```text
IDE   FPGA  USER  SYSTEM  COMMENTS
 |     |     |     |
 |     |     |---->|     U.7 Authorized RETIRE request.
 |     |     |     |     Admission ABI remains open;
 |     |     |     |     no concurrent handler entry.
 |     |     |     |     Or SYSTEM initiates locally.
 |     |     |     |     SYSTEM marks Retiring;
 |     |     |     |     prevents new entry;
 |     |     |     |     checks active use/GC roots;
 |     |     |     |     preserves modified state.
 |     |     |     |     If not safe, retain work
 |     |     |     |     and finish this handler.
 |     |     |     |     When reclamation is safe:
 |     <-----------|     U.7c SYSTEM CALL Release.
 |     |---------->|     U.7d FPGA dispatches FreeHandler
 |     |     |     |     within SYSTEM THREAD.
 |     <-----------|     U.7e FreeHandler RETURN.
 |     |---------->|     U.7f FPGA restores service.
 |     |     |     |     KEEP slot and identity.
 |     |     |     |     Publish body as Absent.
 |     |     |     |     U.8 Publish retirement DONE.
 |     <-----------|     U.8s If a waiting requester:
 |     |     |     |     SYSTEM CALL Signal(Fret).
 |     |---------->|     U.8t Signal/RETURN in SYSTEM.
 |     |     |     |     Handler finishes; chart B.
 |     |     |     |     Later use starts at U.1.
```

U.7 is a logical request, not a cross-Thread CALL. Its authorized admission and
whether its caller waits are not yet specified. If there is a blocked requester,
register its completion association explicitly and signal only after safe
retirement. Do not assume an unavailable-CALL trap for retirement or reinstate
the superseded USER-side Wait sequence without an agreed admission ABI.

## 3. Thread ownership and flag contract

### Who performs each action?

| Step | Actor / executing Thread | Authority and effect |
|---|---|---|
| U.1 | USER | CALL with original target abstraction GT. |
| U.1a | FPGA, then USER | Normal CALL dispatch stays in USER. |
| U.2 | FPGA | Preserve the unfinished operation and suspend USER; no USER-side service code is assumed. |
| U.2a | FPGA event-entry machinery | Activate SYSTEM designated by CR13 under the proposed event contract. |
| U.2b | SYSTEM | Record request and register the already-suspended USER against F. |
| U.3 | SYSTEM | Send REQUEST directly to IDE using SYSTEM's service/transport authority. |
| U.3a / X.1–X.3 | SYSTEM, then FPGA | Finish event and activate any unblocked resident Thread. |
| U.4 | IDE | Supply a correlated delivery; does not signal USER or interrupt SYSTEM. |
| U.4e | FPGA event-entry machinery | Admit a later serialized delivery event and activate SYSTEM. |
| U.4a–U.4d | SYSTEM | CALL/RETURN FreeHandler using SYSTEM's abstraction GTs. |
| U.5 | SYSTEM | Publish validated usable binding/body. |
| U.5s–U.5t | SYSTEM | CALL Signal(F); mark the associated USER runnable. Signal's RETURN stays in SYSTEM. |
| U.5a–U.5b | SYSTEM, then FPGA | When selected, transition to USER through the agreed exit/selection mechanism. |
| U.6 | Restored USER | Complete the retained original operation once, without authority substitution. |
| U.7–U.8 | SYSTEM after authorized admission | Reclaim safely; CALL/RETURN Release in SYSTEM; signal Fret only for a registered waiting requester. |

FreeHandler and DijkstraFlag are abstractions, not additional execution Threads.
Calling them from SYSTEM leaves execution within SYSTEM.

### Dijkstra flags: same event meaning, different registration interface

The documented ordinary `Wait(F)` blocks the **calling Thread**; `Signal(F)`
wakes one waiter or stores a signal if nobody is waiting.

Here USER is already suspended by hardware event entry. Therefore:

1. SYSTEM must register **that suspended USER**, not itself, against F.
2. SYSTEM must not call ordinary caller-blocking Wait(F) to do this: that would
   block SYSTEM, contrary to run-to-completion.
3. A scheduler operation or internal event-registration contract must support
   this association. Its API and authority are still to be defined; no new
   `WaitForOtherThread` method is asserted to exist.
4. After validation/install, SYSTEM calls Signal(F) to make the associated USER
   runnable. Restoration later resumes the pending operation, not a Wait return.

F means **“this pending use has a verified usable target binding/body.”**
Fret means **“this retirement request has completed safely.”**
Neither means merely “a message arrived” or “a request was accepted.”

### Sequential ordering, not concurrent-handler synchronization

Within the UNAVAILABLE handler, SYSTEM:

1. Records the request, original operation ownership and expected target.
2. Establishes the completion event and registers the suspended USER.
3. Sends REQUEST if a local verified binding cannot satisfy the operation.
4. Finishes the handler and hands off.

Within a later DELIVER handler, SYSTEM:

1. Matches the pending request and checks its identity/evidence.
2. Resolves/installs and publishes the validated ready result.
3. Signals the matching event once.
4. Finishes the handler and selects an eligible Thread.

No DELIVER handler can execute halfway through the registration sequence.
An immediate IDE response remains for later handling; it does not interrupt the
first handler. Thus the former concurrent-handler registration/CHANGE race is
not part of this Phase 1 design. Correct ordering and request correlation still
matter, but no preemptive locking scheme is introduced.

The ordinary flag's retained-signal behavior remains useful as a primitive
contract; it does not justify adding a USER Wait branch to this lifecycle.

### Pending state and event lifetime

- Retain the original target GT, method selector/operands, caller continuation,
  Thread identity and destination association until completion.
- A one-bit flag neither counts deliveries nor identifies requests. Give each
  pending use an unambiguous completion association.
- Several USERs awaiting the same LUMP still have separate pending uses; one
  Signal is not a broadcast.
- A stale/duplicate delivery must not install again, signal twice, or complete
  another request or a reused Thread/event.
- Do not Reset an event belonging to an active pending use. Reuse must exclude
  stale producers/waiters; exact lifetime/identity rules remain to be specified.
- USER may wait indefinitely; elapsed time alone does not resume or fault it.
  No busy polling, request retry loop or alternate target is introduced.
- Persistent survival across reset/power loss is not implied.

## 4. One lifecycle for all cases

| Case | Shared mechanism |
|---|---|
| Resolved and resident | U.1–U.1a normal CALL; no event or request. |
| Lazy Resolve | SYSTEM checks local binding under U.2b; REQUEST/DELIVER only if evidence/body is needed. No extra rights are granted. |
| Lazy Load | REQUEST/DELIVER supplies the absent body; SYSTEM allocates, installs, signals. |
| Unready/unavailable | Same REQUEST/DELIVER; only the waiting interval changes. The first handler still finishes promptly. |
| Retirement | Same serialized SYSTEM service reclaims body memory; slot remains. Later use returns to U.1. |

SYSTEM communicates directly with IDE. FPGA provides physical transport and
execution transitions, not an extra request/response service layer.
REQUEST and DELIVER are separated in time; this **does not mean asynchronous
interrupt-driven handler execution**.

### FreeQueues and identity

Use FreeHandler's Free64, Free128 or Free256 for an appropriate body block,
where those sizes suffice. `FreeN` in the chart means the selected method, not
a new method name. Larger LUMPs need suitable size classes.

Allocate when delivery can be processed, not throughout the indefinite wait.
The entire LUMP must fit, including metadata and C-list. Free-block authority
must not replace the target's identity or permissions. Queue exhaustion has no
silent fallback allocator; its policy remains separate.

Retirement keeps the Namespace slot and identity and collects memory through
GC. Release enters the return queue, not immediate free reuse. Safe reuse and
zeroing precede reissue; background queue refill remains separately scoped.
Modified-state preservation and GC root/active-use rules remain unresolved.
Do not wait inside a SYSTEM handler for another Thread to finish using an object:
retain the retirement work and finish that handler.

### Selection and faults

Ordinary fetches select the approved LUMP, not the latest compilation.
An explicit `+` test name selects a later version using a new slot. Exact
grammar remains open. Waiting never authorizes a silent revision upgrade.

Invalid authority or integrity hard-faults; absence of a valid target's body is
a waiting condition. SYSTEM status does not bypass capability checks. Hardware
never changes version numbers. Delivery-fault ownership remains to be specified.

## 5. Development and physical acceptance

These are required scenarios, **not tests run or passed**. Capture the exact
bitstream and LUMP identities, active Thread identity, event entry/completion,
request correlation, flag/blocked/runnable state, CALL/RETURN and transition
sequence. Protect private authority in diagnostic output. Transfer ACK alone
is not execution acceptance.

| Test | Scenario | Required evidence |
|---|---|---|
| F.1 | Resident CALL | Original GT dispatches the intended method within USER; no SYSTEM event. |
| F.2 | Unavailable CALL | FPGA retains original operation; CR13 event entry activates SYSTEM, without USER CALL Wait or GT substitution. |
| F.3 | Registration ownership | SYSTEM registers the suspended USER against F; SYSTEM itself never blocks on F. |
| F.4 | Immediate IDE response | First handler completes registration and REQUEST before any DELIVER handler runs; arrival does not re-enter SYSTEM. |
| F.5 | Indefinite unavailability | Request remains pending; handler finishes; another unblocked resident Thread runs; no timeout-driven fault or resume. |
| F.6 | Delivery admission | Incoming data is handled at the defined service point with no asynchronous preemption; previous handler has finished. |
| F.7 | Invalid/mismatched delivery | No completion signal or USER resume; validation-fault ownership follows its agreed contract. |
| F.8 | Duplicate/stale delivery | No second install, signal or completion and no wakeup of a reused identity. |
| F.9 | Multiple outstanding requests | Handlers execute serially; completion of one request affects only its associated USER. |
| F.10 | Several USERs need one LUMP | Each pending use completes correctly; one flag signal is not assumed to broadcast. |
| F.11 | FreeHandler | FreeN/Release CALL and RETURN stay within SYSTEM and use SYSTEM's capabilities. |
| F.12 | Retirement | Only safe reclamation produces DONE/Signal; retain the slot and modified-state obligations. Deferred retirement does not hold SYSTEM indefinitely. |
| F.13 | Original CALL restoration | Target GT, selector, operands and caller continuation remain correct; no skipped work, repeated prior side effects or fabricated USER Wait return. |
| F.14 | Event lifetime | No Reset or reuse erases an active association or redirects stale completion. |
| F.15 | Run-to-completion | No second event handler or other Thread executes while the first handler is active; orderly handler completion precedes the next activation. |
| F.16 | Phase 1 selection | After completion any selected unblocked resident Thread is acceptable; blocked USER is excluded until ready. |
| F.17 | Repeated SYSTEM activation | Event entry/exit preserves the configured SYSTEM destination and context across successive events; verify the agreed CR13 ABI. |

The old preemptive interleaving test is replaced by proof of serialization and
sequential ordering. No simulated parallel-handler behavior is required.
Functional acceptance is hardware-first; no separate simulator implementation
is a prerequisite. Test fixtures, RTL work and physical operations require
their separate authorization.

## 6. Remaining implementation contracts

The following are not settled by the design discussion:

- CR13 provisioning/protection and reconciliation with the existing ISA.
- Exact event entry, protected pending-operation storage, event exit and
  CHANGE relationship; no unapproved swap-back or opcode is assumed.
- Non-preemptive service point for delivery admission and input retention.
- SYSTEM's authorized registration of an already-suspended USER on an event.
- Request ABI, capacity, correlation, event lifetime, cancellation and reset.
- No-eligible-Thread behavior; priority/fairness is not required for Phase 1.
- FreeQueue exhaustion, retirement admission/deferred-work scheduling,
  modified-state preservation and GC safety.

These are implementation details to define and verify, not reasons to reintroduce
concurrent handlers, USER-side Wait on unavailable CALL, or a second fetch
protocol. The earlier four-case document remains discussion history; this
document is the current consolidated design.
