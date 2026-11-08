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

The first Phase 2 proof priority is end-to-end lazy loading on hardware,
not finishing every lifecycle contract before testing.

**Why:** The user explicitly requested "Prioritize lazy load testing as fisrt
task to prove".

**How to apply:** Scope prerequisites to a safe absent-body CALL → SYSTEM
request → validated delivery/install → original CALL execution proof.
Keep retirement and scheduling improvements later; do not bypass authority
checks or infer permission to flash from this priority.

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
Keep SYSTEM handlers serialized; SYSTEM stays active if all USERs are on hold. USER turns end on
explicit yield or blocking, as separately approved by the user; there is no
timer-driven preemption. A non-yielding, non-blocking USER can retain execution
indefinitely. Yield-interface and cursor details remain open. The proposed
event-scoped scheduling-authority mechanism was not approved by this correction.

Keep scheduling at simple cooperative round robin; improvements are for later.

**Why:** The user explicitly narrowed the discussion: "Just round robin
improvements later".

**How to apply:** Do not expand this decision into delivery prioritization,
queue-draining policy or additional scheduler mechanisms. Proposed delivery
checks at handoff points remain unapproved; leave those contracts open rather
than repeatedly requesting scheduling refinements.

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

If all USER Threads are on hold, SYSTEM stays active. This supersedes the
earlier automatic BACKGROUND handoff for that condition.

**Why:** The user explicitly clarified "If all threads are on hold SYSTEM
stays active".

**How to apply:** Finish individual handlers without requiring a Thread switch;
keep LLR decisions and admitted deliveries serialized within SYSTEM. Resume
round-robin USER selection after handler completion when a USER is eligible.
Do not infer busy polling, interrupts or a new idle instruction; the precise
idle mechanism and maintenance scheduling remain undecided.

An unavailable valid CALL suspends before committing CALL effects. Restore its
original location after delivery and execute it normally, rather than saving a
partially completed CALL pipeline.

**Why:** The user explicitly selected suspend-before-commit as the KISS boundary.

**How to apply:** Preserve target GT, selector/operands and caller context; do not
push a callee frame, install callee context or advance past CALL before suspension.
Reapply normal checks on resumption. This is not hard-fault recovery, a retry
loop, or permission to repeat earlier USER instructions.

The revised Phase 2 direction identifies Boot/SYSTEM using the same wired
Thread GT for Namespace slot 2 and CHANGE activation used at startup, rather
than a separate CR13 designation. This supersedes the earlier CR13-loading
objective; keep the Boot image unchanged as the objective.

**Why:** After questioning whether CR13 was needed at all, the user specified
reuse of the wired slot-2 GT and startup CHANGE to locate SYSTEM.

**How to apply:** Keep CR12 as the active-Thread model in this discussion.
Distinguish shared activation machinery from replaying the reset-only marker:
the current ISA admits that marker only once per reset, and runtime entry must
first preserve the suspended USER at its uncommitted CALL. Runtime admission
and event parameters remain to be defined; this is not hardware authorization.

The user states that IDE knows the dot.name of each Namespace slot. The current
simplification under discussion is passing the unavailable target's slot number
as request data, instead of loading its E-GT into SYSTEM capability context.

**Why:** Loading the unavailable E-GT could trigger another LazyLoad; the IDE's
existing mapping removes the need to transmit the GT or resolve a name on FPGA.

**How to apply:** Scope slot lookup to the requesting Namespace. Preserve the
original E-GT with the pending USER CALL and validate returned identity; slot
number is a lookup key, not authority. Parameter register and message correlation
remain to be defined. Do not treat the earlier E-GT-register proposal as settled.

The Namespace is itself a LUMP, with its own `dot.net` name in slot-0 metadata,
as stated by the user. Use that existing identity when discussing the Namespace
component of a lazy-load request rather than inventing a separate Namespace ID.

**Why:** The user clarified where the Namespace's name already resides after
the request was scoped to Namespace identity plus target slot.

**How to apply:** Distinguish the Namespace's metadata name from the target
slot's dot.name. Do not assume a complete name fits in one data register.

Use today's four Namespace metadata words unchanged plus the target slot as
a 20-byte lazy-load payload in SYSTEM DR0–DR4 after restoration.

**Why:** The user proposed the five-word interface and explicitly approved
proceeding with whatever metadata exists today, improving it later.

**How to apply:** Capture from the requesting Namespace before transition;
preserve USER's E-GT separately. Microcode passes data, SYSTEM sends it. Metadata
redesign must not gate the first proof. Retain identity/correlation checks
without asserting current metadata contains a complete readable name.

SYSTEM decides and queues Lazy Load Requests (LLRs); microcode only supplies
the event payload, not automatic transmission or queue policy.

**Why:** The user explicitly clarified "SYSTEM must decide and queue LLR".

**How to apply:** Keep the queue SYSTEM-private and retain per-USER pending
associations. Do not confuse serial handler execution with a one-outstanding-
request limit; multiple outstanding requests were subsequently approved.
Pending capacity is one reserved record per configured USER, as approved below.
FIFO order was approved as described below.
Review flow/message decisions one at a time rather than presenting newly found
issues as the complete unresolved list.

SYSTEM runtime entry restores a saved service-loop continuation, not a fixed
handler jump or a rerun of startup.

**Why:** The user explicitly approved the saved-continuation proposal after
reviewing startup-only activation versus ordinary protected frame restoration.

**How to apply:** Startup enters the resident loop once; SYSTEM handoff saves
a continuation into that loop. Runtime entry preserves USER, restores SYSTEM,
then injects event parameters before execution. When all USERs are held,
SYSTEM stays in the loop. Event recognition uses the entry-flag rule below. Do not claim the
current Boot executable already contains this software or replay reset admission.

Use an existing Indicator condition flag for transient lazy-load entry
recognition, not DR5 or a new protected Indicator bit.

**Why:** The user proposed Indicator flags and approved an existing entry flag
instead of the suggested DR5 event register.

**How to apply:** Inject after USER save/SYSTEM restore; test immediately before
flag-changing work. Queue state retains the request, not the flag. Prepare the
no-event state before handoff and prevent stale replay; preserve USER flags.
The user subsequently approved Z=1 for a new LLR and Z=0 for no new event.
Microcode preserves restored N/C/V while setting SYSTEM Z; ordinary instruction
flag semantics remain unchanged. Exact initialization/test/reset sequences
remain open. The wire payload stays 20 bytes.

For Phase 2, microcode passes the suspended USER's unchanged 32-bit Thread GT
from outgoing CR12 as ordinary data in SYSTEM DR5 after restoration.

**Why:** The user approved this owner-identification proposal with "OK for
Phase 2"; the target Namespace/slot alone cannot distinguish multiple USERs.

**How to apply:** Capture before the switch, preserve USER's original DR5, and
inject SYSTEM DR5 alongside DR0–DR4 before Z=1. This is not the target E-GT,
not an event code and not an authority grant. Keep DR5 out of the 20-byte IDE
target payload; protected association and registration authority remain open.

SYSTEM dispatches queued LLRs FIFO, in the order SYSTEM accepts them.

**Why:** The user explicitly approved FIFO dispatch for the Phase 2 proof,
without priorities or reordering.

**How to apply:** Preserve each request's USER association even for equal
targets. FIFO governs dispatch, not delivery or completion order, and does
not imply a single request in flight. Multiple outstanding requests were
subsequently approved; pending capacity is one reserved record per USER.

Allow multiple dispatched LLRs from different blocked USERs to await delivery
at once, retaining one pending use per USER.

**Why:** The user approved this to avoid an indefinitely unavailable first
target blocking dispatch of later requests whose targets may be ready.

**How to apply:** Dispatch FIFO without waiting for an earlier delivery; keep
handlers and sends serialized. Match out-of-order deliveries to their own
pending USER. This does not authorize unbounded storage or parallel execution;
record layout and transport backpressure remain separate contracts.

Reserve one SYSTEM-private pending record per configured USER before releasing
USER execution; FIFO entries reference these records without duplicating contexts.

**Why:** The user approved per-USER capacity so request bookkeeping need not be
allocated only after a USER has blocked.

**How to apply:** Two configured USERs require two records, not one per Namespace
slot. Keep records occupied while queued or awaiting completion. This does not
reserve LUMP-body memory or transport buffers; byte layout remains open.

Mark a USER's pending record completed after validated installation and
successful readiness signaling; retain it until that USER's next LLR replaces it.

**Why:** The user approved completed-record reuse without a separate message
confirming execution of the resumed CALL.

**How to apply:** Never overwrite queued or awaiting-completion records.
Completion means ready/eligible, not target-method execution. Reject stale
replies against the replacement request using the approved envelope request
identifier; its encoding/lifetime remain open. Retaining a completed record
alone does not solve stale correlation.

SYSTEM assigns each accepted LLR a distinct request identifier in the message
envelope; IDE echoes it in DELIVER.

**Why:** The user approved identifiers to distinguish equal-target requests
and protect reused per-USER records from delayed old replies.

**How to apply:** Retain the identifier in the pending record and match it plus
the expected target before installation/completion. It grants no authority.
Keep the target payload at 20 bytes; request numbering is specified below.
Binary session encoding/establishment and duplicate disposition remain open.

A reset that reinitializes SYSTEM's pending records starts a fresh request
session; pre-reset requests do not survive it.

**Why:** The user explicitly approved a fresh session after reset instead of
persistent pending requests.

**How to apply:** Old-session replies cannot install a body or wake a USER in
the new session. Post-reset execution establishes new requests as needed.
Disconnect alone does not reset the session; indefinite waits do not expire.
This does not change diagnostic policy or authorize faulted execution recovery.
Binary session identity remains to be defined.

Use one unsigned 32-bit request counter per session across all USERs: start
at 1, reserve 0 as invalid, never reuse numbers, and hard-fault after 0xFFFFFFFF.

**Why:** The user approved this bounded non-wrapping correlation counter for
Phase 2 instead of silent wrap or automatic session reset.

**How to apply:** Allocate on acceptance, retain in the pending record, and
match session identity plus number and expected target. The counter is software
bookkeeping, not a GT version; keep it outside the 20-byte target payload.
Session establishment and the exact exhaustion diagnostic remain open.

IDE issues the fresh session identifier when SYSTEM initializes a new request
session; SYSTEM retains it and IDE echoes it with the request number in DELIVER.

**Why:** The user approved IDE issuance to avoid an FPGA persistent boot counter
or random-number source for this purpose.

**How to apply:** Require explicit session establishment before LLR dispatch,
while allowing LLR queuing beforehand. Disconnect preserves an established
session. Freshness/non-reuse, setup messages and delayed-setup-reply
protection remain open; do not claim REQUEST/DELIVER alone completes setup.

The IDE-issued session ID is unsigned 64 bits (two 32-bit words); zero means
unestablished and cannot be issued.

**Why:** The user approved this representation alongside the 32-bit request
counter for Phase 2 correlation.

**How to apply:** Session plus request number is 12 envelope bytes, separate
from the 20-byte target payload. Do not call this the complete packet size or
treat width as proof of freshness. Byte order, allocation/non-reuse and setup
reply protection remain open.
