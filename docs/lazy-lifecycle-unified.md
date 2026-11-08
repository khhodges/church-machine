# Unified LUMP Lifecycle — Phase 2 FPGA Design

## Status and scope

**Current review scope — FPGA rules only:** settle architectural and microcode
behavior and its software-visible interface. Previously recorded SYSTEM/IDE
queue, session and persistence decisions remain software context, not FPGA
implementation requirements. Do not expand them into software algorithms in
this review. The proposed six-step software USER-reset sequence was not approved.
Hardware remains responsible for context transitions, parameter delivery and
ordinary capability/version checks, not software queue management, session-ID
allocation or automatic version changes.

This document records the current design direction: Boot.Thread, designated
SYSTEM and located through the wired Namespace slot-2 Thread GT, handles UNAVAILABLE and later delivery events,
one event at a time, to completion. It replaces the earlier USER-side
Wait/CHANGE handoff proposal in this document.

This is a proposed architectural revision, not a claim of installed hardware
support. The current Phase 1 ISA reserves CR13 as NULL and untouched; ordinary
`CHANGE CR13` faults. That reservation remains; the earlier CR13 SYSTEM proposal
is superseded. Runtime event admission still requires explicit reconciliation
with that ISA and the installed bitstream before implementation. No RTL edits,
uploads, resets, flashing or new instruction encodings are authorized here.

The user supplied the PP250 precedent of a SYSTEM Thread that runs to completion.
The earlier CR13-specific analogy no longer defines the register interface.
This document uses that precedent as a design model, not
as independently verified historical or current-FPGA behavior.

Namespace-type LUMPs remain excluded from lazy loading.

## Latest revision — 8 November 2026

### Changed in this case

- **SYSTEM is Boot.Thread at Namespace slot 2, not a CR13-designated Thread.**
  Reuse the wired Thread GT and incoming startup CHANGE machinery; CR12 remains
  the active-Thread identity. CR13 stays reserved. Runtime admission is still
  distinct from the one-shot reset marker.
- **Pass data, not the unavailable E-GT, into SYSTEM.** Microcode captures the
  requesting Namespace's four existing slot-0 metadata words plus the target
  slot number. After saving USER and restoring SYSTEM, inject them into
  DR0–DR4, in that order.
- **Phase 2 ownership parameter:** microcode also captures the outgoing USER's
  Thread GT from CR12 and passes its unchanged 32-bit value as ordinary data in
  SYSTEM DR5. This is internal association data, not a sixth IDE payload word.
- **The lazy-load request payload is 20 bytes.** SYSTEM sends it through resident
  transport dependencies; microcode need not implement transport sending.
  Preserve the original E-GT with USER's pending CALL.
- **Use today's metadata as-is.** Do not block the first proof on a new name or
  Namespace-ID format. The IDE uses its existing Namespace/slot mapping.
- Charts A/B/C and acceptance scenarios F.2, F.17 and F.23 now reflect this
  interface. Cooperative round robin and lazy-load-first hardware acceptance
  remain unchanged.

### Newly exposed details, not additional approved features

The fixed payload makes the remaining handoff and wire details concrete:
the initialization/test/reset instructions for the service-loop Z entry flag,
how DR0–DR4 are
consumed before reuse, and how the five
words are serialized. The target payload contains no USER/request identifier;
DR5 supplies internal USER identity and an approved envelope request identifier supplies that
association rather than treating Namespace/slot as a unique pending use.
Section 6 identifies these open details. No extra payload word, new opcode,
metadata redesign or hardware implementation is approved by this revision.

## Agreed startup and Thread roles

The existing **Boot.Thread becomes the SYSTEM Thread** in this Phase 2 design.
It is not replaced by an additional dedicated SYSTEM Thread. **Thread 1 and
Thread 2 remain available for user programs.** These are Thread designations,
not an assignment of Namespace slot numbers.

**Revised boot/SYSTEM direction:** retain the Boot image and reuse the wired
Namespace slot-2 Thread GT and incoming CHANGE activation machinery used at
startup. CR12 continues to identify the active Thread, including SYSTEM.
CR13 remains reserved and untouched; no swap or swap-back is involved.
Runtime entry first preserves USER at the uncommitted CALL, unlike startup,
which has no outgoing USER. Reusing activation machinery does not authorize
replaying the current reset-only marker outside reset. Runtime admission remains
to be defined; exit to a selected USER uses ordinary CHANGE as approved below.

### Approved Thread identity and SYSTEM recognition

Software references a Thread with its complete GT; microcode extracts the GT's
slot field to locate its Namespace entry. These are not separate Thread-ID
systems. The slot is meaningful within its applicable Namespace, not globally.
The full GT preserves versioned identity; a retained slot alone cannot distinguish
the old and new incarnations of a reset Thread.

CR12 holds the active Thread reference. LLR entry preserves the outgoing USER's
unchanged full 32-bit Thread GT in DR5 as data, not merely its slot. CHANGE
requires a permissionless Thread GT, not a NULL GT, and still validates identity,
version and protected Thread context using microcode privileges.

For Phase 2, recognize Boot/SYSTEM from slot 2 of the validated active Thread GT
in the applicable Namespace. Do not use unchecked slot equality or equality to
one permanently fixed complete GT value. No separate numeric Thread-ID field,
SYSTEM-mode bit or CR13 role is introduced. CALL into another abstraction retains
the active Thread: an unavailable dependency encountered by code called within
SYSTEM is still a SYSTEM LLR and therefore a HardFault. USER Thread 1/2 remain
role labels, not assignments to Namespace slots 1/2.

This is an approved design contract, not a claim of installed FPGA support.

### Approved SYSTEM runtime entry: saved service-loop continuation

Boot/SYSTEM executes startup once, then enters a resident service loop.
Whenever it hands execution to USER, its saved continuation leads back into
that loop. Runtime event entry selects SYSTEM using the wired slot-2 Thread
GT and restores its protected saved executable/NIA frame and register context.
For an unavailable CALL, microcode first saves USER at the uncommitted CALL,
then restores SYSTEM, then injects DR0–DR4 plus the outgoing USER Thread GT
in DR5 before SYSTEM executes.

SYSTEM resumes the saved service-loop continuation; it does not restart boot
diagnostics, jump to a new fixed handler address, or treat its Thread GT as a
method selector. Event recognition uses the approved entry-flag contract below;
DR5 identifies the pending USER, while registration authority and retained
association mechanics still need definition. When all USERs are on hold, SYSTEM stays in its service loop without
a Thread switch; handlers remain serialized.

Startup's incoming-only activation and runtime continuation restoration are
distinct uses of the Thread machinery. This contract requires service-loop
software; it does not establish that existing Boot executable bytes already
provide that loop, authorize replacing them, or permit replay of the reset-only
activation marker.

### Approved USER suspension: normal protected Thread save

On an eligible unavailable CALL, microcode reuses CHANGE's outgoing context-save
machinery and the USER's existing protected Thread storage. Do not create a
separate LLR execution-context block or hidden register bank. Save the original
registers and condition flags before supplying SYSTEM's event parameters.

Unlike an executed CHANGE instruction, the saved continuation points to the
original uncommitted CALL, not the following instruction. No callee frame has
been pushed and no callee context installed. The original target GT and operands
remain in the saved USER context for normal execution after restoration.

Captured Namespace metadata, target slot and outgoing USER GT are temporary
handoff data, not a second saved USER context. SYSTEM's private pending-request
association remains separate from this protected execution state. If validation
of the protected save fails, HardFault; do not enter SYSTEM with an incomplete
USER save. This is an internal microcode transition, not a CHANGE instruction
inserted into the USER program. Runtime admission remains a separate contract.

### Approved SYSTEM exit: ordinary CHANGE

When SYSTEM selects a ready USER, it executes ordinary CHANGE using that USER's
full, permissionless Thread GT through the existing operand mechanism. CHANGE
saves SYSTEM's service-loop continuation and restores USER's protected context,
including original registers and condition flags. For a USER suspended on an
unavailable CALL, restoration resumes that original uncommitted CALL, which
executes with normal capability and version checks.

A stale Thread GT or invalid saved context causes HardFault; hardware must not
repair the context or upgrade the GT. Delivery/readiness signaling alone does
not switch Threads. No special return-from-LLR instruction, CR13 swap-back or
automatic return to the most recently suspended USER is introduced. USER
selection stays in SYSTEM software; the FPGA performs normal validated CHANGE.
If all USERs remain held, SYSTEM stays active without a CHANGE.

### Approved event recognition: existing Indicator condition flag

Use the existing Z condition flag as a transient SYSTEM entry signal,
not a DR5 event code, a new Indicator bit, or a persistent pending-request flag.
**Approved encoding at the service-loop entry check:** Z=1 means a new LLR
is present in DR0–DR4; Z=0 means no new LLR has been supplied.

After saving USER and restoring SYSTEM, microcode supplies DR0–DR5 and sets
SYSTEM Z=1 before SYSTEM executes, leaving restored N, C and V unchanged. SYSTEM
tests it immediately at its saved service-loop continuation, before any
flag-changing instruction. Preserve USER's saved condition flags unchanged.

Once SYSTEM has safely recorded the event, its private queue owns the pending
work. SYSTEM establishes Z=0 before yielding, preserving
that convention through the handoff so ordinary resumption cannot replay an
old LLR. The loop must not reinterpret subsequent arithmetic flags as fresh
events; this signal is meaningful at the defined entry check only.
Initial Z=0 setup and exact test/reset instruction sequences remain to be
specified using the existing ISA. Ordinary instructions retain their flag
semantics. DR5 carries the Phase 2 USER Thread identity, not event status. The request
payload remains 20 bytes, and stack/size/reserved Indicator bits are unchanged.

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

### First retirement exercise: SelfTest and WCH

SelfTest and WCH are the first boot objects used to exercise retirement after
successful initial hardware checks. U.0 retains the test results; once those
objects have returned and no active continuation needs their bodies,
U.7 → U.8 reclaims their body memory. Keep their slots, identities and approved
backing objects. Reclaimed blocks become available to USER allocation only
after the required safe-release and zeroing steps, not immediately on RETURN.

Before retiring WCH, establish that any continuing SYSTEM communication or
fault-reporting dependency is available independently. Do not retire a service
required to fetch either object back or to report a fault.

**After successful power-on diagnostics, diagnostic reruns are deferred
indefinitely until a human operator performs a power-off/power-on reboot.**
This supersedes the earlier optional runtime-rerun proposal. A later software
hard fault does not reload SelfTest/WCH or trigger a hardware diagnostic pass.
A software reset or Namespace-local reboot is not the operator power cycle.

This policy assumes reliable capability enforcement and correctly configured
authority boundaries. Containment limits the fault's reach; it does not prove
that all authorized software behavior is correct, nor is it evidence that the
installed hardware has been qualified. Do not assume containment if the
enforcement hardware itself is suspect.

Fault containment, hard-fault behavior and evidence capture remain active.
Unaffected authorized work may continue; diagnostic deferral does not authorize
resuming faulted execution. Mandatory context/boot validation is distinct from
the deferred diagnostic suite and remains required where applicable.

At the next operator power cycle, U.0 runs the required startup diagnostics
again before normal USER release; SelfTest/WCH then become retirement candidates
again. Preserve their approved backing objects for that startup use. Exact
cold-start identification and startup availability must be defined without
depending on reclaimed volatile copies. No separate runtime diagnostic-rerun
control is required by this policy.

This is a Phase 2 lifecycle policy, not authorization to retire current live
boot objects or change the installed boot image.

Boot/SYSTEM remains the same Thread across these roles; startup validation is
not repeated on every event. Startup follows its initial path; runtime resumes
the saved service loop. Lazy-load entry uses an existing condition flag;
its exact encoding and recognition of other event types remain open.

The no-parallel/preemptive-handler rule carries into this Phase 2 design.
USER Threads run round robin, superseding the earlier arbitrary eligible-Thread
selection rule. The existing Phase 1 ISA is not changed by this document.
No CR13 provisioning or runtime reconfiguration mechanism is required.

## U.n method contracts — single naming authority

The U.n definitions are the method identifiers and contracts, not a second
mapping to separately named Startup/Unavailable/Deliver/Retire methods.
Descriptive words below are comments only. SYSTEM executes in Boot.Thread;
Thread 1 and Thread 2 remain USER Threads.

| Identifier | Owner | Contract |
|---|---|---|
| **U.0** | SYSTEM method | Startup validation: check setup, reserve one SYSTEM-private pending record per configured USER before releasing it, coordinate hardware/event tests across serialized activations, release normal USER execution only after success. |
| **U.1** | USER/FPGA operation, not a SYSTEM method | Original CALL with USER's target GT; dispatch normally if resident, otherwise retain the operation and enter SYSTEM through the UNAVAILABLE mechanism. |
| **U.2** | SYSTEM method | Consume the protected UNAVAILABLE record; register the suspended USER, pending operation and completion event; resolve locally if possible, otherwise queue the LLR under SYSTEM ownership. |
| **U.3** | SYSTEM method | Send registered queued LLRs directly to IDE in SYSTEM acceptance order (FIFO), including each request identifier in the envelope. Do not wait inside the handler for DELIVER. |
| **U.4** | SYSTEM method | Process an admitted DELIVER: match its echoed request identifier and expected target, validate, resolve and install using FreeHandler when required. |
| **U.5** | SYSTEM method | Publish readiness and signal the associated USER exactly once. Does not itself switch Threads. |
| **U.6** | USER/FPGA operation, not a SYSTEM method | Restore/complete the original use under its retained authority when USER is selected. |
| **U.7** | SYSTEM method | Process authorized retirement; defer unsafe work or reclaim body memory through FreeHandler while retaining slot and identity. |
| **U.8** | SYSTEM method | Publish retirement completion and signal a registered waiting requester, if any. |

**Method chains, all within SYSTEM:** U.2 → U.3 for a missing dependency;
U.2 → U.5 for a locally satisfied dependency; U.4 → U.5 for valid delivery;
U.7 → U.8 for completed retirement. A deferred U.7 does not invoke U.8.
Each chain finishes through X.1–X.3. Startup U.0 coordinates its tests through
successive completed activations; it does not wait for a nested handler.

Lettered steps are subordinate actions, not extra SYSTEM methods. FPGA event
entry precedes U.2 or U.4; it does not execute their software bodies. FreeHandler
and Signal remain separate abstractions called from the owning U.n method.
X.1–X.3 remain the common handler-exit/scheduling path, not a renamed U.n method.

U.n are design identifiers, not promised CLOOMC syntax or encoded dispatch-table
selectors. In particular U.0 does not mean CALL selector zero. The method-entry
ABI and event-to-method dispatch encoding still require definition.

## 1. Execution and authority model

### Approved KISS reductions

These are design decisions, not executable changes. Keep the U.n contracts,
but share implementation where behavior is identical:

| Reduction | Required design |
|---|---|
| Shared completion | U.5 and U.8 use one internal complete-and-signal operation after their distinct readiness conditions succeed. Keep both U.n contracts and tests. |
| One pending use per blocked USER | Reserve one SYSTEM-private pending record per configured USER before USER release, retaining one saved-object GT for its blocking lifecycle operation. A suspended Thread cannot issue another operation; no per-Thread request queue is needed. FIFO entries reference these records rather than duplicate saved contexts. |
| Private pending storage | Keep the helper C-list and LLR queue as SYSTEM-private storage, not a separately callable Pending service unless a specific authority boundary justifies it. Queue references to pending uses without duplicating full saved objects. |
| One TUNNEL envelope | Use one GT-associated object envelope with an operation/type field for requests, saved contexts and returns. Retain identity, integrity, custody acknowledgement and stale-return checks. Transport IDs do not confer authority. |
| Explicit retirement only | Initially retire explicitly selected safe objects, beginning with SelfTest/WCH. No automatic eviction, working-set replacement or speculative prefetch policy. Preserve modified state and active-use checks. |
| Simple slot allocation | Process accepted requests serially and take the next eligible empty slot. No balancing, compaction or speculative allocation. Preserve the 1,000-slot capacity, reservations and retained identities. |
| No full shadow register bank | Save outgoing context, activate SYSTEM, then supply event parameters through designated ordinary SYSTEM registers. Small internal transition latches may still be necessary; do not introduce a second full bank merely for this API. |

The register ordering is mandatory: save USER before writing SYSTEM parameters,
and supply the parameters after SYSTEM restoration so that restoration cannot
overwrite them. Lazy-load request registers are defined below; detailed
transition mechanics and parameters for other event types remain open.
This supersedes the earlier shadow-bank assumption, not the requirement to
preserve suspended Thread state.

### Initial lazy-load request payload

Use the four existing 32-bit Namespace slot-0 metadata words unchanged, followed
by the 32-bit unavailable target slot number: five words, a 20-byte payload.
Do not redesign metadata or require an improved Namespace-name format before
the first lazy-load proof.

| SYSTEM register | Ordinary data supplied by microcode |
|---|---|
| DR0 | Requesting Namespace metadata word 0 |
| DR1 | Requesting Namespace metadata word 1 |
| DR2 | Requesting Namespace metadata word 2 |
| DR3 | Requesting Namespace metadata word 3 |
| DR4 | Unavailable target slot number |

Capture the payload from the requesting Namespace before changing context,
save USER, restore SYSTEM, then inject DR0–DR4. Preserve USER's original E-GT
and CALL state separately. Do not load the unavailable E-GT into a SYSTEM
capability register merely to send the request. These words are data, not
authority to activate the missing target.

**Approved Phase 2 internal ownership parameter:** before switching, microcode
also captures the outgoing USER's Thread GT from CR12. After SYSTEM restoration,
place that unchanged 32-bit GT value in DR5 alongside DR0–DR4, before setting
Z=1 and starting SYSTEM execution. This is the USER Thread GT, not the absent
target's E-GT and not SYSTEM's restored CR12 identity.

SYSTEM records DR5 with the LLR and its protected suspended context. Do not
infer the owner from the target slot or the round-robin cursor: two USERs may
request the same target. DR5 is ordinary internal data; it neither activates
the Thread nor grants permission to edit protected Thread state. Registration
authority and subsequent identity/context validation remain required.
The internal handoff has six data words plus the Z signal; only DR0–DR4 form
the five-word, 20-byte target payload sent to IDE. DR5 is not added to that
wire payload. Preservation of USER's original DR5 is part of the preceding
USER context save, like the other original registers.

Microcode captures/passes the payload; SYSTEM sends it through resident
transport dependencies. A small payload/owner transition buffer is not a full shadow
register bank. Twenty bytes is the payload, not a new transport framing rule.
The IDE interprets today's metadata with its Namespace/slot mapping; the
payload does not claim that all four words form a complete readable name.
Correlation and returned-identity checks remain required; ambiguous identity
must not cause a guessed mapping or installation. Metadata improvements are
deferred, not a prerequisite for this proof.

**SYSTEM owns LLR decisions and queuing.** Microcode hands the event data to
SYSTEM; it neither sends the request automatically nor chooses queue policy.
U.2 associates the request with its suspended USER and queues unresolved work.
U.3 dispatches queued work in SYSTEM acceptance order (FIFO), without priorities
or reordering. Each request retains its own USER association, including when
several USERs request the same target. FIFO governs dispatch, not delivery
arrival or completion order. Queued and sent-awaiting-delivery are
distinct states; neither makes USER runnable. One pending use per blocked USER
is compatible with a SYSTEM queue containing requests from several USERs.
**Multiple dispatched LLRs may await delivery at once.** SYSTEM may send the
next queued request without waiting for an earlier delivery. Each blocked USER
still has only one pending use; SYSTEM handlers and transmissions remain
sequential, not parallel. An unavailable earlier target must not by itself
prevent a later queued request from being sent.

**Approved pending capacity:** reserve one SYSTEM-private pending record per
configured USER Thread before releasing those USERs. The FIFO holds references
to these records, not duplicate saved contexts. A record stays occupied while
its request is queued or awaiting completion. The initial two-USER setup needs
capacity for two pending uses, independent of the 1,000 Namespace-slot capacity.
This reservation covers request bookkeeping, not LUMP bodies or transport
buffers. Exact record layout and transport backpressure handling remain open;
this is not unbounded buffering.

**Approved record reuse:** after validated installation and successful readiness
signaling, mark the USER's record completed. Retain it until that same USER
issues its next LLR; only then replace its contents with the new pending use.
Never overwrite a queued or awaiting-completion record without the explicitly
approved USER-reset invalidation below. Completed means that
the target is ready and USER is eligible, not that the target method has run
or returned. No additional USER-executed-CALL acknowledgement is required.
Request correlation must prevent a delayed reply for the old use from completing
the replacement use, using the envelope identifier described below.

**Approved request correlation:** SYSTEM assigns each accepted LLR a distinct
request identifier, retains it in the pending record and includes it in the
REQUEST envelope. IDE echoes that identifier in DELIVER. Before installation
or completion, SYSTEM matches both the identifier and the expected target
against the pending record. A delayed reply for an old request must not complete
a replacement request, including one for the same target and USER.

The identifier is correlation data, not authority; all required LUMP identity,
integrity and runtime authority checks remain. It is outside the unchanged
20-byte target payload. Binary session encoding/establishment and
duplicate/stale-message disposition remain to be settled.
The complete wire envelope size is not yet fixed.

**Approved request-number encoding:** SYSTEM maintains one unsigned 32-bit
counter per request session, shared across all USERs. Assign 1 to the first
accepted LLR and increment for every subsequent accepted LLR. Zero is invalid;
completed numbers are never reused within that session. `0xFFFFFFFF` is the
last valid number; attempting another allocation hard-faults without wrapping
or silently starting a new session. The exact diagnostic code remains open.
Match the pair (session identity, request number), plus the expected target,
not the number alone. The counter is SYSTEM software bookkeeping, not a GT
version field or hardware version mutation. It belongs to the envelope,
outside DR0–DR4's 20-byte target payload.

**Reset scopes:** LLRs are individual USER Thread events, not FPGA-wide events.
Microcode hands a Thread's event to SYSTEM; it does not turn the request into
a board reset or a new session. **SYSTEM reset means FPGA reset**, distinct
from a USER Thread reset.

**Approved USER-reset invalidation:** SYSTEM invalidates only that USER's old
pending LLR association before its reset context becomes eligible to run.
Remove a still-queued LLR from dispatch. For an already-sent LLR, invalidate
its completion association so a late reply cannot complete the old CALL or
wake the reset Thread. Keep the reserved record assigned to that USER; its
next LLR may reuse it with a new request number. Other USERs' pending requests,
the shared session ID and the shared request counter are unchanged.
This rule does not require an IDE cancellation message. Reset authorization,
reset-to-SYSTEM notification and the detailed completion path remain open.

**New approved Phase 2 rule — increment Thread version on Thread reset:**
authorized reset software increments the USER Thread's Namespace-entry version
before its reset context becomes eligible. Hardware compares versions; it
does not increment them. The retained pre-reset Thread GT consequently fails
the normal version check and must not authorize activation or completion of
the replacement context. Do not rewrite the retained old GT to the new version
to make an old request appear current.

Separate target-object admission from requester eligibility. A valid returned
LUMP is not discarded solely because its requesting USER reset; apply ordinary
slot/GT/admission/GC rules to that object. The Thread-version check supplies the
reset-specific stale-owner test. Existing request correlation, integrity and
target checks still apply; unchanged Thread version alone does not prove that
a reply belongs to the current request.

The reset implementation must also provide the new context's legitimate
Thread GT through the authorized path; existing old-version holders are not
silently upgraded. **Phase 2 exhaustion rule:** never wrap the Thread version.
If incrementing on reset would exceed the existing version field's maximum,
hard-fault rather than publish a wrapped version or make the reset context
runnable. No automatic slot replacement, version recycling or recovery
mechanism is introduced. Exact version-update ordering, provisioning of the
new GT, exhaustion diagnostic and stale-owner completion disposition remain open.
This rule does not change another Thread's version, the target LUMP's version,
the shared session ID or the request counter, and does not authorize FPGA edits.

**Requested software companion:** the B-bit SecurityRegulator must include a
GT-version increment method for this authorized operation. Its Thread-reset use
must affect the authoritative Namespace-entry version so old GTs become stale,
not merely change a copied token. Apply the Phase 2 no-wrap/HardFault rule.
Exact method name, register ABI and new-GT result semantics remain open in the
[SecurityRegulator operation review](phase-1/security-regulator-operation-review.md).
This records a software dependency, not another FPGA rule or implementation.

**Approved SYSTEM/FPGA-reset lifetime:** reinitializing SYSTEM's pending
records starts a fresh request session. Pre-reset requests do not survive
that reinitialization; delayed replies from the old session must not install
a body or wake a USER in the new session. Post-reset execution establishes
new requests as needed rather than restoring old pending requests.
A transport disconnect alone does not reset this session, and indefinite
waiting does not expire a request. This rule does not change the power-cycle-only
diagnostic policy or authorize resuming faulted execution. The binary mechanism
that distinguishes sessions remains to be specified.

**Approved session issuer:** IDE issues the fresh session identifier when
SYSTEM initializes a new request session. SYSTEM retains it and includes it
with each request number; IDE echoes both in DELIVER. SYSTEM does not require
an FPGA persistent boot counter or random-number source for session issuance.

Establishment requires an explicit session-setup exchange, not yet defined
or implemented. LLRs may queue before setup completes but cannot dispatch
under an unestablished session. Temporary disconnection preserves the
established session; it does not automatically request a replacement.
Allocation/non-reuse follows the persistent-counter rule below; setup messages
and enforcement of the approved transport reset boundary remain open. The REQUEST/DELIVER pair alone is
therefore not the complete session-establishment protocol.

**Approved session-ID representation:** an unsigned 64-bit value carried as two
32-bit words. Zero means no established session and must not be issued as a
valid session ID. Together with the unsigned 32-bit request number, correlation
occupies 12 bytes in the envelope. The target payload remains 20 bytes; message
type, length and other framing are separate, so this does not fix total packet
size. Word/byte order remains to be specified. Field width alone does not
guarantee freshness or non-reuse.

**Approved session allocation:** IDE uses a persistent unsigned 64-bit
increasing counter starting at 1. Durably reserve each session ID before
transmitting it; never issue that ID again. Gaps after reservation are harmless.
Allocation must be serialized so two issuances cannot reserve the same value.
If the counter is exhausted or its trusted state is unavailable, stop issuing
sessions: do not wrap, guess, or restart at 1. A restored older allocation
state is not safe for resumed issuance without establishing non-reuse.
This is an IDE storage requirement, not FPGA persistent state. Storage choice,
rollback/non-reuse verification and failure reporting still need specification.
Non-reused IDs alone do not protect against a delayed setup reply; apply the
approved reset-boundary requirement below.

**Approved fresh-session reset boundary:** before accepting fresh-session setup
after SYSTEM pending-state reinitialization, establish a verified boundary
across the FPGA/bridge/IDE transport path. Pre-reset queued bytes and delayed
work must not enter the new setup exchange. Clearing one receive buffer or
reconnecting a socket alone does not establish this end-to-end guarantee.
Only after the boundary is established may SYSTEM accept the new session ID
and subsequently dispatch LLRs. If the boundary cannot be established, setup
must not report success.

This requirement applies to SYSTEM/FPGA reset that reinitializes pending state,
not USER Thread reset or an ordinary disconnect that preserves the session.
Exact handshake messages, enforcement,
evidence and fault reporting remain to be defined. This is not a claim that
the current bridge implements the boundary and does not authorize a reset or
transport change.

Long-lived request/context bodies may be held by the IDE behind retained GTs.
The GT references the saved object; it is not itself the saved bytes. Confirm
durable IDE custody before discarding the local body copy. Process acceptance
through a later serialized activation if necessary; do not block SYSTEM waiting
for it. Custody acknowledgement is not USER completion.

Returning an object must validate it against the retained GT/association before
restoring any execution state. The exact saved-object type (Outform versus
Abstract), serialization and restoration contract remain open. SYSTEM, TUNNEL,
helper storage and required retrieval capabilities must remain available without
depending on retrieval of the same absent object.

The following are not removed by KISS: returned-object validation, custody
confirmation, original CALL authority/continuation preservation, consume-once
completion, stale/duplicate protection, and a defined service path when no USER
Thread is runnable. One pending GT does not mean that required Thread status,
event association or Namespace descriptors disappear.

### Three distinct GT roles

**Agreed CALL suspension boundary:** when a valid target is unavailable, suspend
before committing any CALL effects. Retain the original CALL location, target
GT, selector, operands and caller context. Do not push a callee frame, install
the callee execution context or advance past the CALL. Event-entry context
preservation remains separate from those uncommitted CALL effects.

After validated delivery and USER selection, restore the original CALL location
and execute that CALL normally, including its checks. No earlier USER instruction
is repeated and the target method has not executed before suspension. Do not
save/resume a partially completed CALL pipeline. This completes a deliberately
suspended valid operation; it is not a hard-fault retry or a timer retry loop.

| GT | Purpose | Must not be confused with |
|---|---|---|
| Original target abstraction GT | Authorizes USER's CALL to the user-programmed target and method. Retained with the pending operation. | SYSTEM's execution authority. |
| Wired slot-2 SYSTEM Thread GT | Activates Boot/SYSTEM through incoming CHANGE machinery, with active identity in CR12. | The unavailable target E-GT or a service abstraction's executable GT. |
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

**USER Threads run round robin.** At a scheduling handoff, select the next
eligible resident USER in cyclic order, skipping blocked USERs. Completion
makes a USER eligible for its turn; it does not immediately select that USER.
The original USER stays blocked until its completion condition is satisfied.
SYSTEM handlers still run serially to completion, outside the USER rotation.
**When all USER Threads are on hold, SYSTEM stays active.** Do not hand off
automatically to BACKGROUND or resume a blocked USER. SYSTEM remains available
to manage its LLR queue and handle admitted deliveries, one handler at a time.
Handler completion does not require leaving SYSTEM when no USER is eligible.
After a handler completes and USER work is eligible, resume cooperative
round-robin selection. This supersedes the earlier all-blocked BACKGROUND
handoff; maintenance scheduling is deferred.

**Approved turn boundary:** a USER's turn ends on explicit yield or blocking.
Scheduling is cooperative; no fixed time slice or timer-driven USER preemption
is introduced. A USER that neither yields nor blocks can hold execution
indefinitely; round robin alone does not guarantee bounded waiting.
The exact yield interface, delivery service point and SYSTEM idle behavior
when no service work is available remain open.
**Scope freeze:** keep simple cooperative round robin for now; scheduling
improvements are deferred. The proposed queued-delivery checks at cooperative
handoff points have not been approved and are not part of this decision.
This selection decision does not approve the proposed event-scoped scheduling
authority mechanism; registration authority remains an unresolved contract.

## 2. Unified numbered charts

IDE remains left, FPGA in the middle, and USER/SYSTEM abstraction execution on
the right. All descriptions are in the fifth text column, with no fifth `|`.
An arrow crossing FPGA does not make FPGA an IDE service recipient.
The OTHER lane means the next eligible USER in round-robin order. If all USERs
are on hold, SYSTEM stays active and no OTHER transition occurs.

U.0–U.8 use the contracts above. U.1b–U.1c explicitly isolate the FPGA
unavailability detection/entry from SYSTEM method U.2. Other lettered substeps
expose implementation actions without defining additional methods.
The former USER `CALL Wait` and `CHANGE to SYSTEM` substeps are superseded.

### Startup — U.0

```text
IDE   FPGA  USER  SYSTEM  COMMENTS
 |     |     |     |
 |     |     |     |     Minimal boot establishes
 |     |     |     |     resident Boot/SYSTEM context.
 |     |---------->|     U.0e FPGA activates SYSTEM
 |     |     |     |     for startup method U.0.
 |     |     |     |     U.0 Check setup/hardware;
 |     |     |     |     prepare event-path tests.
 |     |     |     |     Finish activation via X.n;
 |     |     |     |     run prepared test Thread.
 |     |     |     |     Subsequent U.2/U.4 activations
 |     |     |     |     exercise real event paths.
 |     |     |     |     U.0v At a later startup
 |     |     |     |     validation stage, check
 |     |     |     |     completed test evidence.
 |     |     |     |     U.0p On success release USERs;
 |     |     |     |     on failure hard-fault.
```

U.0's stage/continuation representation remains an ABI detail. No activation
waits for a second handler to execute inside it. Normal runtime events do not
restart startup validation.

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
 |     |     |     |     U.1b Suspend before CALL commit;
 |     |     |     |     retain original CALL location,
 |     |     |     |     target GT, operands/context;
 |     |     |     |     suspends USER execution.
 |     |---------->|     U.1c UNAVAILABLE event entry
 |     |     |     |     activates slot-2 SYSTEM;
 |     |     |     |     CR12 identifies SYSTEM.
 |     |     |     |     Restore saved service-loop
 |     |     |     |     continuation, not startup.
 |     |     |     |     After restore: DR0–DR3 metadata,
 |     |     |     |     DR4 target slot; no E-GT load.
 |     |     |     |     DR5 outgoing USER Thread GT.
 |     |     |     |     Set SYSTEM Z=1;
 |     |     |     |     loop tests before flag changes.
 |     |     |     |     U.2 SYSTEM method records request,
 |     |     |     |     associates completion F,
 |     |     |     |     registers suspended USER.
 |     |     |     |     One pending saved-object GT
 |     |     |     |     per blocked USER.
 |     |     |     |     No USER CALL Wait(F).
 |     |     |     |     Check local binding.
 |     |     |     |     If ready, use U.5 directly.
 |     |     |     |     Otherwise SYSTEM queues LLR;
 |     |     |     |     dispatches in acceptance order.
 <-----------------|     U.3 SYSTEM REQUEST to IDE.
 |     |     |     |     Envelope carries request ID.
 |     |     |     |     20-byte payload in TUNNEL envelope.
 |     |     |     |     Retain local body until
 |     |     |     |     durable custody confirmed;
 |     |     |     |     never wait inside handler.
 |     |     |     |     IDE knows availability.
 |     |     |     |     Ready: send DELIVER now.
 |     |     |     |     Unready: retain REQUEST.
 |     |     |     |     U.3a REQUEST method finishes.
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
 |     |     |     |     Select next eligible USER
 |     |     |     |     in round-robin order;
 |     |     |     |     All blocked: stay in SYSTEM;
 |     |     |     |     no X.2/X.3 handoff.
 |     |     |     |     Otherwise:
 |     <-----------|     X.2 SYSTEM requests handoff
 |     |     |     |     to selected Thread.
 |     |     |     |     ordinary CHANGE using the
 |     |     |     |     selected USER's full Thread GT.
 |     |---->|     |     X.3 FPGA activates selected
 |     |     |     |     Thread's saved context.
 |     |     |     |     CR12 identifies selected Thread.
 |     |     |     |     Only then other work runs.
```

X.2 uses ordinary CHANGE through the existing operand mechanism, not a separate
event-exit operation. Entry and exit preserve CR13 without a hidden CR12/CR13
swap or matching swap-back. Do not assume direct return to the interrupted USER:
SYSTEM selects an eligible USER under the agreed round-robin policy.
Normal CHANGE validation applies, and SYSTEM's saved continuation remains
available for subsequent serialized events.

### C. DELIVER and resume the original operation

```text
IDE   FPGA  USER  SYSTEM  COMMENTS
 |     |     |     |
 |---------------->|     U.4m IDE DELIVER for U.4.
 |     |     |     |     Logical message endpoint;
 |     |     |     |     not asynchronous execution.
 |     |     |     |     Prior handler must finish.
 |     |---------->|     U.4e FPGA slot-2 SYSTEM entry
 |     |     |     |     activates delivery handling
 |     |     |     |     at a defined service point.
 |     |     |     |     U.4 SYSTEM method matches request;
 |     |     |     |     match echoed ID and target,
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
 |     |     |     |     U.5 SYSTEM method publishes READY.
 |     |     |     |     Shared completion operation,
 |     |     |     |     also used by U.8.
 |     <-----------|     U.5s SYSTEM CALL Signal(F).
 |     |---------->|     U.5t Signal executes in SYSTEM;
 |     |     |     |     makes waiting USER runnable;
 |     |     |     |     RETURN stays in SYSTEM.
 |     |     |     |     Handler finishes.
 |     |     |     |     When USER is selected:
 |     <-----------|     U.5a SYSTEM requests handoff;
 |     |     |     |     use event-exit contract X.2.
 |     |---->|     |     U.5b FPGA restores USER.
 |     |---->|     |     U.6 Execute original CALL
 |     |     |     |     from its saved location,
 |     |     |     |     with normal checks,
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
 |     |     |---->|     U.7m Authorized request for U.7.
 |     |     |     |     Admission ABI remains open;
 |     |     |     |     no concurrent handler entry.
 |     |     |     |     Or SYSTEM initiates locally.
 |     |     |     |     U.7 SYSTEM method marks Retiring;
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
 |     |     |     |     U.8 SYSTEM method publishes DONE.
 |     |     |     |     Use shared completion operation.
 |     <-----------|     U.8s If a waiting requester:
 |     |     |     |     SYSTEM CALL Signal(Fret).
 |     |---------->|     U.8t Signal/RETURN in SYSTEM.
 |     |     |     |     Handler finishes; chart B.
 |     |     |     |     Later use starts at U.1.
```

U.7m is a logical request for method U.7, not a cross-Thread CALL. Its authorized admission and
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
| U.0 | SYSTEM | Validate startup before normal USER execution; coordinate tests through successive activations. |
| U.1b | FPGA | Preserve the unfinished operation and suspend USER; no USER-side service code is assumed. |
| U.1c | FPGA event-entry machinery | Activate slot-2 SYSTEM with CR12 active identity; after restoration inject target payload into DR0–DR4, outgoing USER Thread GT into DR5, then Z=1 before U.2. |
| U.2 | SYSTEM | Record request and register the already-suspended USER against F. |
| U.3 | SYSTEM | Send REQUEST directly to IDE using SYSTEM's service/transport authority. |
| U.3a / X.1–X.3 | SYSTEM, then FPGA if handing off | Finish event; activate the next eligible USER in round-robin order, or stay in SYSTEM if all USERs are on hold. |
| U.4m | IDE | Supply a correlated delivery for U.4; does not signal USER or interrupt SYSTEM. |
| U.4e | FPGA event-entry machinery | Admit a later serialized delivery event and activate SYSTEM. |
| U.4 | SYSTEM | Match, validate, resolve and install the admitted delivery. |
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
3. Queues the LLR if a local verified binding cannot satisfy the operation;
   SYSTEM decides when U.3 sends the registered REQUEST.
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

- One pending saved-object GT per blocked USER lifecycle operation, retained
  in SYSTEM-private helper storage; no per-Thread queue for this blocking path.
- Retain the original target GT, method selector/operands, caller continuation,
  Thread identity and destination association until completion, either in
  protected local state or in the validated saved object under confirmed IDE
  custody. Do not discard required state merely because its packet was sent.
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
- Requests do not survive a reset that reinitializes SYSTEM's pending records;
  start a fresh request session and exclude old replies from installation or
  completion. A transport disconnect alone does not reset pending requests.

## 4. One lifecycle for all cases

| Case | Shared mechanism |
|---|---|
| Resolved and resident | U.1–U.1a normal CALL; no event or request. |
| Lazy Resolve | SYSTEM method U.2 checks local binding; U.3/U.4 only if evidence/body is needed; U.5 completes readiness. No extra rights are granted. |
| Lazy Load | REQUEST/DELIVER supplies the absent body; SYSTEM allocates, installs, signals. |
| Unready/unavailable | Same REQUEST/DELIVER; only the waiting interval changes. The first handler still finishes promptly. |
| Retirement | Same serialized SYSTEM service reclaims body memory; slot remains. Later use returns to U.1. |

SYSTEM communicates directly with IDE. FPGA provides physical transport and
execution transitions, not an extra request/response service layer.
REQUEST and DELIVER are separated in time; this **does not mean asynchronous
interrupt-driven handler execution**.

### Initial slot capacity and assignment

Start the Phase 2 design with **1,000 Namespace slots**, mostly empty.
The working interpretation is 1,000 total slots, including reserved/system
entries, not 1,000 additional user slots. Preserve required existing reservations;
do not reinterpret Thread 1/2 as Namespace slot assignments.

- Assign eligible empty slots **on demand, first come, first served**, in the
  order accepted by the serialized SYSTEM service.
- Do not preallocate a resident LUMP body for each empty slot. Slot/descriptor
  capacity and physical body-memory capacity are separate resources.
- Assignment must preserve the existing authority and identity checks; an empty
  slot is not an implicit capability grant.
- Body retirement leaves its slot occupied by the retained identity. An absent
  body does not make that slot free for another object.
- Skip reserved and occupied slots. Never evict an identity or silently enlarge
  the table when no eligible slot remains. The explicit exhaustion outcome and
  any separately authorized slot-release/reuse policy remain to be defined.
- First come, first served defines request order, not the numerical slot scan
  order or a change to GT format.

This is the initial design capacity, not a live Namespace resize. Descriptor
footprint, table bounds/alignment and compatibility with the Phase 2 hardware
must be checked before building or installing the image.

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

Invalid authority or integrity hard-faults; for USER execution, absence of a
valid target's body is a waiting condition.
**SYSTEM encountering an LLR condition is a HardFault.** SYSTEM must not suspend
itself for lazy loading, enqueue its own missing dependency, or recursively
enter SYSTEM. Its execution and required service/transport dependencies must
be resident. Serving a USER's LLR is normal SYSTEM work; originating an LLR
from SYSTEM execution is the fault case. Exact fault encoding remains open.
This rule does not constitute approval of the separately proposed
non-interleaved microcode-entry contract.
SYSTEM status does not bypass capability checks. Hardware
never changes version numbers. Delivery-fault ownership remains to be specified.

## 5. Development and physical acceptance

### First priority: prove lazy loading

The first proof milestone is an end-to-end lazy load on physical hardware:
a USER CALL targets a valid approved LUMP whose body is absent; hardware
suspends before CALL commit; SYSTEM requests the body from IDE; validated
delivery installs it and makes USER eligible; on its round-robin turn USER
executes the original CALL normally and the target method completes once.
Capture the exact bitstream/LUMP identities and the transition evidence,
including CR12 active identity, unchanged reserved CR13, the five-word request
payload and preservation of the original CALL authority.
Use a delayed delivery to demonstrate that USER remains blocked while other
eligible USER work can proceed, without SYSTEM waiting inside its handler.

Resolve only the entry/exit, registration, delivery and restoration contracts
needed to make this proof safe and meaningful as prerequisites to this
milestone. Do not make completion of the entire lifecycle design, retirement,
or scheduling improvements a prerequisite. Existing validation and authority
requirements remain mandatory. This priority does not authorize RTL changes,
uploading or flashing, and is not a claim that the proof has been run.

### Method-level test references

Use the same U.n identifiers for method tests and chart assertions; descriptions
are not a separate method-name mapping.

| Method | Required test contract |
|---|---|
| U.0 | Boot.Thread runs setup validation before normal USER release; event-path tests use successive activations; failures hard-fault. |
| U.2 | Receives event data identifying the suspended USER; associates it with that USER's normal protected saved Thread context. Original target authority stays in the saved context, not a duplicate LLR context block. |
| U.3 | Emits correctly correlated REQUESTs to IDE in FIFO acceptance order, without priority reordering or waiting inside a handler for delivery. |
| U.4 | Accepts only a matching validated delivery; FreeHandler CALL/RETURN stays in SYSTEM; duplicate/stale input cannot complete twice. |
| U.5 | Publishes usable readiness before Signal; only the associated USER becomes eligible; no implicit Thread switch. |
| U.7 | Releases only safely reclaimable memory; retains slot/identity; deferred work finishes its activation without invoking U.8. |
| U.8 | Publishes DONE before signaling a waiting requester; no signal before successful retirement. |

U.1 and U.6 have USER/FPGA integration assertions, not SYSTEM method tests.
X.n tests cover the common exit. The detailed F.n scenarios below retain their
test-case IDs; they exercise these same U.n contracts.

These are required scenarios, **not tests run or passed**. Capture the exact
bitstream and LUMP identities, active Thread identity, event entry/completion,
request correlation, flag/blocked/runnable state, CALL/RETURN and transition
sequence. Protect private authority in diagnostic output. Transfer ACK alone
is not execution acceptance.

| Test | Scenario | Required evidence |
|---|---|---|
| F.1 | Resident CALL | Original GT dispatches the intended method within USER; no SYSTEM event. |
| F.2 | Unavailable CALL | FPGA retains original operation; slot-2 event entry activates SYSTEM into CR12, without USER CALL Wait or GT substitution. |
| F.3 | Registration ownership | DR5 equals the outgoing USER's captured CR12 Thread GT, not restored SYSTEM CR12 or the target E-GT. Associate the LLR with that suspended USER even when two USERs request the same target. SYSTEM itself never blocks on F; original USER DR5 remains saved. |
| F.4 | Immediate IDE response | First handler completes registration and REQUEST before any DELIVER handler runs; arrival does not re-enter SYSTEM. |
| F.5 | Indefinite unavailability | Request remains pending; handler finishes; another unblocked resident Thread runs; no timeout-driven fault or resume. |
| F.6 | Delivery admission | Incoming data is handled at the defined service point with no asynchronous preemption; previous handler has finished. |
| F.7 | Invalid/mismatched delivery | No completion signal or USER resume; validation-fault ownership follows its agreed contract. |
| F.8 | Duplicate/stale delivery | IDE echoes the SYSTEM-assigned envelope request identifier. Match it and expected target before installation/completion. An old reply cannot complete a replacement use, even for the same USER and target; no second install, signal or wakeup. Pre-reset replies cannot install or wake in a fresh session. Exact duplicate/stale disposition and binary session encoding remain open. |
| F.9 | Multiple outstanding requests | Handlers execute serially; dispatch requests from distinct blocked USERs in FIFO acceptance order without waiting for earlier delivery. Delay the first target and deliver a later one: only its associated USER becomes eligible. Retain separate USER associations for equal targets; FIFO does not require delivery/completion order. One pending use per USER remains enforced. |
| F.10 | Several USERs need one LUMP | Each pending use completes correctly; one flag signal is not assumed to broadcast. |
| F.11 | FreeHandler | FreeN/Release CALL and RETURN stay within SYSTEM and use SYSTEM's capabilities. |
| F.12 | Retirement | Only safe reclamation produces DONE/Signal; retain the slot and modified-state obligations. Deferred retirement does not hold SYSTEM indefinitely. |
| F.13 | Pre-commit CALL suspension/restoration | Before suspension no callee frame/context or CALL advance is committed. Restore the original CALL location, GT, selector and operands; normal execution checks and dispatch occur once after delivery. No earlier USER instruction repeats and no partially executed pipeline state is resumed. |
| F.14 | Event/session lifetime | Event Reset/reuse must not erase an active association during a session. SYSTEM pending-state reinitialization starts a fresh session and abandons pre-reset requests; old replies cannot install or wake a new USER. A transport disconnect alone retains the session, and indefinite waiting does not expire requests. Allocate unsigned 32-bit request numbers from 1 across USERs, never reuse completed numbers, reject 0, and hard-fault on allocation after 0xFFFFFFFF without wrap or silent session reset. Match session plus number, not number alone. |
| F.15 | Run-to-completion | No second event handler or other Thread executes while the first handler is active; orderly handler completion precedes the next activation. |
| F.16 | Cooperative round-robin USER selection | Explicit yield or blocking ends a USER turn; eligible resident USERs run in cyclic order, skipping blocked USERs. No timer-driven turn expiry. Completion restores eligibility, not an immediate turn. If all USERs are on hold, SYSTEM stays active with no X.2/X.3 handoff, BACKGROUND selection or blocked-USER resume. Handler completion precedes selection when USER work becomes eligible. |
| F.17 | Repeated SYSTEM activation | Wired slot-2 GT selects SYSTEM; restore its saved service-loop executable/NIA and registers, then inject event parameters before execution. CR12 identifies the active Thread. Runtime entry saves USER first; no startup diagnostic rerun or forced fixed-handler jump. All USERs held: stay in the loop. CR13 remains reserved; no swap or replay of reset-only admission. |
| F.18 | First boot-object retirement | After successful initial diagnostics and return, U.7/U.8 retires SelfTest/WCH bodies safely; retain their identities/results and preserve required communication dependencies. |
| F.19 | Diagnostics deferred until operator power cycle | Later software hard faults and software resets do not reload diagnostic bodies; containment/evidence and mandatory validation remain active. A human power-off/power-on invokes U.0 diagnostics before USER release and permits subsequent safe retirement again. |
| F.20 | Reserved pending record per USER | Before USER release, reserve one SYSTEM-private record per configured USER. The two-USER proof has capacity for two pending uses; FIFO entries reference records without duplicating saved contexts. Never overwrite queued or awaiting-completion records. After validated installation and successful readiness signaling mark completed; retain until the same USER's next LLR replaces it, without a USER-executed-CALL acknowledgement. A stale old reply must not complete the replacement use. Record byte layout and identifier encoding/lifetime remain open. |
| F.21 | Shared completion | U.5 and U.8 use the common completion path only after their own preconditions, signal the correct USER and consume each pending association once. |
| F.22 | TUNNEL custody and restoration | Local body survives until durable acknowledgement; returned context is validated before restoration; stale packets cannot confer authority or wake a different USER. |
| F.23 | Lazy-load event API and five-word wire payload | Capture requesting Namespace's existing four metadata words plus target slot and outgoing USER Thread GT; save USER before writes; restore SYSTEM then inject DR0–DR5 and Z=1 without changing restored N/C/V. Test Z before flag changes, record once, and establish Z=0 before handoff. Ordinary Z=0 resumption must not requeue stale payload; USER flags remain preserved. IDE target payload is exactly DR0–DR4 (20 bytes), excluding DR5. No unavailable E-GT activation or full shadow bank. Verify SYSTEM sends captured metadata unchanged. |
| F.24 | Explicit retirement and simple allocation | No unrequested eviction or compaction; allocation skips reserved/retained slots and does not silently exceed 1,000 slots. |
| F.25 | Fresh-session transport reset boundary | Hold pre-reset setup bytes and delayed work at FPGA, bridge and IDE stages, then reinitialize SYSTEM pending state. Verify none can be accepted into the new setup exchange; boundary verification precedes session acceptance and LLR dispatch. If the boundary cannot be established, setup must not report success. A single-buffer clear or socket reconnect is not sufficient evidence. Ordinary disconnect retains its established session. |
| F.26 | USER-reset version and LLR invalidation | Reset one USER with an LLR queued, then in a separate case with an LLR already sent. Authorized software increments that Thread's Namespace-entry version before the reset context becomes eligible; hardware does not change it. Remove queued work or invalidate sent completion ownership. The retained old Thread GT fails normal version validation and cannot wake the reset context; never rewrite it to match. Treat a returned target under ordinary admission/slot/GT/GC rules, not an automatic reset-specific discard. The next LLR uses the reserved record with a new request number. Other USERs, target version, shared session and counter remain unchanged. |

**F.27 — Thread reset version exhaustion:** exercise the largest valid version
and an attempted reset increment beyond it. Require a hard fault with no
wrapped version published and no reset-context release. An increment from the
preceding version to the maximum remains valid subject to ordinary reset checks.
No automatic slot replacement or recovery is expected.

**F.28 — SYSTEM unavailable dependency:** while SYSTEM executes, encounter a
valid-but-unavailable dependency that would cause a USER LLR. Require HardFault,
not SYSTEM suspension, request queuing, IDE REQUEST emission or recursive event
entry for that dependency. Separately confirm that SYSTEM can serve a USER's
LLR normally using resident dependencies. This is an acceptance requirement,
not a claim of an executed test.

**F.29 — ordinary CHANGE exit:** select a ready USER and exit SYSTEM through
ordinary CHANGE using its full permissionless Thread GT. Verify SYSTEM's saved
service-loop continuation and USER's restored registers/flags; the suspended
USER executes its original uncommitted CALL under normal checks. A stale GT or
invalid saved context must HardFault without repair. Delivery/readiness alone
must not switch Threads. This is an acceptance requirement, not an executed test.

**F.30 — normal protected USER save:** trigger an eligible unavailable CALL and
verify reuse of the normal outgoing Thread-save machinery and protected storage.
The saved continuation identifies the original CALL; original registers,
operands, target GT and flags survive SYSTEM parameter injection and restoration.
No callee frame or duplicate LLR execution-context block is created. Invalid
protected-save state must HardFault without entering SYSTEM with a partial save.
This is an acceptance requirement, not a claim of an executed test.

The old preemptive interleaving test is replaced by proof of serialization and
sequential ordering. No simulated parallel-handler behavior is required.
Functional acceptance is hardware-first; no separate simulator implementation
is a prerequisite. Test fixtures, RTL work and physical operations require
their separate authorization.

## 6. Remaining implementation contracts

The following are not settled by the design discussion:

- Runtime admission to the wired slot-2 SYSTEM activation path and reconciliation
  with reset-only startup admission; CR13 provisioning is no longer required.
  **Settled runtime entry:** restore SYSTEM's saved service-loop continuation,
  not startup. An existing condition flag is the approved lazy-load entry
  discriminator (Z=1 new LLR, Z=0 none); initialization/test/reset instructions
  and software continuation placement remain open. The Thread GT is not a
  method selector.
- Exact event-entry admission and transition details remain open.
  **Settled USER save:** reuse ordinary outgoing Thread-save machinery and
  existing protected Thread storage, preserving the original uncommitted CALL
  as the continuation. No separate LLR execution-context block is required.
  Protected-save validation failure HardFaults rather than entering SYSTEM.
  **Settled exit:** ordinary CHANGE to the selected ready USER using its full
  Thread GT, saving SYSTEM's continuation and restoring USER's context under
  normal validation. No special event-exit instruction or swap-back is required.
  **Five-word handoff detail:** define capture/transition latches and when
  SYSTEM consumes or retains DR0–DR5 before calls or later activations can
  overwrite them. The register assignment and save/restore ordering are settled.
- Non-preemptive service point for delivery admission and input retention.
- SYSTEM's authorized registration of an already-suspended USER on an event.
  **Settled Phase 2 owner input:** outgoing CR12 Thread GT as ordinary data in
  SYSTEM DR5; protected pending association and registration authority remain open.
  **Settled USER reset:** invalidate only that USER's old LLR before making
  its reset context eligible; remove queued work, invalidate sent completion
  ownership, retain its reserved record for a new request number. Shared session,
  counter and other USERs' requests stay intact. Define reset authorization,
  reset-to-SYSTEM notification and stale-owner completion disposition; no IDE cancellation
  message is required by this decision.
  **Settled reset-version rule:** authorized software increments the reset
  Thread's version before eligibility. Hardware only compares; old GTs are not
  repaired. Returned-target admission follows ordinary slot/GT/GC rules, not
  reset-specific discard. Define precise update/provisioning ordering and
  exhaustion diagnostic. **Settled Phase 2 limit:** no version wrap; a reset
  increment beyond the existing field maximum hard-faults without publishing
  a wrapped identity or releasing the reset context.
- Request framing/byte order, capacity, correlation, event lifetime, cancellation
  and reset. **Settled payload:** metadata words 0–3 plus target slot, 20 bytes.
  **Settled ownership and order:** SYSTEM decides and queues LLRs; FIFO dispatch
  follows SYSTEM acceptance order without priorities or reordering. Multiple
  dispatched LLRs may await delivery concurrently, with one pending use per
  blocked USER and serial handlers. Reserve one pending record per configured
  USER before release; FIFO holds record references. After validated installation
  and successful readiness signaling, mark completed and retain until the same
  USER's next LLR. Record layout, identifier encoding/lifetime and transport buffering/backpressure
  remain open; no executed-CALL acknowledgement is required for record reuse.
  **Newly explicit:** define exact wire serialization and how the IDE associates
  current raw metadata with the requesting Namespace. Verify that mapping for
  the first proof without requiring metadata improvements. Multiple USERs can
  request the same Namespace/slot, so this payload alone cannot select which
  pending USER a reply completes. **Settled correlation:** SYSTEM assigns an
  identifier per accepted LLR in the envelope; IDE echoes it in DELIVER.
  Match session identity, request number and expected target before installation/completion.
  **Settled request numbering:** one unsigned 32-bit SYSTEM counter per session,
  shared across USERs, starts at 1; 0 invalid; no reuse; allocation after
  0xFFFFFFFF hard-faults without wrap or silent reset. Binary session
  encoding/establishment, the exhaustion diagnostic and duplicate/stale
  disposition remain open. **Settled lifetime:** pending-state reinitialization
  starts a fresh session; pre-reset requests do not survive, and their replies
  cannot install or wake in the new session. Disconnect alone is not reset.
  **Settled issuer:** IDE issues the fresh session ID; SYSTEM retains it and
  includes it with every request number, and IDE echoes both. Queuing before
  setup is allowed; dispatch before establishment is not. Define the setup
  exchange and enforcement of the approved reset boundary next.
  **Settled ID width:** unsigned 64 bits in two 32-bit words; zero means
  unestablished and is not issuable. Session ID plus request number occupies
  12 envelope bytes, outside the 20-byte target payload; byte/word order and
  full framing remain open.
  **Settled allocation:** IDE persistently increments from 1, reserves durably
  before transmission, and never reissues an ID. Stop issuance on exhaustion
  or untrusted/unavailable allocation state; never wrap or restart at 1.
  Older restored state requires non-reuse verification before issuance.
  **Settled setup freshness requirement:** verify an end-to-end FPGA/bridge/IDE
  reset boundary excluding pre-reset bytes and delayed work before accepting
  fresh setup; no success if that boundary cannot be established. Ordinary
  disconnect does not invoke this reset rule. Storage mechanics and exact
  boundary handshake/enforcement/evidence remain open.
  No added target-payload word is assumed.
- Exact explicit-yield interface and round-robin cursor rules; SYSTEM's idle
  mechanism when no USER is eligible and no service work is available.
  SYSTEM remaining active when all USERs are on hold is settled; maintenance
  scheduling and other scheduler improvements remain deferred.
- FreeQueue exhaustion, retirement admission/deferred-work scheduling,
  modified-state preservation and GC safety.

These are implementation details to define and verify, not reasons to reintroduce
concurrent handlers, USER-side Wait on unavailable CALL, or a second fetch
protocol. The earlier four-case document remains discussion history; this
document is the current consolidated design.
