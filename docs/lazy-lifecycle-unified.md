# Unified LUMP Lifecycle — REQUEST, DELIVER and RETIRE

## Status

Design proposal for review, consolidating the earlier four cases into one set
of mechanisms. This is not a claim of installed-bitstream support and does not
authorize implementation, upload, reset or flashing.

## One service, two execution Threads

- The **USER THREAD** executes the requesting abstraction and, when ready, the
  target method. Changing abstractions does not itself change Threads.
- A lifecycle service in the **SYSTEM THREAD** manages pending requests, local
  resolution, installation and retirement. These are roles of the proposed
  service, not a requirement for four separate service abstractions or Threads.
- The **IDE** knows whether the requested approved LUMP is available. It either
  delivers it now or retains the request until it can deliver.
- The **FPGA** preserves execution context, enforces machine checks and supports
  scheduling. It is not an additional recipient of IDE service messages.
- **FreeHandler** provides body memory through the LUMP FreeQueues. Its methods
  can be called within the SYSTEM THREAD; no third Thread is required.

REQUEST and DELIVER are asynchronous service operations. Communication is
physically transported through the board connection, but the logical endpoints
are the SYSTEM THREAD service and IDE. Crossing the FPGA column in the diagram
does not mean invoking another FPGA service.

## Unified message flow

Every arrow has a reference. All explanatory text is in the comments column,
with no fifth vertical separator. `U` references replace the earlier per-case
numbering; the correspondence is listed below. Lettered substeps expose FPGA
instruction execution without renumbering existing messages.

```text
IDE   FPGA  USER  SYSTEM  COMMENTS
 |     |     |     |
 |     <-----|     |     U.1 CALL target method.
 |     |     |     |     Valid and resident:
 |     |---->|     |     U.1a FPGA dispatches CALL;
 |     |     |     |     target runs in USER THREAD.
 |     |     |     |     No CHANGE or REQUEST.
 |     |     |     |
 |     |     |     |     Valid but needs service:
 |     |     |     |     preserve operation/context;
 |     |     |     |     U.2 USER handoff publishes
 |     |     |     |     local request + completion F.
 |     <-----|     |     U.2w USER CALL Wait(F).
 |     |---->|     |     U.2x Wait runs within USER.
 |     |     |     |     Consume signal if present;
 |     |     |     |     otherwise register waiter.
 |     <-----|     |     U.2a USER-side wait/scheduler
 |     |     |     |     executes CHANGE to SYSTEM.
 |     |     |     |     FPGA saves USER context;
 |     |     |     |     validates SYSTEM Thread GT;
 |     |---------->|     U.2b FPGA restores SYSTEM.
 |     |     |     |     Pending CALL stays retained.
 |     |     |     |     Check local binding first.
 |     |     |     |     If locally satisfiable,
 |     |     |     |     proceed directly to U.5.
 |     |     |     |     Otherwise retain request.
 <-----------------|     U.3 REQUEST to IDE.
 |     |     |     |     IDE checks availability.
 |     |     |     |     Ready: DELIVER now.
 |     |     |     |     Unready: retain REQUEST.
 |     |     |     |     USER waits indefinitely;
 |     |     |     |     SYSTEM/other Threads run.
 |     |     |     |
 |---------------->|     U.4 DELIVER from IDE.
 |     |     |     |     Match pending request;
 |     |     |     |     verify identity/authority.
 |     |     |     |     Resolve local binding.
 |     |     |     |     If body is needed:
 |     <-----------|     U.4a CALL FreeHandler.FreeN.
 |     |---------->|     U.4b FPGA dispatches method
 |     |     |     |     within SYSTEM THREAD.
 |     <-----------|     U.4c RETURN from FreeHandler.
 |     |---------->|     U.4d FPGA restores service
 |     |     |     |     caller in SYSTEM THREAD.
 |     |     |     |     install and verify body.
 |     |     |     |     Publish verified binding.
 |     |     |     |     U.5 SYSTEM publishes READY.
 |     <-----------|     U.5s SYSTEM CALL Signal(F).
 |     |---------->|     U.5t Signal runs in SYSTEM;
 |     |     |     |     wake waiter or store signal.
 |     |     |     |     When USER is scheduled:
 |     <-----------|     U.5a SYSTEM-side scheduler
 |     |     |     |     executes CHANGE to USER.
 |     |     |     |     FPGA saves SYSTEM context;
 |     |     |     |     validates USER Thread GT;
 |     |---->|     |     U.5b FPGA restores USER.
 |     <-----|     |     U.6w USER RETURN from Wait.
 |     |---->|     |     U.6x USER handoff continues.
 |     |---->|     |     U.6 Complete pending CALL;
 |     |     |     |     FPGA dispatches target
 |     |     |     |     within USER THREAD.
 |     |     |     |
 |     |     |     |     LATER: authorized retirement
 |     |     |---->|     U.7 Queue RETIRE request.
 |     <-----|     |     U.7w USER CALL Wait(Fret).
 |     |---->|     |     U.7x Wait runs within USER;
 |     |     |     |     register waiter if needed.
 |     <-----|     |     U.7a USER-side wait/scheduler
 |     |     |     |     executes CHANGE to SYSTEM.
 |     |---------->|     U.7b FPGA saves USER and
 |     |     |     |     restores SYSTEM context.
 |     |     |     |     Or service initiates under
 |     |     |     |     an authorized local policy.
 |     |     |     |     Mark Retiring; prevent entry.
 |     |     |     |     Establish safe reclamation;
 |     |     |     |     preserve modified state.
 |     <-----------|     U.7c CALL FreeHandler.Release.
 |     |---------->|     U.7d FPGA dispatches Release
 |     |     |     |     within SYSTEM THREAD.
 |     <-----------|     U.7e RETURN from FreeHandler.
 |     |---------->|     U.7f FPGA restores service
 |     |     |     |     caller in SYSTEM THREAD.
 |     |     |     |     KEEP slot and identity;
 |     |     |     |     publish body as Absent.
 |     |     |     |     U.8 Publish retirement DONE.
 |     <-----------|     U.8s SYSTEM CALL Signal(Fret).
 |     |---------->|     U.8t Signal runs in SYSTEM;
 |     |     |     |     make requester runnable.
 |     <-----------|     U.8a CHANGE to USER when
 |     |     |     |     ready and scheduled.
 |     |---->|     |     U.8b FPGA saves SYSTEM and
 |     |     |     |     restores requesting USER.
 |     <-----|     |     U.8w USER RETURN from Wait.
 |     |---->|     |     U.8x USER caller continues.
 |     |     |     |     Later use starts at U.1.
```

**U.3 and U.4 go directly between SYSTEM and IDE.** There is no intermediate
“forward to FPGA / forward to IDE / deliver to FPGA / deliver to service”
message sequence.

### CALL versus CHANGE: explicit hardware responsibilities

| Action | FPGA behavior | Thread outcome |
|---|---|---|
| CALL target method | Validate target authority and dispatch-table selector; establish the method's execution context. | Another abstraction executes in the same USER THREAD. |
| CHANGE to SYSTEM | Validate the permissionless SYSTEM Thread GT; save outgoing USER context and restore SYSTEM context. | USER stops executing; SYSTEM executes. |
| CALL FreeHandler method | Perform normal CALL dispatch and caller-frame handling. | FreeHandler executes in SYSTEM, not a third Thread. |
| RETURN from FreeHandler | Restore the abstraction caller's saved CALL context. | Lifecycle service continues within SYSTEM. |
| CHANGE to USER | Validate the permissionless USER Thread GT; save outgoing SYSTEM context and restore USER context. | USER resumes its preserved continuation. |

`CHANGE to SYSTEM` and `CHANGE to USER` are diagram labels for **CHANGE CRn**,
where CRn holds the appropriate permissionless Thread GT. They are not new
instruction syntax or implicit CALL effects. `FreeN` denotes the selected
Free64, Free128 or Free256 method, not a new method name.

**Pending-CALL handoff remains a design boundary:** U.2a requires an explicit
handoff execution path. An unavailable CALL cannot simply execute the next
user instruction, and ordinary CHANGE normally preserves its own continuation,
not an earlier unfinished CALL. The mechanism that reaches CHANGE while retaining
that CALL and restores its completion at U.6 still needs definition and
installed-RTL verification. The chart shows the required sequence, not an
assertion that CALL automatically performs CHANGE today.

U.5 publishes completion and U.5s–U.5t signal its event, **not CHANGE**.
Signal returns normally to its SYSTEM caller before subsequent scheduler work.
The analogous Signal at U.8s also returns within SYSTEM.
U.5a is the actual Thread
transition, shown from SYSTEM when it is running and selects USER. If another
Thread is running, scheduling must first provide the appropriate execution
context; an IDE delivery does not asynchronously execute CHANGE by itself.
While USER waits, scheduler-directed CHANGE operations may run other Threads.

The chart uses CALL as the concrete pending operation. For a non-CALL reference
use, retain and complete that original operation instead; do not insert a CALL
to the target merely because resolution was needed.

U.7 queues a software request; it is not a cross-Thread CALL. The chart shows a
blocking retirement requester explicitly yielding with CHANGE and later being
resumed with CHANGE. A retirement initiated within SYSTEM omits those requester
transitions. The exact service ABI remains proposed.

## Shared mechanisms

### Event flags and exact Thread ownership

Use the documented **DijkstraFlag.Wait / Signal** semantics for completion.
The flag implements event synchronization; CHANGE implements the context switch.
Neither is a substitute for the other. The ownership below is the proposed
development contract, not evidence that the installed hardware already supports
the missing-CALL handoff.

`F` identifies one pending use's completion event. `Fret` identifies one
blocking retirement request's completion event. These are symbolic event
capabilities, not assigned slots or register operands.

| Step | Invoking Thread / actor | Abstraction or role executing | Required effect |
|---|---|---|---|
| U.1 | USER | Original caller | Issue the target CALL. A resident target executes in the same Thread. |
| U.2 | USER, in the proposed pending-operation handoff | Request preparation | Preserve the unfinished operation; associate an initially unsignaled completion event; publish the complete local request. How this handoff is entered remains unresolved. |
| U.2w–U.2x | USER | DijkstraFlag.Wait(F) | CALL enters Wait within USER. Consume a retained signal, or register USER as blocked on F. |
| U.2a | USER | Wait/scheduler path | If blocked, execute CHANGE using the SYSTEM Thread GT. Scheduler code is still executing in USER before the transition. |
| U.2b | FPGA transition | CHANGE microcode | Save outgoing USER context and restore SYSTEM. Only after this transition does SYSTEM execute. |
| U.3 | SYSTEM | Lifecycle service | Consume the local request, check local availability, and send REQUEST directly to IDE if needed. |
| U.4 | IDE sends; SYSTEM processes | Delivery handler in lifecycle service | Receive now or later; match the request and validate evidence. Transport arrival alone is not Signal. |
| U.4a–U.4d | SYSTEM | FreeHandler.Free64/Free128/Free256, then service | CALL and RETURN stay in SYSTEM; allocate only if a body is needed. |
| U.5 | SYSTEM | Lifecycle service | Finish validation/install/binding and publish the completed result before signaling. |
| U.5s–U.5t | SYSTEM | DijkstraFlag.Signal(F) | CALL Signal within SYSTEM. Wake the registered USER or retain a signal for its future Wait. RETURN stays in SYSTEM. |
| U.5a | SYSTEM in this chart | Scheduler path | Select runnable USER and execute CHANGE with its Thread GT. Signal itself does not switch Threads. |
| U.5b–U.6x | USER after FPGA restore | Suspended Wait/scheduler path, then request handoff | Finish Wait and RETURN within USER to the preserved handoff continuation. |
| U.6 | USER | Original operation/target | Complete the preserved operation once; a pending CALL enters its target through normal validated dispatch. |
| U.7, U.7w–U.7b | Requesting USER, then SYSTEM | Request preparation, Wait(Fret), scheduler | Publish the retirement request, wait and switch using the same event mechanism. |
| U.7c–U.7f | SYSTEM | FreeHandler.Release, then lifecycle service | After GC safety/state checks, release body memory; CALL/RETURN stay in SYSTEM. |
| U.8–U.8t | SYSTEM | Lifecycle service, then Signal(Fret) | Publish retirement completion before signaling. Keep the Namespace slot and identity. |
| U.8a–U.8x | SYSTEM scheduler, then restored USER | CHANGE, then Wait return | Resume the requester when scheduled; its Wait returns in USER. |

**CALLing Wait does not run a “flag Thread.”** Wait executes within the calling
USER THREAD until CHANGE suspends it. Likewise, CALLing Signal or FreeHandler
does not leave SYSTEM. Scheduler is a software role, not an implied third Thread.
If a selected implementation uses a separate scheduler Thread, its extra CHANGE
transitions must be explicitly added rather than silently attributed to SYSTEM.

The chart shows the blocking branch. If Wait consumes a signal already present,
it returns in USER without U.2a–U.2b. There is no mandatory CHANGE for a completed
event. A locally satisfied request in SYSTEM still publishes READY and Signals F;
it skips only the IDE exchange and unnecessary body allocation.

#### Flag semantics and ordering

1. **Associate before publication (USER handoff).** Establish F and the protected
   association between request, USER continuation, target and destination before
   exposing the request to SYSTEM. The provisioner/allocator of event objects is
   not yet selected; USER uses only an authorized event capability.
2. **Publish then Wait (USER).** Publish the local request before Wait can block.
   SYSTEM must be able to find that work after the switch. This is not U.3:
   only SYSTEM sends the external REQUEST to IDE.
3. **Wait atomically (USER Wait/scheduler path).** Consume an existing signal,
   or register the waiter and arrange suspension with no lost-wakeup window.
   Signal must not be overwritten by a subsequent stale “blocked” update.
   Atomicity is a required contract; its concrete scheduling mechanism is open.
4. **Publish completion then Signal (SYSTEM).** F means “this pending use has a
   verified, usable binding/body,” not “bytes arrived.” Fret means retirement has
   completed safely, not merely “RETIRE was accepted.”
5. **Consume once (USER).** A completed wait consumes its notification once.
   Restore the waiting continuation, not an arbitrary caller or newer request.
   A duplicate DELIVER must not cause another Signal/completion for that request.
6. **Retain early signals.** If no waiter exists yet, Signal stores the signal
   for the next Wait. Do not clear it between request publication and Wait.
7. **No Reset in an active request.** Reset can clear flag state and waiters;
   it is not a safe preparation step once a request is visible. Reinitialization
   or reuse requires no remaining waiter, producer or stale completion able to
   address the old event. Exact lifecycle/generation rules remain to be defined.
8. **No Test-then-CHANGE substitute.** A nonblocking Test followed by an
   unsynchronized CHANGE has a race; use the Wait registration contract.

The documented flag wakes one waiter or stores one signal; it is **not a
counting semaphore** and does not carry request identity. Use an unambiguous
completion association per pending use; do not use one global flag for unrelated
requests. Multiple USERs awaiting the same LUMP still need separately tracked
completion events, or an explicitly designed queue protocol. One Signal is not
a broadcast and does not implicitly complete every waiter.

While F is unsignaled the USER stays blocked indefinitely. No timeout, periodic
retry, or busy polling is introduced. SYSTEM and other runnable Threads may run.
The incoming transport's notification of SYSTEM, and service-queue scheduling,
are separate from F: IDE does not directly signal USER or invoke CHANGE.
Their implementation must be specified before physical acceptance.

For SYSTEM-initiated background retirement there is no requesting USER waiting
on Fret; omit that caller's Wait/Signal/CHANGE round trip. GC safety requirements
and local FreeHandler CALL/RETURN behavior remain unchanged.

#### Unfinished CALL versus ordinary Wait

Wait's own CALL/RETURN continuation and the original unfinished target CALL
are distinct. Returning from Wait alone does not manufacture the target's CALL
frame or re-execute earlier user side effects. The handoff must preserve the
original operands, method selector, caller context and completion ownership.
Entering that handoff and returning to the original pending operation remain
the key unimplemented/unverified boundary. Dijkstra synchronization solves
notification, not this instruction-continuation problem.

#### Development and hardware-test requirements

These are acceptance scenarios, **not tests executed or passed**. Capture exact
bitstream/LUMP identities and active Thread identity at the transitions.
Observe request correlation, flag/waiter state, runnable/blocked state, CALL/RETURN
and CHANGE sequence, and original-operation completion without exposing private
authority. A transfer acknowledgement alone proves none of these outcomes.

| Test | Scenario | Required evidence |
|---|---|---|
| F.1 | Target already resident | Target CALL remains in USER; no lifecycle Wait, REQUEST or CHANGE. |
| F.2 | Immediate valid delivery | USER Wait registers correctly; SYSTEM processes delivery, publishes READY and Signals; USER completes once. |
| F.3 | Signal before Wait | Signal is retained and consumed; Wait returns without a blocking CHANGE. Exercise the event primitive independently if normal single-core request ordering excludes this interleaving. |
| F.4 | Signal at suspension boundary | Sweep permitted interleavings around waiter registration and CHANGE; no lost signal, stale blocked state or permanently stranded USER. |
| F.5 | LUMP unavailable for an extended interval | USER remains blocked with preserved context; no timeout-driven fault/resume; SYSTEM and other runnable Threads make progress. Then valid delivery resumes USER. |
| F.6 | Delivery arrives while SYSTEM is not running | Transport retains/notifies work through the defined ingress mechanism; processing occurs in SYSTEM, never as a direct IDE-triggered USER resume. |
| F.7 | Invalid or mismatched delivery | No completion Signal and no USER resume; actual validation faults follow the defined hard-fault ownership. |
| F.8 | Duplicate/stale delivery | No second installation, Signal or completion; no wakeup of a reused event or another request. |
| F.9 | Concurrent independent requests | Completing one event wakes only its intended waiter; multiple signals are not collapsed into a global one-bit flag. |
| F.10 | Several USERs need the same LUMP | Each pending use gets its own correct completion; one Signal is not treated as broadcast. |
| F.11 | FreeHandler invocation | FreeN and Release CALL/RETURN execute in SYSTEM; they create no third Thread and no premature completion signal. |
| F.12 | Blocking retirement | USER waits on Fret; SYSTEM Signals only after safe reclamation and retained-slot publication; USER resumes through CHANGE and Wait return. |
| F.13 | USER context restoration | Verify original operands, method selector, CALL frame ownership and continuation; no repeated prior side effects or skipped target instruction. |
| F.14 | Flag Reset/reuse boundary | No active waiter or retained completion can be erased or redirected by event reuse. |

Production of these observations may require a separately approved test fixture
and RTL changes. This specification grants neither. The unresolved handoff,
event atomicity, ingress and reuse contracts must be settled before claiming
these scenarios pass on the physical board.

### 1. Pending use and USER suspension

U.2 records the original operation, preserved USER context, target identity,
destination and the information needed to match its completion. Register this
state before U.3 can receive a reply, so immediate delivery cannot lose a wakeup.

The board retains the waiting execution state. The IDE retains the corresponding
fulfilment request when the LUMP is unavailable. These are two sides of one
request, not two independent requests.

Unavailability alone is not a fault. The USER remains suspended indefinitely,
without a timeout-driven resume, retry loop or substitute target. The SYSTEM
THREAD is not held inside a synchronous fetch and can service other work.

No reset/power-loss persistence is implied. Pending-request storage, capacity,
transport failure handling and cancellation remain explicit design points.

### 2. REQUEST / DELIVER

REQUEST identifies the permitted target and desired evidence/body, with a
correlation to the pending use. These are conceptual contents, not a fixed ABI.

The IDE decides availability:

- **Ready:** send DELIVER immediately through U.4.
- **Unready or unavailable:** keep the same REQUEST pending and send DELIVER
  later when satisfiable. No extra availability handshake is required.

The board does not need to ask whether the IDE can satisfy the request and then
issue another fetch. DELIVER supplies the requested identity evidence and body
when needed. A local verified binding can avoid the exchange entirely.

Ordinary requests use the approved LUMP, never an automatic latest-revision
upgrade. Explicit `+` test names use a new slot for the later version. Waiting
does not authorize silently changing a request's target; the exact selection
and correlation representation remains to be defined.

### 3. Resolve and install

Resolve is local identity/binding work within the same service, not a separate
IDE conversation. It confers no additional permissions.

When the body is absent, obtain a suitable prepared block from FreeHandler
(Free64, Free128 or Free256 where applicable), install the complete LUMP and
validate it before publishing the resident binding. Larger bodies need suitable
size classes; queue exhaustion does not authorize an alternate allocator.

Do not reserve a body block throughout an indefinite availability wait. Allocate
when installation can proceed. Block ownership and LUMP identity are distinct:
a free block's existing capability must not become the target's identity or
silently supply its permissions.

Only successful validation/publication permits U.5. U.6 completes the original
operation in the USER THREAD, at most once. A CALL enters its intended target;
resolving another operation does not invent a user CALL.

Duplicate or stale deliveries must not overwrite an installed body or awaken a
completed/replaced request. Exact rejection and reporting behavior remains open.

### 4. Retirement and the same memory lifecycle

RETIRE is the reverse local memory transition, not another fetch protocol:

1. Check authority and mark the body Retiring.
2. Prevent new entry and establish safe reclamation with respect to active
   execution, pending uses and GC roots.
3. Satisfy the modified-state preservation contract.
4. GC hands the reclaimed allocation to FreeHandler.Release.
5. Keep the Namespace slot and identity; publish body residency as Absent.

Release returns the allocation to the return queue, not immediately to a free
queue. Safe reuse and zeroing must precede reissue. Foreground lifecycle work
does not imply implementation of the separately deferred background refill.

The next permitted use follows U.1–U.6 again. Retirement does not delete/reuse
the retained slot, discard modified state, or require an IDE exchange unless
the eventual state-preservation contract requires one.

A use arriving during retirement must not race with reclamation or create a
second install path. Its precise serialization with the pending-use mechanism
is still to be specified; do not infer that active memory is already free.

## How the earlier cases fit

| Earlier case | Unified path |
|---|---|
| Resident, already resolved | U.1 executes normally; no service request. |
| Lazy Load | U.1–U.6; obtain and install the absent body. |
| Lazy Resolve | U.2 checks local bindings; U.3–U.4 only when IDE evidence/body is needed; U.5–U.6 completes the original use. |
| Unready/unavailable LUMP | Same U.1–U.6; only the interval between U.3 and U.4 changes. |
| Lazy Retirement | U.7–U.8 returns body memory; later use follows U.1–U.6. |

The former **4.3 forwarding step** becomes **U.3 SYSTEM → IDE REQUEST**.
The former separate return/dispatch steps become **U.4 IDE → SYSTEM DELIVER**.
The earlier four-case document is retained only as discussion history.

## Safety and remaining decisions

- Namespace-type LUMPs remain excluded.
- SYSTEM THREAD status never bypasses capability checks.
- Invalid authority or integrity hard-faults; waiting for availability is not
  recovery from a fault. Fault ownership for invalid deliveries needs definition.
- Hardware never changes version numbers.
- Exact request ABI, pending capacity, cancellation, reset behavior and transport
  failure handling remain open.
- FreeQueue exhaustion, retirement synchronization and modified-state
  preservation remain open; these are not silently solved by REQUEST/DELIVER.
- Context preservation and scheduling must be checked against the exact
  installed bitstream. No new opcode or current RTL support is assumed.
- Functional acceptance remains hardware-first; this document changes no
  executable behavior or physical hardware.
