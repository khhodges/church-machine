# Lazy Load, Resolve, Retirement and Deferred Delivery — Message-Flow Specification

> Historical four-case discussion. The current consolidated proposal is
> [Unified LUMP Lifecycle — REQUEST, DELIVER and RETIRE](lazy-lifecycle-unified.md).
> In that proposal SYSTEM communicates directly with IDE; FPGA is not an
> intermediate service recipient.

## Status and scope

Proposed hardware-first design for review. These flows do not claim that
the installed FPGA bitstream implements the required handoff or continuation.
This document does not authorize RTL changes, uploads, resets or flashing.
Namespace-type LUMPs are excluded for now.

## Reading the diagrams

- Columns are IDE, FPGA, USER THREAD, SYSTEM THREAD, then comments.
- Both Thread lanes execute on the FPGA. The separate columns distinguish
  hardware responsibilities from abstraction-method execution.
- Arrow direction identifies the sender and receiver. Each message has a
  stable reference, from 1.1 through 4.10.
- Unnumbered comments describe local work, not additional messages.
- All descriptions appear in the comments column, without a fifth vertical bar.
- Loader, Resolver and Retirement are functional roles, not finalized API names.
- Calling a different abstraction does not itself change Threads. These flows
  explicitly propose a handoff to a SYSTEM THREAD for lifecycle work.
- SYSTEM THREAD status does not bypass capability or integrity checks.

## 1. Lazy Load

**Purpose:** make an absent body resident while retaining its slot identity.

**Entry:** a USER THREAD calls a target whose slot exists but whose body is absent.

```text
IDE   FPGA  USER  SYSTEM  COMMENTS
 |     |     |     |
 |     <-----|     |     1.1 CALL target.
 |     |     |     |     Body absent: retain CALL
 |     |     |     |     and context; suspend USER.
 |     |---------->|     1.2 Load request to Loader.
 |     <-----------|     1.3 Request approved LUMP.
 <-----|     |     |     1.4 Fetch LUMP from IDE.
 |---->|     |     |     1.5 Return bytes/evidence.
 |     |---------->|     1.6 Deliver to Loader.
 |     |     |     |     Verify, allocate, install;
 |     |     |     |     publish resident binding.
 |     <-----------|     1.7 Load complete.
 |     |     |     |     Restore USER context;
 |     |     |     |     complete pending CALL.
 |     |---->|     |     1.8 Enter target method
 |     |     |     |     within USER THREAD.
```

### Required behavior

- **1.1** originates in the caller abstraction in the USER THREAD.
- **1.2** activates the Loader role in the SYSTEM THREAD, not the target method.
- Preserve the original instruction, operands and caller context across the
  handoff. Do not lose or overwrite a pending request.
- Ordinary fetching selects the approved LUMP, not merely the latest compilation.
- An explicit `+` in a test dot-name selects a later version using a new slot,
  rather than replacing the ordinary approved slot. Exact name grammar remains
  to be defined; the marker does not bypass validation.
- Validate identity, authority and integrity before publishing a resident binding.
- **1.8** enters the target abstraction in the USER THREAD. The Loader does not
  execute the target method on the caller's behalf.

**Result:** the body is resident and the original CALL completes.

If the LUMP is unready or unavailable, use the REQUEST/DELIVER split in
Case 4 instead of assuming an immediate response at **1.5**.

## 2. Lazy Resolve

**Purpose:** establish the authorized local binding of an unresolved reference.

**Entry:** a USER THREAD uses a reference eligible for resolution. An invalid or
unauthorized capability is not an invitation to create authority.

```text
IDE   FPGA  USER  SYSTEM  COMMENTS
 |     |     |     |
 |     <-----|     |     2.1 Use unresolved reference.
 |     |     |     |     Retain operation/context;
 |     |     |     |     suspend USER.
 |     |---------->|     2.2 Request to Resolver.
 |     |     |     |     Check declared identity
 |     |     |     |     and local bindings.
 |     |     |     |     If IDE evidence is needed:
 |     <-----------|     2.3 Request evidence.
 <-----|     |     |     2.4 Identity lookup.
 |---->|     |     |     2.5 Return evidence.
 |     |---------->|     2.6 Deliver to Resolver.
 |     |     |     |     Verify; establish binding.
 |     |     |     |     Grant no additional rights.
 |     |     |     |     If body absent: Lazy Load.
 |     <-----------|     2.7 Resolution complete.
 |     |     |     |     Restore USER context;
 |     |     |     |     complete pending operation.
 |     |---->|     |     2.8 Continue USER.
```

### Required behavior

- **2.2** hands the request to the Resolver role in the SYSTEM THREAD.
- **2.3–2.6** are conditional. A verified local binding may eliminate the IDE lookup.
- Resolve establishes what the reference denotes locally; Load supplies its body.
- Preserve declared identity and permissions. Resolution grants no extra rights
  and does not silently select a newer revision.
- If residency is required and the body is absent, perform the load service
  portion of Case 1 before **2.7**. Retain the original Case 2 continuation;
  do not invent a separate user CALL.
- **2.8** continues the USER THREAD after completing its original operation.

**Result:** a verified local binding exists, any required body is resident, and
the original operation completes.

An unready or unavailable dependency follows Case 4 while retaining this
original operation, rather than creating a new user CALL.

## 3. Lazy Retirement

**Purpose:** collect body memory while retaining the Namespace slot and identity.

**Entry:** an authorized USER THREAD requests retirement. A background lifecycle
policy could instead initiate retirement within the SYSTEM THREAD; the diagram
shows the user-requested case.

```text
IDE   FPGA  USER  SYSTEM  COMMENTS
 |     |     |     |
 |     <-----|     |     3.1 Authorized retire request.
 |     |---------->|     3.2 Dispatch to Retirement.
 |     |     |     |     Check authority;
 |     |     |     |     mark Retiring.
 |     <-----------|     3.3 Restrict new entry.
 |     |---------->|     3.4 Restriction established.
 |     |     |     |     Establish no active use;
 |     |     |     |     check GC roots.
 |     |     |     |     Preserve modified state
 |     |     |     |     under an agreed rule.
 |     |     |     |     GC reclaims body memory.
 |     |     |     |     KEEP slot and identity.
 |     |     |     |     Publish body as Absent.
 |     <-----------|     3.5 Retirement complete.
 |     |---->|     |     3.6 Notify requesting USER.
 |     <-----------|     3.7 Report status (optional).
 <-----|     |     |     3.8 IDE status (optional).
```

### Required behavior

- **3.2** hands the request to the Retirement role in the SYSTEM THREAD.
- **3.3–3.4** describe a required synchronization boundary, not a new FPGA opcode.
  Its mechanism remains to be defined.
- Establish that reclamation is safe with respect to active execution and GC
  roots before freeing body memory.
- Modified-state preservation remains an open contract. Retirement does not
  authorize discarding modified state.
- Keep the slot and collect the memory through GC. Do not delete or reuse the
  slot as part of retirement.
- **3.6** reports completion to the requesting USER THREAD.
- **3.7–3.8** provide optional IDE visibility, not authorization for reclamation.
- A later permitted use of the retained identity follows Lazy Load when needed,
  subject to the agreed state-preservation contract.

**Result:** body memory is reclaimed, residency is Absent, and the slot and
identity remain retained.

## 4. Unready or unavailable LUMP — REQUEST / DELIVER

**Purpose:** separate requesting a LUMP from delivering it, allowing the USER
THREAD to remain suspended for an indefinite period.

**Entry:** a valid operation requires a LUMP that is not ready or not available.
This is a waiting condition, not by itself an authority or integrity fault.

```text
IDE   FPGA  USER  SYSTEM  COMMENTS
 |     |     |     |
 |     <-----|     |     4.1 Use required LUMP.
 |     |     |     |     Retain operation/context;
 |     |     |     |     suspend USER.
 |     |---------->|     4.2 REQUEST to service.
 |     |     |     |     Record pending request
 |     |     |     |     before forwarding it.
 |     <-----------|     4.3 Forward REQUEST.
 <-----|     |     |     4.4 REQUEST to IDE.
 |     |     |     |     LUMP unready/unavailable.
 |     |     |     |     REQUEST remains pending.
 |     |     |     |
 |     |     |     |     INDEFINITE WAIT
 |     |     |     |     USER stays suspended.
 |     |     |     |     SYSTEM serves other work.
 |     |     |     |     Other runnable Threads run.
 |     |     |     |     No timeout-driven resume.
 |     |     |     |
 |---->|     |     |     4.5 DELIVER bytes/evidence
 |     |     |     |     for the pending REQUEST.
 |     |---------->|     4.6 Dispatch DELIVER.
 |     |     |     |     Match pending request;
 |     |     |     |     validate identity/authority.
 |     |     |     |     Obtain suitable free block;
 |     |     |     |     install and verify body.
 |     |     |     |     Publish resident binding.
 |     <-----------|     4.7 Delivery complete;
 |     |     |     |     make waiting USER runnable.
 |     |     |     |     When USER is scheduled:
 |     |---->|     |     4.8 Complete original
 |     |     |     |     operation and continue.
 |     <-----------|     4.9 Report delivery status.
 <-----|     |     |     4.10 IDE status (optional).
```

### Required behavior

- REQUEST and DELIVER are separate service operations, not a synchronous call
  held open for the entire wait. Their exact method ABI and transport remain
  to be defined.
- Record enough protected pending state to identify the waiting Thread, its
  original operation and context, and the required LUMP identity and destination.
  A later delivery must not be confused with another request or a reused Thread
  or slot. The exact representation remains to be defined.
- Retain the pending request before a response could arrive. Suspension and
  completion must not lose a wakeup, even if delivery is immediate.
- Unavailability leaves the request pending indefinitely. Elapsed time alone
  neither faults nor resumes the USER THREAD, and does not authorize another
  revision, substitute LUMP, polling loop or repeated user instruction.
- The SYSTEM THREAD must not remain blocked on this request. It can service
  other requests while this USER THREAD waits. Other runnable Threads continue.
- **4.5** can occur arbitrarily later. If no valid DELIVER occurs, the USER stays
  suspended. Indefinite waiting does not promise persistence across reset or
  power loss; that is a separate, undefined contract.
- DELIVER must match the pending request and pass the usual authority, identity
  and integrity checks. Receiving bytes alone does not make the USER runnable.
  Invalid deliveries must not wake the USER; actual validation faults retain
  the hard-fault rule, with fault ownership still requiring definition.
- Obtain body storage when delivery can be processed, rather than reserving a
  body block throughout an unbounded wait. The discussed LUMP FreeQueues are
  the proposed allocation mechanism. Queue exhaustion is a separate condition;
  this case does not define its policy or authorize a fallback allocator.
- **4.7** makes the USER runnable only after successful installation and
  publication. **4.8** occurs when scheduled, not necessarily immediately.
- Complete each pending operation at most once. Duplicate or stale DELIVER
  messages must not reinstall the body or resume a completed request again;
  their exact rejection/reporting contract remains to be defined.
- For Case 1, **4.8** completes the pending CALL into its target. For Case 2,
  it completes the original reference-using operation. Neither creates a
  new user-level CALL as a substitute.
- **4.9–4.10** are optional reporting, not prerequisites for resuming execution.

**Result:** either the USER remains suspended with a pending REQUEST, or a
validated DELIVER makes it runnable to complete its original operation.

## Common safety and implementation boundaries

- Failed authority or integrity checks hard-fault; they do not trigger retries,
  alternate targets, silent permission grants or revision upgrades.
- Completing a deliberately suspended valid operation is distinct from
  recovering a faulted operation.
- Hardware never changes version numbers.
- Request retention, context preservation, lossless handoff and original-operation
  completion must be checked against the exact installed bitstream sources.
  Current checkout observations alone do not establish installed behavior.
- Physical-board acceptance is the functional target. A separate simulator
  implementation is not a prerequisite; static and build checks remain useful.

## Open design points

- Exact SYSTEM THREAD handoff, request retention and continuation mechanism.
- Eligibility and representation of unresolved references.
- Exact `+` test-name grammar.
- Retirement entry restriction, GC roots and synchronization.
- Modified-state preservation before reclamation and restoration on later use.
- Installed-bitstream compatibility with the required flows.
- REQUEST/DELIVER ABI, pending-request capacity and correlation representation.
- Duplicate/stale delivery handling and validation-fault ownership.
- FreeQueue exhaustion policy; explicit cancellation and reset semantics.
