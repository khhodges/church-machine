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
 |     |     |     |     suspend USER.
 |     |     |     |     U.2 Service pending use.
 |     <-----|     |     U.2a CHANGE to SYSTEM.
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
 |     |     |     |     U.5 Mark USER runnable.
 |     |     |     |     When USER is scheduled:
 |     <-----------|     U.5a CHANGE to USER.
 |     |     |     |     FPGA saves SYSTEM context;
 |     |     |     |     validates USER Thread GT;
 |     |---->|     |     U.5b FPGA restores USER.
 |     |---->|     |     U.6 Complete pending CALL;
 |     |     |     |     FPGA dispatches target
 |     |     |     |     within USER THREAD.
 |     |     |     |
 |     |     |     |     LATER: authorized retirement
 |     |     |---->|     U.7 Queue RETIRE request.
 |     <-----|     |     U.7a CHANGE to SYSTEM.
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
 |     |     |     |     U.8 Retirement complete;
 |     |     |     |     notify waiting requester.
 |     <-----------|     U.8a CHANGE to USER when
 |     |     |     |     ready and scheduled.
 |     |---->|     |     U.8b FPGA saves SYSTEM and
 |     |     |     |     restores requesting USER.
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

U.5 is software readiness bookkeeping, **not CHANGE**. U.5a is the actual Thread
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
