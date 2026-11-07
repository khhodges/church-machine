---
name: Lazy loading selection and lifecycle
description: Approved-by-default fetching, explicit plus-marked test slots, and lifecycle scope.
---
Ordinary Lazy-load requests fetch the approved LUMP, not merely the latest
compilation. A `+` in the dot-name explicitly selects testing of a later LUMP
version, using a new slot rather than replacing the ordinary approved slot.

**Why:** The user explicitly distinguished approved runtime dependencies from
experimental later versions. Latest-compilation Development Image preparation
must not silently override this Lazy-fetch selection policy.

**How to apply:** Keep ordinary approved selection and plus-marked experimental
selection distinct. The exact plus-name grammar is not established by this rule.
Do not interpret the plus marker as a bypass of integrity or authority checks.

The Lazy-loading scope includes Lazy Resolve and Lazy Retirement, not only
fetching a missing body.

**Why:** The user explicitly included both lifecycle operations in the next design.

**How to apply:** Cover both in the design and acceptance criteria.

Namespace-type LUMPs are excluded from Lazy loading for now.

**Why:** The user explicitly confirmed this scope exclusion.

**How to apply:** Do not implement Namespace-type Lazy loading as part of the
initial lifecycle.

Lazy Retirement keeps the Namespace slot and collects the memory through GC.

**Why:** The user explicitly specified: "Keep the slot and collect the memory
through GC."

**How to apply:** Separate residency and memory reclamation from slot lifetime.
Retirement is not slot deletion or permission to reuse that slot. Define GC
safety and subsequent resolution/loading against the retained slot; do not
infer a modified-state persistence policy from the reclamation rule.

Lazy lifecycle implementation is hardware-first; a separate simulator
implementation or passing simulator suite is not a prerequisite milestone.

**Why:** The user rejected the proposed simulator-first milestone and stated
that testing should be on the hardware.

**How to apply:** Establish acceptance on the physical board with identified
bitstream and LUMP bytes. Keep cheap build/static checks distinct from functional
acceptance. This direction alone does not authorize uploading or flashing.

An unready or unavailable LUMP separates REQUEST from DELIVER and suspends the
USER THREAD for an indefinite period.

**Why:** The user explicitly required this asynchronous split rather than an
immediate fetch response.

**How to apply:** Preserve the pending operation while the SYSTEM THREAD serves
other work. Resume only after matching, validated delivery and installation;
elapsed time alone must not resume or fault the waiting USER. Reset persistence,
cancellation and resource exhaustion are separate contracts, not implied by
indefinite waiting.

Use one lifecycle mechanism across Load, Resolve, unavailable-body waiting and
Retirement. REQUEST goes logically from the SYSTEM THREAD service directly to
the IDE; DELIVER returns directly to that service.

**Why:** The user rejected the redundant FPGA forwarding messages and stated
that the IDE already knows whether the request can be satisfied.

**How to apply:** Treat the FPGA connection as transport, not another service
recipient. Availability changes delivery timing rather than selecting a separate
fetch protocol. Keep local resolution and body installation within the shared
service proposal; do not mistake this design direction for RTL authorization.

Lifecycle diagrams must explicitly distinguish FPGA CALL/RETURN actions from
CHANGE Thread transitions, including the handoff to SYSTEM and resumption of USER.

**Why:** The user identified CALL and CHANGE as the key mechanisms missing from
the unified charts.

**How to apply:** CALL changes abstraction within a Thread; CHANGE saves/restores
Thread context. Mark pending-instruction handoff as an unresolved mechanism rather
than implying ordinary CALL automatically executes CHANGE.

Document event suspension with explicit invoking Thread ownership. The CR13
event-entry proposal supersedes the earlier USER-calls-Wait assumption:
hardware suspends USER; SYSTEM registers that suspended USER and signals after
validation. Ordinary caller-blocking Wait in SYSTEM would block the wrong Thread.

**Why:** The user identified flag semantics and the invoking Thread as critical
development/testing details, and requested their inclusion in the specification.

**How to apply:** Distinguish event readiness from context switching. A one-bit
flag neither identifies requests nor counts deliveries. Verify sequential
registration before later delivery handling, not a concurrent-handler race.
The suspended-Thread registration API and CR13 event-entry/exit ABI remain
proposed, not implemented or verified installed-FPGA behavior.

Phase 2 USER Threads run round robin, superseding the earlier rule that any
unblocked resident Thread is an acceptable next execution choice.

**Why:** The user corrected the scheduling discussion: "No USER Thread work
round robin".

**How to apply:** Rotate eligible resident USERs in cyclic order, skipping blocked
Threads; completion restores eligibility rather than forcing immediate execution.
Keep SYSTEM handlers serialized and BACKGROUND idle-only. USER turns end on
explicit yield or blocking, as separately approved by the user; there is no
timer-driven preemption. A non-yielding, non-blocking USER can retain execution
indefinitely. Yield-interface and cursor details remain open. The proposed
event-scoped scheduling-authority mechanism was not approved by this correction.

Phase 1 SYSTEM event handling is serialized and runs to completion: no
asynchronous interruption or parallel event-handler execution.

**Why:** The user explicitly clarified that a second event cannot execute until
the first finishes; earlier discussion introduced unnecessary concurrent-handler
assumptions.

**How to apply:** Finish registering the pending USER/request before handing off
to any unblocked resident Thread. Handler completion is not completion of the
potentially indefinite LUMP request. A later DELIVER is processed in a later
serialized activation; external data arrival is not nested handler execution.
Treat this as the proposed architecture, not verified installed-RTL behavior.

For the Phase 2 design, the existing Boot.Thread becomes SYSTEM, leaving
Thread 1 and Thread 2 for user programs. SYSTEM runs first to validate startup,
then retains the same Thread identity for serialized runtime event handling.

**Why:** The user approved SYSTEM-first setup/hardware validation and explicitly
assigned the existing Boot.Thread to SYSTEM rather than adding another Thread.

**How to apply:** Preserve this role mapping without guessing Namespace slots.
Startup tests span successive completed handlers, not nested events. Release
normal USER execution only after required startup checks pass. CR13 replacement
permission and the exact event ABI remain undecided; this is design approval,
not permission for RTL edits, installation or hardware tests.

Use U.n directly as SYSTEM method identifiers/contracts, with descriptive names
only as comments. U.0 is startup; U.2/U.3 request handling, U.4/U.5 delivery,
U.7/U.8 retirement. U.1/U.6 remain USER/FPGA operations; X.n is common exit.

**Why:** The user approved a direct match between message definitions and methods
to eliminate a second naming/mapping layer.

**How to apply:** Keep charts, method contracts and tests aligned. Separate FPGA
entry from the software method it activates; do not treat U.n as encoded CALL
selectors or introduce extra methods for lettered hardware substeps.

Phase 2 uses ordinary SYSTEM registers for hardware/software event parameters,
not a separate full shadow register bank.

**Why:** After questioning whether single-threading needed shadow registers, the
user approved the KISS reduction; it supersedes the earlier shadow-bank proposal.

**How to apply:** Save outgoing USER context, restore SYSTEM, then inject event
parameters. Preserve pending-operation state; small transition latches are not
a full shadow bank. Register assignment and safe external-context restoration
remain unimplemented design contracts.

Phase 2 starts with 1,000 slots, mostly empty, assigned on demand first come,
first served.

**Why:** The user selected this initial capacity to support many GT-addressable
objects without allocating a resident body for every object.

**How to apply:** Treat 1,000 as total capacity including reservations unless
clarified otherwise; preserve reserved and occupied identities. Serialized
request acceptance determines allocation order. Body retirement retains its
slot and does not free it for reassignment. This design decision does not
authorize resizing the live Namespace or flashing hardware.

SelfTest and WCH are the first Phase 2 retirement candidates after successful
power-on checks. Diagnostics are then deferred indefinitely until a human
operator performs a power-off/power-on reboot, not merely a software reset.

**Why:** The user proposed reclaiming boot-test body memory for USERs, then
superseded optional runtime reruns with power-cycle-only diagnostics under the
assumption of reliable capability hardware and software containment.

**How to apply:** Retain slots, approved backing objects and results; retire only
after safe return and dependency checks, especially ongoing WCH communication.
Run startup diagnostics again at the next operator power cycle; do not add a
runtime diagnostic-rerun control. Mandatory boot/context validation, containment
and fault evidence remain required. Deferral neither resumes faulted execution
nor proves hardware reliability. No live retirement or boot-image changes are
authorized by the design decision.

Approved KISS scope: one pending saved-object GT per blocked USER; helper C-list
as SYSTEM-private storage; one TUNNEL envelope; shared internal completion for
U.5/U.8; explicit retirement only; simple next-eligible-slot allocation.

**Why:** The user explicitly agreed to all proposed reductions rather than
separate queues/services, automatic eviction or a full shadow register bank.

**How to apply:** Preserve the separate U.n contracts while sharing code.
IDE custody acknowledgement precedes discarding local saved-body copies.
Do not remove validation, stale/duplicate checks, original CALL authority,
or the no-runnable-USER delivery path. External backing and helpers remain
GT-authorized; exact saved-object GT type and serialization still need definition.

Include a resident BACKGROUND Thread for bounded maintenance when all USER
Threads are blocked, with USER work preferred when it becomes runnable.

**Why:** The user proposed idle-only background GC and accepted the role before
asking whether Phase 2 was functionally complete.

**How to apply:** Execute sequentially, not in parallel. Reach the defined
service/yield point between bounded steps so delivery can be processed. Reclaim
only explicitly selected safe objects; do not introduce automatic eviction.
Idle-only maintenance may starve while USER remains runnable; it does not
guarantee free-block availability or settle the exhaustion policy.

An unavailable valid CALL suspends before committing CALL effects. Restore its
original location after delivery and execute it normally, rather than saving a
partially completed CALL pipeline.

**Why:** The user explicitly selected suspend-before-commit as the KISS boundary.

**How to apply:** Preserve target GT, selector/operands and caller context; do not
push a callee frame, install callee context or advance past CALL before suspension.
Reapply normal checks on resumption. This is not hard-fault recovery, a retry
loop, or permission to repeat earlier USER instructions.

Phase 2 event entry, exit and subsequent Thread selection leave CR13 unchanged
as the configured Boot/SYSTEM destination. Save outgoing context separately;
never swap the outgoing USER Thread GT into CR13.

**Why:** The user explicitly approved preservation to avoid a paired swap-back
mechanism and keep SYSTEM available for subsequent events.

**How to apply:** Preserve this rule while defining the remaining ABI. It does
not approve CR13 reconfiguration, an exit instruction, cross-Thread scheduling
authority, or changes to the current Phase 1 ISA or installed hardware.
