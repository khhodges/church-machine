# Next Factory Build — approval specification

**Status: Scope and Mallory fault disposition approved to proceed. Detailed
target bindings, normal turn scheduling, fault-journal/reboot handoff,
MTBF measurement and standalone Ethernet contracts remain unresolved approval
gates. Phase 1 completion requires Ethernet and standalone FPGA singletons.
No authorization to flash, activate hardware or publish.**

## 1. Purpose and operator boundary

Deliver one hardware installation flow through the published IDE at
**lab.cloomc.org**:

**Check hardware → Select image → Confirm → Installation hold → Load →
Read back → Verify → Explicit Start**

Include both LightningBolt options, controlled by **Amobea in round-robin
turns using GTs in CR0 and CR1**.

### Factory tutorial: fault handling and reliable LUMP development

The Factory Build must include a tutorial that establishes fault handling,
containment, and evidence-based reliability as part of developing software
as LUMPs. It is not merely a loader demonstration.

Teach the complete development cycle: pinpoint a fault in an individual
object; explain the security check; contain its effects; evaluate reliability
against Amoeba's configured minimum; place underperforming objects in Must
Resolve; enforce version-defined OFFLINE; have Amoeba stop polling; correct
the design; explicitly adopt the corrected LUMP; and demonstrate safe
side-by-side evolution and eligible fallback.

The goal is calibrated reliability that can meet or exceed the minimum
required by the target fault-tolerant application. Use the user's PP250
50-year software MTBF example as the high-reliability reference. This is not
an independently verified historical claim or a measured result for the
Factory Build, and does not set every object's threshold to 50 years.

State the workload, exposure, fault definition, revision, estimation method,
and uncertainty behind any reported MTBF. Keep object-level fault occurrence
and application-level service failures distinct: meeting each object's
threshold does not by itself establish the whole application's MTBF.
Containment and intentional fault tests demonstrate behavior, not decades
of measured reliability. Do not promise suitability for every fault-tolerant
application without its own requirements and evidence.

Routine operation requires no terminal, local application, or manual JTAG
steps from the operator. The existing bridge communicates with the FPGA over
UART. Initial installation of the upgraded Factory Build is a separate,
explicitly authorized programming operation; this specification does not
claim an existing UART bitstream-update facility.

### Phase 1 transport progression — required endpoint

**Phase 1 starts with the IDE UART connection and finishes with Ethernet
and standalone FPGA singletons.** Ethernet is not optional follow-on work
deferred beyond Phase 1.

- **Starting stage:** use the IDE UART path for initial development,
  diagnostics, and authorized hardware validation.
- **Completion stage:** demonstrate each FPGA singleton operating independently
  of an attached IDE UART host or external UART-to-network bridge, with
  Ethernet delivery of fault and reliability evidence to the IDE server.
  An open browser must not be required for evidence collection.
- **Evidence continuity:** define how incident identity, exact executing
  revision, reboot reason and operating-exposure records are retained across
  reboot and delivered after disconnection without counting retransmissions
  as new faults or adding exposure twice. Missing evidence must remain explicit.
- **Acceptance boundary:** UART-only success or a networked UART bridge is
  an intermediate result, not Phase 1 standalone completion.

The storage medium, reset/power-loss retention guarantees, Ethernet protocol,
authentication and acknowledgement contract remain design items to approve.
This endpoint does not authorize automatic reboot, fault recovery, firmware
programming, activation, publication, or a new remote-installation mechanism.
Standalone operation is not a claim of multi-FPGA coordination.

## 2. Hardware checks — before changing the board

### Required Phase 1 Mint completion and transaction templates

**Mint must be finished as part of Phase 1 and used to initialize new Threads
against templates for each application transaction used for clean recovery.**
Fixture-preinitialized Threads or host-side context construction do not satisfy
this operational Mint requirement.

Preserve the established division of responsibility: Mint primes new Threads
with Amoeba; Amoeba performs the application initialization and handoff.
The supplied application E-GT identifies the application Amoeba will start,
not an alternative formatter called by Mint. The template contract must define
how the exact transaction template supplies the authorized initial state
through that path.

Clean recovery means a new initialized Thread context, not silent resumption
at the faulting instruction. It does not itself undo application data writes
or external effects. Retain the original incident and exposure history, and
do not revive OFFLINE Mallory or grant additional authority. This requirement
does not reclassify the Mallory Abstraction fault as a Thread fault.

Still requiring approval: template representation and exact revision identity;
per-transaction inputs and capability bindings; protected initial state;
Mint/Amoeba interface; who authorizes recovery and under what conditions;
handling of prior transaction effects, old contexts and allocation failures.
No automatic retry policy, rollback guarantee or new fault-continuation ABI
is implied.

### Installation preflight

The IDE must check and display:

- Exact board identity and a fresh, responsive bridge session.
- Installed hardware build identity and advertised support for installation
  hold, memory readback, and the selected image's execution requirements.
- Current execution state: Running, Halted, Faulted, or Unknown.
- No conflicting hardware command or installation.
- Existing control authorization; this change does not redesign authentication.

Unsupported firmware, an unknown target, stale evidence, or missing authority
blocks installation. Never silently reflash, reboot, or choose another board.
Check image-specific compatibility after selection and before taking hold.

## 3. Exact selected image

Select an approved immutable Namespace revision. Show its name, revision,
projected memory size, and entry target. Validate its retained bytes and
configuration and derive the exact board-format image.

Pin the revision, projected bytes, board identity, session, and operation ID.
Neither a newer catalog revision nor a selector change may alter an operation
already in progress. A changed board/session requires fresh checks, not an
automatic continuation against a different target.

Require confirmation that replacement discards runtime data and Thread
progress. State that execution remains stopped until explicit Start.

## 4. Installation hold

The hardware control path must remain usable independently of the executing
Church program.

| Starting state | Required behavior |
| --- | --- |
| Running | Halt and obtain correlated hardware confirmation. |
| Halted | Confirm installation hold rather than trusting a cached badge. |
| Faulted | Retain fault evidence, then clear fault-recovery hold directly into installation hold without running the old program. |
| Unknown/disconnected | Block the operation. |

Installation hold prevents instruction execution and other memory writers
from altering the image throughout upload and readback. Only the authorized
loader may write the replacement region. Do not implement this as reboot
followed by a best-effort Halt.

Hold acknowledgement must identify the operation and board session. Preserve
the hold across communication loss once established; the IDE must nevertheless
report state as unknown when it cannot confirm current hardware state.

## 5. Load and verify

1. Transfer the complete board-format image with bounded framing and progress.
2. Treat loader acknowledgement only as **Loaded**, not **Verified**.
3. Do not automatically reboot or execute after upload.
4. Read the full uploaded region from actual FPGA memory while held.
5. Compare every byte against the pinned board-format image, with explicit
   address coverage, length, and wire-endianness handling.
6. Mark **Verified** only after complete matching readback for this operation.

An echoed upload buffer, host-side digest, partial snapshot, or UART write
success is not installed-memory verification. Readback frames must be
correlated and distinguishable from trace, snapshot, and control traffic.

Readback is a privileged installation operation, not a new general capability
for applications to inspect protected live memory.

On mismatch, show the first differing address and expected/actual values,
plus the compared length and mismatch count where available. On truncation,
timeout, or framing failure, report incomplete verification instead of success.
Keep execution held and disable Start.

There is no automatic rollback promise: after the first write, the previous
runtime may already be destroyed. Never resume it from partially replaced RAM.
Retry requires explicit action and fresh checks; it is not silent recovery.

## 6. Explicit Start

Success ends at **Verified — ready to start**, with a separate
**Start selected image** action.

Start is permitted only for the verified operation on the same board, with
the hold and unchanged-image conditions still valid. Reset, intervening writes,
or lost correlation invalidate readiness until re-established.

Initialize execution through boot ROM using the newly installed RAM image.
Do not restore or execute the previous software image. Report startup evidence
separately as **Started**, **Faulted during startup**, or **Start unconfirmed**.
Readback success proves transfer equality, not program correctness.

## 7. Two LightningBolt targets under Amobea

The next Factory Build must include both options in the same approved image.
Amobea owns their round-robin control; the IDE must not alternate them through
host-timed commands, and hardware must not substitute unrelated target choices.

**Both GT-use cases must be demonstrated; they are not alternatives.**

| Demonstration | Required distinction |
| --- | --- |
| Mallory attack | Thread-GT scheduling between the separate Alice and Mallory Threads; preserve each actor entry GT in its own Thread's CR1. Mallory remains the faulted Abstraction, not a disabled Thread. |
| CapabilityTest/SelfTest/CallHome loop | Callable-Abstraction GT use with CALL/RETURN. CapabilityTest calls SelfTest and WukongCallHome, which return to CapabilityTest. Preserve the loop's CHANGE coverage; this case is not evidence of switching between the two actor Threads. |

Keep each case's register context, GT type, selected revisions, and execution
evidence distinct. Demonstrating both does not authorize repurposing the boot
Thread's prepared CR0 or imply that the same CR0/CR1 values serve both cases.
SelfTest does not gain a Next capability; the caller owns its loop.

The requested CR0/CR1 GT arrangement is required. Exact binding and scheduling
details for each case must be approved before implementation:

| Approval item | Required selection |
| --- | --- |
| CR0 target | Per-case GT type, exact target and selected revision: **unresolved** |
| CR1 target | Per-case GT type, exact target and selected revision: **unresolved** |
| Register/context ownership | Specify whose CR0/CR1 contain the two GTs and how existing startup and application bindings are preserved. |
| Turn boundary | Specify the approved completion, yield, or scheduling event that advances Amobea to the other target. |
| First turn | Specify initial target and fresh-start/reset behavior. |

Every turn handoff must validate the GT when it is used against the live
destination slot version and applicable runtime authority checks. A GT held
in CR0/CR1 across turns is not exempt. Demonstrate rejection when the target
version changes between turns. Revalidation must never silently refresh a
stale GT; adopting corrected code uses the separate authorized binding path.
The precise handoff and check sequencing must be resolved before implementation,
including exclusion of a version-change/check/use race.

The existing Amobea design leaves parts of bootstrap/CR0 binding unresolved.
Do not treat historical Alice/Mallory startup assignments as implicit approval
of this new pair, invent a timer quantum, or overwrite CRs to satisfy a display.
Respect existing capability checks and protected Thread state. Mallory's
denied-access fault must be reported without halting the whole FPGA.
The denied operation must not complete or acquire additional authority.
Preserve the faulting instruction, actor/Thread identity, and denial reason
as evidence; show the contained fault separately from board execution state.

### Explain the security boundary: one RW data object in Mallory

The user identifies this example's error case as **one RW data object in
Mallory**. Pinpoint the instruction at error; do not replace this explanation
with a generic whole-Abstraction, Thread, or FPGA failure badge.

The operator-facing evidence must show:

- The exact affected RW object identity and its relationship to Mallory.
- The executing Mallory revision, faulting instruction address/offset and
  disassembly, and the corresponding source location when an exact source
  mapping exists. If the mapping is unavailable, say so instead of guessing.
- The attempted operation and the capability/GT used, resolved to its object
  identity, with the relevant actual permissions and bounds.
- The precise failed runtime check and why that operation was not permitted.
  RW rights do not authorize access outside the capability's object or bounds;
  do not invent the particular failure reason before inspecting the evidence.
- What effect was blocked, whether any state changed, and the evidence that
  effects did not propagate outside the affected object.
- What authorized work continues on the Thread and FPGA.

**Fault-reason reconciliation gate:** The retained
[physical reload report](installed-image-reload-result.md) records BOUNDS
(`0x08`) at `0x2e08`, mapped to Mallory's `LOAD CR1, CR6, #2`, while source
comments anticipated NO_CAPABILITY. Display that historical event as observed,
not as the comment's expected fault. For each new build, derive the displayed
code/reason from its own correlated board evidence; do not hardcode BOUNDS.

Before building the tutorial's causal explanation, reconcile the exact
instruction, operand GT, object geometry, and RTL check ordering for the
retained image/build. Establish whether BOUNDS is enforcing that capability's
object boundary or fires before another capability/permission check is reached.
Record which checks actually participated and which were not exercised.
Access denial alone does not settle this question. Keep exact fault-code
conformance open until this evidence is reconciled; then cross-reference the
result in the physical reload evidence and tutorial acceptance record.

**Reconciliation result:** See
[Mallory fault-mechanism reconciliation](nfb1-mallory-fault-reconciliation.md).
The retained CR6 has a two-entry C-list (inclusive limit 1); the instruction
requests entry 2. Current RTL replay raises BOUNDS before any GT fetch.
This enforces source-capability C-list bounds, after source NULL/L checks
and before target Namespace/permission or RW-object access. Do not teach this
historical endpoint as a demonstrated RW-object access violation.
Exact-build physical acceptance and approval of the tutorial explanation
remain open.

Keep the executing Abstraction, affected data object, capability, and Thread
distinct in the report. Attribute per-object reliability evidence to the
actual affected object rather than collapsing every Mallory incident into one
generic counter. Do not conflate denied access with demonstrated corruption:
report the actual observation. This example must explain security, not conceal
the mechanism behind a success badge or expose unrelated protected contents.

Amobea must retain control of scheduling so the other authorized work can
continue. **Approved disposition: the Mallory Abstraction remains faulted,
not the Thread.** Do not mark the Thread faulted or remove it from scheduling
because of Mallory's denied operation. Keep Mallory's fault evidence available
and do not automatically re-enter the faulted Abstraction.
The affected object's OFFLINE state is defined through its Namespace slot
version, not an independent UI flag. Authorized software management owns
version changes; hardware validates versions and never changes them itself.
Previously issued GTs become stale after the slot version changes. Do not
silently refresh those GTs or mint matching replacements to bypass OFFLINE.

**Caller responsibility:** This analysis directs Amoeba, as the user/caller
of Mallory, to stop polling Mallory. Amoeba must stop issuing further
requests to Mallory and continue other eligible work. Repeated stale-GT
faults are not a substitute for the caller respecting the OFFLINE decision.
This is an Abstraction-level calling decision, not removal of the Thread
from scheduling. Hardware version enforcement remains the independent
protection if a stale capability is nevertheless used. No particular
notification or control ABI is implied by this requirement.

OFFLINE requires a design correction. In this demonstration, the correction
is **removing Mallory's attack**. A reset, retry, or operator acknowledgement
alone is not that correction and must not restore the unchanged attack.
Return to service requires the corrected design and explicit authorized
adoption; the detailed admission procedure remains to be specified.
This requirement does not authorize silently skipping the faulting instruction,
retrying it, restarting Mallory, or weakening capability enforcement. It supersedes a
whole-board halt as the required Mallory demonstration endpoint, not the
handling of unrelated or uncontained hardware faults.

Acceptance must demonstrate A → B → A → B turns while both targets are eligible
through the approved Amobea path, with trace evidence identifying the actual
selected executable and relevant GT/context. After Mallory faults, demonstrate
that the faulted Mallory Abstraction is not re-entered, the Thread is not
disabled, and other eligible work continues. Do not require
Mallory to execute again merely to produce an alternating trace outside that
authorized demonstration loop. Merely showing
alternating UI labels is insufficient.

### Reliability basis: one Abstraction fault

The user defines the single event as **one Abstraction fault**, not a Thread
failure, physical single-event upset, or automatic whole-system failure.
Assess the full flow against that event and its containment.

- Record one incident for the faulting Abstraction, with exact revision,
  instruction, reason, and execution context. Repeated telemetry for that
  incident must not be counted as additional faults.
- Measure Abstraction fault occurrence separately from propagation into loss
  of other authorized work. Mallory's intentional denied-access test verifies
  protection and containment; it is not an unplanned system-service failure.
- For an MTBF estimate, declare the workload, observation boundary, exposure
  clock, and counted fault population. Report measured operating exposure
  and qualifying fault count together. A single demonstration cannot establish
  MTBF, and zero observed faults does not establish infinite MTBF.
- Keep intentional fault-injection results separate from operational MTBF
  data. Do not combine differing revisions or workloads without identifying
  them, or use time spent inactive/faulted to inflate active exposure.
- For each containment test, prove that the denied effect did not occur,
  Mallory remains faulted as an Abstraction, the Thread is not disabled, and
  other authorized work continues under Amobea.

**Approved Amoeba default minimum MTBF: 12 months.**
The default requirement is **measured MTBF ≥ 12 months**. Values strictly
below 12 months trigger Must Resolve when the measurement is assessable;
equality satisfies the numerical threshold. More demanding applications may
require a higher approved minimum. The setting is a requirement, not a claim
that an object's measured MTBF already meets it.

Observation duration, statistical confidence, and the precise conversion of
months to exposure units remain to be specified. Do not silently choose a
30-day month or another conversion, or mark insufficient evidence as passed.
The priority remains exposing the fault at its first occurrence and fixing
its cause, not masking it with retries or recovery claims.

### Fault journal, reboot handoff and exposure accounting

#### Fault entry into Boot.Thread — CHANGE save bypass

Current design decision and superseded-draft record:
[Boot.Thread fault-entry FPGA proposal](boot-thread-fault-entry-proposal.md).
The [minimal service-restoration sequence](boot-thread-fault-entry-proposal.md#proposed-minimal-service-restoration-sequence)
requires Boot.Thread priming first, then one outgoing save attempt and
entry into the already-primed Boot context for either save outcome. Immediately
on fault, stash directly into Boot.Thread without intermediate registers.
A failed Boot stash enters an indefinite catastrophic-recovery loop flashing
an LED. Useful service is the programmer's task, outside this FPGA mechanism.
The wider Phase 1 Mint/template goals remain separate. Detailed implementation is awaiting
approval and is not an implementation or hardware acceptance claim.
Phase 1 uses the **saved Thread context**, not a separate 96-word dump object.
The context is remembered, not diagnosed as a prerequisite to restoring
service. The earlier separate-dump register
table, release interface and capture policy are superseded, not approved.
Microcode primes Boot.Thread with both the existing GT of the Thread executing
at the fault and its existing Namespace capability. No replacement GT
or separate dump capability is introduced. The
[active register proposal](boot-thread-fault-entry-proposal.md#active-register-proposal--saved-context-handoff)
places these in CR1 and CR2 respectively, distinct from Boot.Thread's own
active CR12 identity and Boot Namespace in live CR15. Assignments and the
saved-context status DRs remain proposals for approval.
Define only the additional fault facts and faulting Namespace information
not already retained by the saved context; their exact placement and
Boot.Thread inspection authority remain review items.

**Agreed direction:** the fault handoff bypasses CHANGE's outgoing-context
save and explicitly primes Boot.Thread's DRs and CRs **before** attempting
the faulting Thread save. Preserve the original live context while preparing
Boot's destination context. Finalize save status, then activate the already-
primed Boot context; do not repeat the save implicitly through CHANGE.
In the matrix below, “dump” means this saved Thread
context, not a separate diagnostic object. Treat these cases as catastrophic
recovery: remember the event and restore service through the configured Boot
path and Mint/Amoeba transaction templates. Diagnosis, IDE reporting and MTBF
calculation must not gate restoration. Do not resume the denied instruction,
revive OFFLINE code or claim incomplete evidence is complete.

**Agreed ownership and KISS rule:** microcode primes Boot.Thread's DRs and
CRs for this fault entry. Keep this a minimal, deterministic mechanism using
the approved initial values and trusted inputs, not a recovery-policy engine.
Do not add retry loops, alternate targets, silent context repair or recursive
re-priming. Hardware never changes Namespace versions. Fault inspection,
reliability assessment and authorized Mint/Amoeba transaction recovery belong
to software after entry. Failure of the defined entry path follows the
specified hard-fault boundary rather than inventing another recovery path.

This is a dedicated fault-entry contract, not a change to ordinary CHANGE.
Boot.Thread runs in the Boot Namespace. Capture and retain the faulting
Namespace before priming live CR15 with Boot Namespace authority; dump and
execution identities must not be reinterpreted against Boot's slot table.
Exact register assignments, trusted sources, entry frame/NIA, ownership
transition and commit ordering remain to be approved. Bypassing the save
does not bypass destination capability validation or authorize new GTs.
Boot.Thread priming must not inherit arbitrary application authority.
Normal prepared boot behavior remains separate from this fault-entry path.

The following matrix retains earlier case descriptions for test coverage;
its diagnostic-first dispositions are superseded by the common catastrophic
recovery policy above. No separate diagnostic workflow is required per row.
Actual safe entry/commit and behavior if the recovery path itself is unavailable
still need specification; neither a safety-check bypass nor successful
restoration is implied. “Faulting Thread” identifies the execution context of the
Abstraction fault; it does not declare the Thread itself defective.

| Case | Diagnostic save and inspection | Boot.Thread entry and disposition |
| --- | --- | --- |
| 1. Save succeeds; inspection succeeds | Complete context saved without a second error; Boot.Thread validates and inspects the matching dump under its authorized capabilities. | Prime Boot.Thread DRs/CRs and enter without CHANGE save. Retain the incident; continue eligible work under the approved management contract. |
| 2. Save succeeds; inspection fails | Complete dump retained, but inspection authority or validation fails. | Same save-bypass entry. Preserve the original evidence and separate inspection fault; no authority bypass or containment claim based on unread evidence. |
| 3. Save fails; partial evidence inspectable | Second error leaves an explicitly incomplete dump; independently retained original fault evidence remains available. | Same save-bypass entry, without retrying the failed save. Record both errors in order; do not treat partial state as a resumable continuation. |
| 4. Save fails; inspection fails | Neither a complete save nor safe inspection is available. | Do not depend on CHANGE save to reach fault management. If safe priming/entry or inspection cannot complete, use the defined hard-fault outcome, not recursive recovery. |
| 5. Boot.Thread already active | A previous management operation owns its context. | Do not overwrite it with fresh DR/CR priming. Define bounded pending-incident handling and overflow disposition before implementation. |
| 6. Boot.Thread faults | Management execution itself raises a fault. | Preserve the separate failure; no recursive re-priming. Keep the specified Boot.Thread hard-fault/purgatory boundary. |
| 7. Stale dump | Otherwise valid bytes belong to another incident or session. | Reject the association using incident/context identity; never substitute it for the current dump. |
| 8. Prior effects uncertain | Dump is complete but earlier application writes or external effects are unresolved. | Successful capture is not rollback or proof of containment. Apply the transaction's approved clean-recovery contract. |
| 9. Reporting disconnected | Local handling succeeds but UART/Ethernet delivery is unavailable. | Retain evidence under the approved durability contract; reporting delay must not retry application execution. |
| 10. Mint initialization fails | Authorized fresh-Thread creation cannot complete. | Retain the initialization failure; never execute partial state or silently resume the faulting continuation. |

Required design order: **immediately stash the event directly into Boot.Thread
and prime it first**, with no intermediate event registers and without
destroying the outgoing live context; attempt its protected save
once and finalize the outcome fields; transfer to the already-primed Boot
context **without CHANGE save**. Useful-service restoration belongs to the
programmer. Diagnosis is not a prerequisite. Failed Boot stash means an
indefinite catastrophic LED-flashing loop, not a new event latch or another
stash attempt. Direct-store and failure-detection timing remain to be specified.

**Required outcome; detailed mechanism pending approval.** Fault evidence and
reliability history must not depend on an open IDE browser or a continuously
connected UART host. A reboot must not erase the reason for the event, make
OFFLINE code eligible again, reset accumulated exposure, or count an old
incident as a new fault.

The journal contract must define capture before execution context is lost,
retention, delivery, and acknowledgement as distinct operations. Remembering
or forwarding a fault does not authorize reboot or resumption. The contained
Mallory demonstration must continue other eligible work without requiring
a whole-board reboot.

The following is the **proposed record and delivery design**, not an approved
storage layout, wire protocol, service ABI or claim of existing functionality:

- Record a stable incident identity, board identity and boot session; exact
  executing artifact/revision; Namespace slot/version and Thread; instruction
  and actual fault code; relevant capability bounds/permissions; affected
  object when established; and an exposure checkpoint. Do not export unrelated
  protected memory or proof secrets.
- Keep containment observations, OFFLINE decisions and corrected-design
  adoption associated with the original incident without rewriting it.
- On reboot, create a distinct boot-session record linked to the predecessor
  and known reset reason. Operator reset, installation and unknown reset are
  not automatically counted as Abstraction faults.
- Retain undelivered records independently of the faulting Abstraction.
  Authenticate Ethernet reports; acknowledge durable server receipt rather
  than merely receipt of a packet. Re-delivery uses the same incident identity.
  Retrying telemetry must never retry the faulting instruction.
- Reconcile cumulative exposure checkpoints by revision and measurement
  session instead of summing repeated reports. Separate occurrence information
  from server arrival time. Network downtime neither proves execution stopped
  nor supplies evidence of continued operation.
- Detect incomplete records, queue overflow and missing exposure intervals;
  surface evidence gaps rather than claiming complete fault counts or MTBF.

For a defined revision, workload and fault population with qualifying faults,
the proposed point estimate is **qualifying operating exposure / qualifying
fault count**. Both terms must cover the same observation population. Report
zero faults as “zero observed over the stated exposure,” not infinite MTBF.
Intentional attack demonstrations remain separate from operational estimates.
Threshold evaluation remains Unassessed until the approved sufficiency rules
are satisfied; fault reporting and containment do not wait for that evaluation.

| Decision still requiring approval | Required definition |
| --- | --- |
| Capture and ownership | Who captures, retains and delivers evidence without depending on the failed Abstraction or a live IDE connection; bounded fields and access authority. |
| Retention | Storage medium, capacity, atomic record completion and overflow policy; guarantees separately for Church reset, FPGA reconfiguration and power loss. RAM retention must not be represented as power-loss durability. |
| Reboot handoff | Incident/session identity, reset-reason source, incomplete-capture behavior and explicitly authorized reboot sequencing; no new automatic recovery permission. |
| Exposure | Execution-time versus active-service-time clock, units, checkpoint frequency, wrap/reset handling and excluded inactive/faulted/OFFLINE periods. |
| Assessment | Month conversion, observation sufficiency, estimator/confidence model and treatment of evidence gaps; preserve the approved strict less-than threshold. |
| Ethernet | Device identity/authentication, protected transport, acknowledgement, deduplication and disconnected queue behavior; reporting authority is separate from control authority. |
| Standalone lifecycle | Startup and runtime behavior without UART or an IDE connection, including preserving OFFLINE decisions and reporting failures without inventing additional program recovery. |

### Per-object reliability and Must Resolve queue

When corruption is confirmed contained within one Abstraction, unaffected
authorized work continues; that incident alone must not halt the Thread or
FPGA. Containment must include effects on other objects and shared state,
not merely the location where the fault was reported. Unknown containment
must not be reported as proof that nothing else was harmed.

The approved escalation rule is:

**Measured MTBF of an individual object < its allowed minimum MTBF →
add that object to the Must Resolve queue.**

Track object identity and revision alongside the qualifying incidents,
measured exposure, measured MTBF, and applicable allowed minimum. Update an
existing open queue entry rather than duplicating it for repeated telemetry.
The queue records required corrective work; it does not itself authorize
global halt, additional capabilities, automatic retry, or resumption of a
faulted Abstraction.

A per-object override is not required: inherit Amoeba's approved 12-month
default minimum unless a different applicable minimum is explicitly approved.
If the applicable setting is unavailable or measurement evidence is
insufficient, label the object **Unassessed** and do not evaluate the MTBF
escalation as passed. Its MTBF-based queue trigger remains inactive until
those inputs are available; fault reporting and containment still operate.
The queue and threshold enforcement remain implementation requirements,
not claims of existing runtime functionality.
Queue resolution must not erase the retained incident evidence.

Acceptance must check the strict less-than comparison (including equality
and values on either side), per-object attribution, incident deduplication,
and continued unaffected execution when containment is established.

### Repeatable security demonstration

The user explicitly authorizes the demonstration to loop based on the default
MTBF setting until its message is understood. Provide an explicit demonstration
start and a visible Stop control so the viewer decides when to finish.

Each cycle must explain the affected RW data object, exact instruction at
error, attempted access, failed security check, containment evidence, and
continued unaffected execution. Keep prior incidents available across cycles.
The loop must exercise the security checks, not merely animate a successful
result or silently skip the offending instruction.

**Default MTBF is an Amoeba setting.** The demonstration must use Amoeba's
configured value, not a separate IDE default or demonstration-only override.
Display that value with its units and role in the demonstration.
Its approved default minimum is **12 months**; the mapping to loop
timing/eligibility remains to be defined. Do not invent that mapping,
treat an MTBF threshold as a retry timer without a defined mapping, or use a
clean-run score as a time-based MTBF.

Starting this mode authorizes controlled demonstration repetitions while
the relevant objects remain eligible; it does not bypass version-defined
OFFLINE status. Once an object is OFFLINE, do not revive the unchanged
attack to keep the loop running. Keep its explanation and evidence visible
until the design is corrected. The implementation must define how each
eligible cycle is prepared under existing authority without granting new
rights, erasing evidence, faulting the Thread, or globally rebooting the FPGA.

Retain the per-object Must Resolve queue rule during the demonstration, with
intentional demonstration events clearly identified and kept separate from
operational MTBF claims. Test repeated cycles, Stop, evidence retention, and
that repetition does not become implicit recovery outside demonstration mode.

### Close the example with corrected Mallory

Include a revised Mallory with the attack removed as the final demonstration
stage. Preserve the original attacking revision and its incident evidence;
do not rewrite history or make the old GTs valid again.

Show the complete sequence:

1. Identify the RW object, attack instruction, failed check, and containment.
2. Show the applicable MTBF analysis, Must Resolve entry, version-defined
   OFFLINE state, and Amoeba stopping its polls of Mallory.
3. Show the source/design change that removes the attack, with the original
   and corrected revision identities clearly distinguished.
4. Explicitly approve and adopt the corrected revision through the authorized
   binding/admission path. Do not silently refresh stale GTs or weaken checks.
5. Let Amoeba resume requests to the corrected Mallory and demonstrate its
   intended authorized work completing without error under the same protection
   rules. Other eligible work must continue.
6. Attach the corrective revision and observed successful execution to the
   Must Resolve item. Close it only through the defined resolution process,
   preserving the original fault evidence.

Success must be demonstrated by the expected work and execution evidence,
not merely by absence of a fault badge or replacing Mallory with a no-op.
Label the observed error-free run duration/cycles; it does not establish an
unmeasured operational MTBF. This is a design correction and explicit adoption,
not automatic recovery of the original attacking object.

### Side-by-side LUMPs, evolution, and upgrade fallback

The example must also demonstrate side-by-side LUMPs and code evolution.
Retain distinct immutable revisions instead of overwriting the old LUMP.
Show which exact revision Amoeba currently uses and make adoption of the
replacement explicit; coexistence alone does not switch callers.

Demonstrate controlled fallback during an upgrade to an approved, compatible,
still-eligible known-good LUMP. The original attacking Mallory may remain
available as historical evidence, but its OFFLINE status makes it an invalid
fallback target. To demonstrate executable fallback, retain a safe baseline
alongside an upgraded safe candidate rather than revive the attack.

Fallback must use authorized bindings and respect slot versions, capability
checks, and state compatibility. Code selection is not automatic restoration
of older data or reversal of external effects. Identify any state transition
requirements explicitly; never assume that retaining old code makes current
state compatible with it.

Acceptance must show side-by-side identities, deliberate upgrade selection,
actual execution of the selected revision, and a controlled return to the
eligible baseline without disturbing unrelated work. Reject fallback to the
OFFLINE attacking revision. Retain the upgrade/fallback evidence alongside
the original denial and corrected-Mallory evidence.

## 8. Operator presentation and installation receipt

Use one progress view with distinct states:

**Checking → Ready for confirmation → Holding → Loading → Reading back →
Verified/stopped → Starting → Started**

Show a failure or unknown state at the actual failed stage, with whether RAM
may have changed and the next permitted action. Do not display a queued
command as a completed hardware operation.

Retain a receipt identifying the board/session, Factory Build, approved
Namespace revision, exact projected-image hash and length, operation ID,
hold evidence, upload result, readback coverage/result, and separate start
result. Preserve any preceding fault incident without exposing credentials
or publishing raw protected-memory contents in ordinary logs.

## 9. Acceptance gates

Before a candidate build is accepted:

- RTL tests cover installation hold from running, halted, and faulted states,
  including no old-program execution between fault clearance and upload.
- Tests prove no unauthorized memory writer runs during transfer/readback.
- Protocol tests cover malformed lengths, truncation, stale acknowledgements,
  interleaved traffic, timeouts, reconnects, and conflicting commands.
- Readback tests inject memory differences and prove they block Start.
- Exact-image tests cover immutable revision selection and byte order.
- Amobea tests demonstrate the approved two-target turn sequence and GT
  bindings without bypassing normal runtime authority checks.
- Retain separate evidence for Thread-GT scheduling in the Mallory attack
  demonstration and callable-Abstraction CALL/RETURN in the
  CapabilityTest/SelfTest/WukongCallHome loop. Neither substitutes for the other.
  Identify the owning register context and actual targets in both cases.
- Change a destination slot version between turns and prove that a retained
  CR0/CR1 GT is rejected on use without silent refresh or a check/use race.
- Match the displayed fault code, reason, instruction, and object to the
  actual correlated board evidence for the exact build. Resolve the historical
  BOUNDS-versus-NO_CAPABILITY discrepancy and check ordering before claiming
  that the tutorial has demonstrated a particular security mechanism.
- Verify inheritance of Amoeba's 12-month minimum, strict less-than escalation,
  equality at the threshold, and Unassessed behavior for unavailable settings
  or insufficient measurement evidence.
- With defined demonstration measurements and the applicable MTBF setting,
  prove the attack stage reaches OFFLINE/Must Resolve and Amoeba stops polling.
  It must not loop forever by reviving the attacking revision. This ends the
  attack stage, not the corrected-Mallory and safe-upgrade/fallback stages.
- The Mallory denial is reported with matching instruction and Thread evidence,
  its forbidden effect does not occur, the FPGA does not enter a global halt,
  and other authorized work demonstrably continues under Amobea. Verify that
  subsequent scheduling opportunities do not re-enter the Mallory Abstraction
  or erase its fault state outside an eligible demonstration cycle or the
  authorized corrected-design adoption path. Verify stale GTs cannot bypass
  version-defined OFFLINE and a reset cannot restore the unchanged attack.
  Verify Amoeba stops issuing Mallory polls after acting on the analysis,
  rather than repeatedly provoking stale-GT faults, while other eligible
  work continues.
  Verify the Thread
  itself remains available for authorized work. A running badge alone is not
  proof of continued execution.
- IDE tests cover both success and failure paths, explicit Start, and no
  false installed/verified/started claims.
- Complete and validate Phase 1 Mint, including operational initialization of
  new Threads through Mint/Amoeba from each selected application transaction
  template. Identify the exact template, application revision, inputs and
  authorized capabilities; fixture priming alone is insufficient.
- Demonstrate authorized clean recovery into a newly initialized Thread
  without reusing the faulting continuation, erasing incident/exposure history,
  reviving OFFLINE code or claiming reversal of prior external effects.
  Validate malformed/stale templates and unauthorized bindings against the
  approved contract without weakening hard-fault rules.
- Exercise the fault-entry matrix above. Prove Boot.Thread DR/CR priming
  uses the approved inputs, preserves original fault evidence, and performs
  no outgoing CHANGE save, including after a failed diagnostic save.
  Verify normal CHANGE retains its existing save behavior and fault entry
  does not bypass capability checks or recursively overwrite Boot.Thread.
- A separately authorized physical acceptance run repeats the flow from
  running, halted, and faulted states using exact retained build/image bytes,
  then confirms both LightningBolt targets execute in the approved order.

### Mandatory Phase 1 Ethernet and standalone completion gates

These extend the UART acceptance work; they do not replace it. Execute them
against the approved journal, measurement and Ethernet contracts, not invented
test-only defaults. Retain exact build/image identities and scoped results.

- Start and operate each FPGA singleton with the IDE UART host and external
  UART bridge disconnected. Prove actual authorized work, not merely a
  running indicator. An open IDE browser is not required.
- Deliver fault incidents and exposure evidence over board-native Ethernet
  to the IDE server while the browser is closed; reopening the IDE must show
  the retained evidence and its exact device, session and artifact attribution.
- Interrupt the network, continue the independently authorized workload,
  reconnect, and verify delayed delivery, deduplication and exposure
  reconciliation. Do not infer exposure from the length of the outage.
- Exercise duplicate, reordered, interrupted and rejected reports, lost
  acknowledgements, server restart and bounded queue exhaustion. No duplicate
  faults or exposure totals; incomplete evidence must be visible.
- At separately authorized reboot boundaries, verify original incidents remain
  identifiable, reset reasons are distinguished, new sessions do not fabricate
  faults, and OFFLINE revisions are not revived. Test Church reset, FPGA
  reconfiguration and power-loss retention separately against the approved
  guarantees; do not substitute one for another.
- Verify unauthenticated or replayed reporting cannot forge incidents, change
  management state, grant execution authority or trigger reboot/Start.
- Verify MTBF results from known exposure/fault inputs, including zero faults,
  duplicated checkpoints, missing intervals, revision changes and intentional
  demo events. Test below/equal/above the 12-month threshold using the approved
  unit conversion and sufficiency rules.

UART-only operation and bridge-mediated network delivery cannot close these
standalone gates. No result here implies multi-FPGA coordination acceptance.

Simulation results, synthesized build results, and physical evidence must
remain separately identified. None may stand in for the others.

## 10. Approval and release boundary

1. Review this scope and resolve the binding/scheduling, journal/reboot,
   measurement and Ethernet/standalone contracts in section 7.
2. Explicitly approve the completed specification before building.
3. Implement, validate, and produce the next Factory Build with retained
   source, inputs, bitstream identity, and test evidence.
4. Obtain separate authorization for programming and physical acceptance.
5. Accept the exact tested Factory Build and publish compatible IDE changes
   through the normal release approval process.

No build, physical upload, reset, flash, activation, or publication is
authorized merely by preparing this document.

### Work sequence through Phase 1 completion

This sequence preserves the completed investigations and adds the mandatory
standalone endpoint. It is a documentation-level sequence, not authorization
to begin implementation or hardware operations.

| Stage | Deliverable and exit condition |
| --- | --- |
| 1. Starting baseline — delivered | [Baseline report](nfb1-starting-baseline.md): retain the observed failures and evidence limits; delivery is not a green release baseline. |
| 2. Mallory mechanism — delivered | [Reconciliation report](nfb1-mallory-fault-reconciliation.md): retained C-list bounds denial explained by isolated RTL evidence, not proof of target RW access or physical NFB1 acceptance. |
| 3. Bindings, turns and transaction templates — approval pending | Define context ownership, exact targets/revisions, first turn, normal turn boundary, on-use GT validation and contained-fault handoff for both demonstrations. Define the Mint/Amoeba template initialization contract and authorized clean-recovery boundary. |
| 4. Evidence and standalone contracts — approval pending | Resolve the journal/reboot/exposure/MTBF decisions above and Ethernet/standalone lifecycle. Design these before implementing a UART-dependent evidence system. |
| 5. Mint completion and UART implementation/validation — future authorized work | Finish Phase 1 Mint and prove new-Thread initialization from application-transaction templates through Amoeba, including authorized clean recovery. Implement the approved hold/load/readback/explicit-Start flow and both demonstrations, including correction/adoption/fallback and evidence accounting. Resolve relevant baseline failures before claiming release gates pass. |
| 6. UART physical milestone — separate authorization | Validate exact retained builds/images through the published IDE. Preserve installation and demonstration receipts; this is intermediate Phase 1 acceptance only. |
| 7. Ethernet and standalone implementation — future authorized work | Implement board-native reporting and independent operation using the approved evidence contract; a networked UART bridge is not the final deliverable. |
| 8. Standalone physical acceptance — separate authorization | Complete the Ethernet/standalone gates above, with UART disconnected, browser closed, outages and reboot evidence. Only then may the transport/standalone portion of Phase 1 be declared complete. Other Phase 1 gates remain applicable. |

Historical investigation reports remain unchanged as evidence of their original
inputs and scope. Their earlier “next step” wording is historical; this section
is the current work sequence. No stage retroactively promotes an earlier test
into proof of a newer requirement.

## References

- [Namespace layouts and full-image reload](namespace-layouts-and-full-image-reload.md)
- [Existing bounded physical reload evidence](installed-image-reload-result.md)
- [Amobea V1 design and unresolved bootstrap contract](Amobea-V1.md)
