---
name: Phase 1 shared documents
description: User-requested ISA-first organization and single-source preservation policy.
---

Keep the related Phase 1 architecture and release documents together in one
shared collection, starting with the ISA.

Apply explicit approvals and routine FPGA engineering choices made under the
user's delegated discretion when reconciling active specifications; distinguish
the two. Preserve original audit snapshots and historical evidence, and keep
software TBDs visible.

**Why:** The user initially selected approved-decisions-only reconciliation,
then explicitly delegated routine FPGA edge details to the agent: choose the
easiest design and report the decision rather than asking each small question.

**How to apply:** Correct active original files through the single-source
collection; use explicit profile/supersession boundaries for retained old
descriptions. Resolve routine implementation details consistently with the
approved contract and report them together. Ask only for consequential changes
to authority, ISA behavior, compatibility or hardware scope; do not invent
user approval or claim implementation evidence. Delegation does not authorize
runtime changes, builds or flashing in this documentation-only review.

Prefer immutable bitstream parameters for protected bootstrap configuration,
not a new runtime-writable register bank or unlock protocol.

**Why:** Under the user's delegated simplest-FPGA-design instruction, this
avoids an additional mutable authority path while preserving approved boot
guards and one-shot reset admission.

**How to apply:** Keep the watchdog's separately authorized control writable.
Treat exact placement/wiring and physical verification as outstanding evidence,
not repeated architectural approval questions or permission to build/flash.

**Why:** The user explicitly requested one place for the related documents after
the Master ISA reconciliation. Scattered review editions had made their status
and relationships difficult to follow.

**How to apply:** Add future related documents to the shared reading index.
Preserve a single authoritative original and existing paths rather than creating
competing copies. Keep historical evidence and unapproved proposals visibly
separate from controlling specifications; collection membership does not grant
approval.

Phase 1 document reviews must cover the collection but stay within it.

**Why:** The user explicitly asked to review “all but only Phase 1 documents.”

**How to apply:** Use the collection manifest as the audit boundary. Treat
references to excluded code or documents as unverified dependencies, not
permission to expand the review or claim runtime conformance.

Resolve the completeness-review findings with the user one at a time in
priority/dependency order, recording a resolution per item in the review.

**Why:** The user explicitly requested guided, sequential decisions rather
than a batch of inferred architectural approvals.

**How to apply:** Explain the current finding and the proposed resolution,
obtain the user's decision, and update its resolution before moving on.
Keep proposed decisions distinct from approved ones and from implementation
or hardware authorization.

The user confirmed the new Phase 1 Namespace slot assignment: metadata at 0,
Namespace self-entry at 1, and entry Thread at 2 for both reset boot and
Namespace handoff.

**Why:** This explicitly settles the review's reset-versus-handoff ambiguity;
the repeated “slot 1” in the initial comment was clarified by the user.

**How to apply:** Use this approved assignment when reconciling the Phase 1
documents. It does not authorize migrating existing images or settle other
reset instruction/authority questions.

CR13 is reserved, NULL and never touched in Phase 1: no IRQ/watchdog role,
SWITCH destination, restore or explicit handoff clearing.

**Why:** The user corrected the assistant's retention of CR13 in protected-load
forms: “CR13 was IRQ and is now reserved (NULL), never touched in Phase 1.”
This supersedes the earlier interpretation that SWITCH CR15 still clears it.

**How to apply:** Remove both interrupt-Thread installation and explicit CR13
handoff clearing when reconciling current documents. Exclude CR13 from SWITCH
destinations; do not infer permission to write NULL merely to preserve NULL.
Keep historical proposals unchanged and watchdog policy separate.

The user approved the Master's ascending layout as the sole new Phase 1
Namespace layout and explicitly assigned Namespace Table slot 9 to `ide.Mint E`,
slot 14 to `nstab RW` (hand-crafted Namespace-table RW capability, “the power”),
and slot 15 to `pkverify E` (a new, yet-to-be-defined LUMP). The user stated
slot 9 is empty. These exact assignments replace “three trailing additions.”
The user also explicitly assigned UART to Namespace slot 8, supported by their
Namespace View screenshot; do not carry the legacy UART-at-slot-2 requirement
into the new Phase 1 map.

**Why:** These are explicit user requirements accompanying layout approval,
not inferred runtime provisioning or a completed verifier design.

**How to apply:** Preserve the approved Namespace slots and requested rights.
Capability holders/issuance and pkverify behavior still require their own
contracts; do not treat Namespace placement as blanket authority issuance.

CHANGE is THREADSAVE → THREADLOAD. SWITCH is the same sequence with
LOAD NAMESPACE (CR15) inserted between those halves. Ordinary CHANGE leaves
CR15 unchanged; neither sequence touches CR13.

**Why:** The user repeated and clarified this relationship after the assistant
distracted from it by retaining separate SWITCH protected-load qualifications.

**How to apply:** Use the exact two-halves/inserted-Namespace-load formulation
in reconciliation. These are internal phases, not separate instructions.
Do not treat the assistant's withdrawn CR12/CR14 qualification as user approval.

Phase 1 uses bounded execution turns with a selectable watchdog hard fault at
0.25, 0.5, 1 or 2 seconds, initially 1 second, except in IDE Debug or IDE Trace
mode. Instruction retirement does not renew the deadline. Every successful
CHANGE or SWITCH starts a fresh selected interval,
including self-transfers and helper-Thread transfers; renewal is not restricted
to scheduler handoffs.
When normal execution resumes with neither IDE Debug nor IDE Trace active,
start a fresh selected interval rather than restoring a partially spent interval.
Hardware reset preserves the existing Debug/Trace exemption; it does not clear
an active exemption or create one when none was active.
For Phase 1 bootstrap, power-on/FPGA configuration initializes the exemption
enabled and timeout selection to 1 second; Genesis = IDE in this scope.

**Why:** The user selected bounded turns and explicitly fixed “ONE second to
Hard Fault unless in IDE debug or IDE Trace mode.” They then explicitly selected
every successful CHANGE/SWITCH as the renewal event.
They also explicitly selected a fresh second on return from Debug/Trace.
They approved arming when execution starts after reset (including boot, except
in the exempt IDE modes), elapsed-time rather than instruction-count timing,
and expiry winning at the deadline. A transfer must complete strictly
before the deadline to renew it.
The user subsequently selected preserving the exemption across hardware reset,
not the offered clear-on-reset recommendation.
The user then explicitly selected enabled initialization as a Phase 1 bootstrap
decision where Genesis = IDE, rather than the offered normal-protection default.
They later approved four timeout choices, replacing fixed-one-second policy
while keeping 1 second as the initial selection.

**How to apply:** Preserve the duration, exceptions and transfer-based renewal.
Do not introduce scheduler-only renewal, or claim this guarantees useful progress
or return to a scheduler. Preserve fresh-interval mode exit; broader maintenance
exemptions must not be inferred. CR13 remains untouched.
Distinguish reset retention from enabled Phase 1 initialization: reset preserves
even a subsequently disabled state; power-on/configuration initializes enabled,
not the previous pre-power-loss state. Do not extend this bootstrap default to
later phases. The MMIO abstraction remains in control.

The watchdog register must exist as a Genesis-provisioned MMIO GT; the MMIO
abstraction is in charge, not an IDE-only hardware control.
Its approved Phase 1 control word has bit 0 as exemption, bits 2:1 as timeout
selector, and bits 31:3 reserved (read zero, require zero on writes).

**Why:** The user corrected the IDE-only proposal and specified that the
watchdog MMIO GT must exist at Genesis under the MMIO abstraction.
The user subsequently approved the control layout, asked about four timeout
variations, then approved 0.25/0.5/1/2 seconds with initial selection 1 second.
The user explicitly selected next-start/renewal application of timeout changes,
preserving the current deadline for both shorter and longer selections.
They also explicitly approved retaining the selected timeout across hardware
reset, while power-on/FPGA configuration still initializes it to 1 second.
They approved ascending selector codes 00/01/10/11 for 0.25/0.5/1/2 seconds,
making the initial exempt control word 0x00000005.
They explicitly approved whole-write rejection and hard fault for reserved-bit
writes, rather than masking invalid bits and partially updating controls.
They agreed to reuse INVALID_OP (0x0B) for those writes, keeping WATCHDOG (0x1F)
for timeout expiry rather than malformed control values.
They explicitly chose expiry over a valid exemption write on the same clock
edge, with whole-write rejection and unchanged control settings.
They agreed that a combined selector change and exemption exit is atomic and
starts the interval with the new selection, not the previous one.

**How to apply:** Do not infer access for all Threads from the user's unfinished
sentence. Address and GT distribution remain open; selector-code mapping is
settled. Do not apply the power-on control value during ordinary hardware reset.
Hardware reset preserves selection, not elapsed countdown time; execution
starts a fresh retained-duration interval unless exempt.
A changed timeout takes effect at
the next approved timer start/renewal; the current duration/deadline is unchanged.
Selector writes alone never restart or extend the active interval.
An exemption exit (1→0) uses the selector from that same valid control write;
writing exemption=0 when already non-exempt is not a new timer-start event.
Reserved-bit writes report INVALID_OP and must not change controls or the active
deadline. This does not freeze elapsed time or suppress expiry.
An exemption write must take effect strictly before expiry; same-edge writes
are wholly rejected. Keep instruction-fault reporting priority without removing
watchdog containment.
Preserve the approved timing/renewal rules. Mint's MMIO-creation exclusion does
not exclude Genesis-provisioned platform MMIO, and software is not a bitstream gate.

Phase 1 gt_seq is 9 bits, values 0–511, for GTs and corresponding Namespace
descriptors.
Generation management is exclusively software-controlled. Hardware's generation
role is equality checking against the Namespace entry, faulting on mismatch;
there is no hardware increment, exhaustion enforcement or wrap-rate guard.

**Why:** The user explicitly selected the 9-bit format over stale 7-bit work-plan
requirements.
The user explicitly corrected the generation discussion: hardware is not
involved beyond checking equality.

**How to apply:** Align active descriptions with this width. Width approval alone
does not approve modulo wrap or generation reuse; never infer that policy.
Keep any reuse/exhaustion policy in software. The earlier general no-wrap
proposal was not approved then; the subsequent pool-release decision below
approves software increment without wrap for release; the later retirement
decision reserves 511 and permits ordinary issued versions 0–510 only.

Keep the existing integrity32 formula, ignoring both F and G in its input.
No further formula revision is authorized.

**Why:** After clarification, the user explicitly directed: “Do not revise the
formula beyond ignoring both F and G.”

**How to apply:** Reconcile prose that mentions only G with the two-flag mask.
Do not treat calculation masking as a stored-flag write or an authority grant.

T identifies networked objects in networked IDE/CM systems, including one IDE
with several CMs: think of it as a networked Golden Token. Without a network,
T === GT.

**Why:** The user explicitly restarted F8's definition around network scope,
replacing the earlier frozen-bootstrap versus portable-content framing.

**How to apply:** Do not limit no-network equality to frozen resident objects
or automatically redefine T as a hash on local rebinding. Network representation,
issuance and authorization are not yet specified by this definition; do not
invent them. This decision supersedes older bootstrap-only applicability claims.

The IDE may identify non-memory objects with T values greater than the Namespace
slot count (virtualGTs) when resident + lazy + new LUMPs exceed table capacity.

**Why:** The user explicitly extended the T model so IDE object identity is
not constrained by physical Namespace capacity.

**How to apply:** Preserve this optional virtualGT ID space without requiring
live slots for every IDE-known object. Do not infer a packed encoding, hardware
access authority, or virtual-to-resident binding algorithm from this statement.

Phase 1 starts with **256 total Namespace slots**, numbered 0–255 including
metadata slot 0. Capacity remains configurable; existing slot assignments stay.

**Why:** The user approved increasing the starting capacity from 64 rather than
letting a small physical table constrain the IDE's object catalog.

**How to apply:** Budget 4 KiB for the table and CR15 word-offset limit 1023.
Recalculate resident placement without renumbering slots. Approval selects the
target, not migration or hardware conformance; validate the matching image and
bitstream before hardware use.

Phase 1 requires **one IDE managing several CMs**, including object identity
and management across those CMs. Direct CM-to-CM and multiple networked IDEs
are deferred.

**Why:** The user explicitly chose this middle release scope, not single-CM
only and not the full networked-IDE/CM scope.

**How to apply:** Treat networked T support for that topology as a release
requirement, not merely future documentation. Do not infer a transport or
expand the requirement to direct CM-to-CM operations.

Two Phase 1 Namespaces sharing one CM FPGA's memory to test CM networking
belong to Phase 2.

**Why:** The user explicitly assigned this future networking test to Phase 2.

**How to apply:** Keep this test out of Phase 1 acceptance; do not infer a memory
layout, networking mechanism or hardware authorization. The approved Phase 1
one-IDE/several-CM scope remains unchanged.

Phase 1 memory is one half of the FPGA memory size, leaving the other half for
the second Namespace in the Phase 2 networking test.

**Why:** The user explicitly made the future two-Namespace test a present
Phase 1 memory-budget constraint.

**How to apply:** Fit the Phase 1 Namespace table, LUMP allocations and growth
headroom within that half; do not budget against the entire FPGA memory.
Establish target bytes and placement separately rather than inventing them.

Phase 1 requires working ide.Mint, pkverify and controlled nstab RW use, not
only reserved slots. The agent owns delivery of these services.

**Why:** The user selected working services and directed that they be finished
before the bitstream (preferred), or the LUMP must be reloadable.

**How to apply:** Prefer completing and validating service software before the
bitstream build. The alternative requires demonstrated reloadability without
rebuilding the bitstream; it does not excuse unfinished services at release.
Do not assume arbitrary live replacement is safe or already supported.

Resolve Mint's full Phase 1 scope in the current guided document Q&A, including
related verification/authority contracts, rather than deferring design choices
to implementation.

**Why:** The user explicitly added that the full scope of Mint “must be resolved
by this present Q&A.”

**How to apply:** Bring Mint decisions forward and record explicit resolutions
for scope, ownership, proof/ABI, validation, writes/publication, failures,
loading/reloading and acceptance. Do not treat a reserved slot or operational
requirement as approval of an unspecified implementation.

Phase 1 Mint must support both creation and authorized replacement, but
**RESIDENT LUMPs are excluded from replacement**, even for authorized callers.
The user
also requires a first draft of Mint and related services with room to grow.

**Why:** The user selected “Create and authorized replacement” and explicitly
requested growth space, rather than a tightly sized first implementation.
They then explicitly clarified that authorized replacement does not apply to
RESIDENT LUMPs.

**How to apply:** Do not revert to the older create-only proposal. Define
replacement safeguards in the Q&A. Reserve service growth capacity once its
policy and actual memory budget are established; no fixed size was approved.
Do not use growth space or Mint's replacement operation to justify updating a
RESIDENT service. Any separate resident reload/update path needs its own contract.

Draft Mint and related service code before asking to approve growth headroom.

**Why:** The user answered the proposed 100% allowance with “Draft the code first,”
not approval of that allowance.

**How to apply:** Use the draft to expose remaining decisions and obtain actual
sizing once compilable. Keep unresolved contracts explicit; drafting permission
does not supersede the requirement to settle Mint's full scope in the Q&A.

The user accepted the Tiny service sizing guesses as a planning basis, not
measured sizes or reservations: 2 KiB Mint plus 1 KiB pkverify.

**Why:** The user agreed to adding the estimates to the code draft after they
were explicitly presented as conditional guesses with growth still undecided.

**How to apply:** Preserve that distinction. The small-verifier assumption is
not approval of a verification mechanism; compilation and the settled contract
must determine actual size before allocation.

Mint must use a same-scope LAMBDA as the only code referencing NSRW-GT,
on one Namespace slot at a time.

**Why:** The user refined the proposed Mint-held authority model with this
explicit code-access and single-slot boundary.

**How to apply:** Keep NSRW-GT references inside that LAMBDA, not surrounding
Mint code or pkverify. Do not turn it into a separate LUMP, infer capability
provisioning or treat single-slot access as proof of atomicity or fault safety.

Mint creates a passkey-GT and shares it as permitted by the design structure,
TBD as a list of approved GTs.

**Why:** The user supplied this authority model instead of selecting the proposed
IDE-only versus explicitly authorized CM-caller alternatives.

**How to apply:** Preserve Mint's creation/sharing responsibility. Genesis owns
definition and approval of the Phase 1 GT list and permitted sharing structure,
as explicitly clarified by the user. Mint enforces that policy rather than
choosing approved recipients. Do not invent list entries or
issuance/bootstrap/onward-sharing rules. Do not equate
passkey possession with NSRW-GT access or silently settle pkverify's proof ABI.

pkverify requires a passkey-GT plus a separate 128-bit proof; Mint creates the
proof when it forges the PassKey.

**Why:** The user explicitly retained the two-part requirement and specified
Mint as the proof creator at forging time.

**How to apply:** Require both, hard-fault on missing/invalid proof, and never
substitute GT equality alone. Generation mechanism, protected storage, transfer,
verification ABI and concrete revocation mechanics still require explicit
decisions. The user subsequently approved reusing the GT/proof pair until
revoked: successful use does not consume it, and every operation still checks
current credential validity and authorization. This is not one-time-use replay
protection.

PassKey revocation invalidates only the credential's GT/proof pair, not object
GTs previously issued under its authority. Those GTs retain their own validity
and separately authorized revocation rules.

**Why:** The user explicitly chose PassKey-only revocation rather than
cascading invalidation of previously issued object GTs.

**How to apply:** Reject revoked credentials without inventing descendant
revocation; retain independent object checks. Revocation mechanics and
in-flight timing are not settled by this scope choice.

Only an explicitly Genesis-authorized revoker may revoke a PassKey pair;
possession alone grants no revocation authority.

**Why:** The user rejected automatic holder self-revocation in favor of
explicit Genesis authorization.

**How to apply:** Distinguish use authority from revocation authority and
hard-fault unauthorized revocation attempts. Do not invent revoker identities
or a storage/ABI mechanism from this policy choice.

Keep the requested CLOOMC review drafts deliberately unbuildable at unresolved
contract boundaries rather than supplying accepting placeholder methods.

**Why:** The user requested source before completing the guided contracts;
drafting permission must not silently become operational admission.

**How to apply:** Use explicit unresolved branch targets, mark proposed ABIs,
and keep drafts out of the live catalog. Replace blockers only with settled
mechanisms; do not treat partial compiler output as a usable LUMP.

PassKey validation must precede EXACT: NULL/NULL and equal invalid credentials
must never authorize.

**Why:** The user explicitly challenged the example's NULL-equality hole and
requires the verifier to reject it, not merely compare equal bits.

**How to apply:** Validate both GTs and active trusted Mint issuance, require
complete proof presence without zero defaults, and preserve bindings through
use. Never accept caller-controlled expected state or claim bit equality proves
validity. Keep explicit negative cases in acceptance requirements.

Separate deliberate NULL testing from EXACT equality.

**Why:** The user agreed a dedicated TPERM NULL test is worth adding after
proposing that EXACT hard-fault on either NULL operand.

**How to apply:** TPERM NULL tests architectural NULL type (including nonzero
NULL encodings), sets Z=1 for NULL and Z=0 otherwise, without faulting or changing
the GT. The user approved the full NULL-test flags: Z=is-NULL, N=not-NULL,
C=0, V=0. Pair with NULL-before-equality hard faults for EXACT.
The user approved complete condition skip: false-condition TPERM performs no
operand checks, raises no TPERM fault, and preserves flags/capabilities,
including NULL/EXACT. Independent fetch/watchdog faults remain separate.
The user approved EXACT-on-NULL faulting before flags/operands change, with
the captured location attributed to EXACT itself rather than later recovery.
The user approved preset 15 (0x0F) for plain TPERM NULL, with the opcode
unchanged. The user selected plain NULL only: instruction encoding 31 (0x1F)
remains reserved, rejected by assembly and faulting when executed (not when
condition-skipped). The GT operand's B bit is irrelevant to the NULL-type test;
do not confuse that with ignoring the instruction modifier. Existing reserved
encoding behavior must be reconciled and verified before use.

No GC in Phase 1. The PP250 garbage-to-NULL suggestion is withdrawn.

**Why:** After further research the user explicitly withdrew the comparison
and excluded GC from Phase 1.

**How to apply:** Do not infer automatic stale/garbage-GT nulling or a Phase 1
GC path. In Phase 2, hardware may invert G only with the system GC setting
enabled; the setting's location and how it is set remain open. Preserve the
separate agreed TPERM NULL/EXACT rules. This does not settle lazy loading.

Phase 1 requires used/free allocation tracking per LUMP size class.

**Why:** The user identified the need for size-specific pools after distinguishing
slot/version combinations from actual memory available for Mint creation.

**How to apply:** Keep memory-block availability separate from Namespace slots
and generations. This is explicit management, not GC; pool ownership, release,
reuse and sizing remain open. Do not infer splitting/coalescing, generation
wrap or RESIDENT reclamation. Budget pool bookkeeping within Phase 1 memory.

Pool release increments the Namespace-entry version in software without wrap.
Ordinary issued versions are 0–510; 511 means permanently retired.

**Why:** The user corrected the earlier inclusive usable range, confirming that
510→511 destroys and permanently retires the slot.

**How to apply:** Allow authorized Destroy at 510 to advance to 511. Never
issue ordinary GTs at 511, reuse retired slots, reset or wrap their versions.
Hardware never increments. Memory reclamation and target eligibility remain
separate. The user reconciled boot-pair generation by excluding 511 from both
independently chosen halves: each uses 0–510, yielding 261,121 packed pairs.

Reallocation uses the Namespace slot's retained release version, without a
second increment.

**Why:** The user explicitly approved retaining and reusing the release version.

**How to apply:** Keep the version with the slot, not the memory block, and never
reset it when clearing a free slot. Only retained versions 1–510 may be
allocated; retained 511 means permanent retirement.

The first allocation into a genuinely never-used Mint slot uses version 0.

**Why:** The user explicitly approved initial version 0, distinct from retained
versions on freed slots.

**How to apply:** Preserve existing/freed-slot history; empty alone does not
prove never-used. Version 0 is not NULL type. Do not reset versions or introduce
wrap; the mechanism establishing never-used status remains to be specified.

Inspect F/G via authorized Namespace reads and BFEXT; setting GT B=true, if
needed, belongs to a privileged function, not a set-B instruction.

**Why:** The user approved the existing-instruction F/G approach and explicitly
required privilege for setting B.

**How to apply:** No new TPERM F/G presets or Phase 1 GC. Keep Mint reads within
the same-scope single-slot LAMBDA. Do not invent the set-B function's authority
or ABI, approve TESTB by implication, or change the existing clear-B modifier.

Mint's single-slot update must be exclusive and non-yielding, with verification
and preparation finished before the first table write.

**Why:** The user approved the proposed update boundary before GT publication.

**How to apply:** No CALL, CHANGE, SWITCH or yield during writes; exclude other
writers and prevent readers from using partial entries. Confirm all writes
before publishing the GT. Faults hard-fault without rollback; no watchdog/reset
exemption. Verify actual exclusion and interruption containment, not just order.

Direct replacement's slot/version policy is a software issue, TBD.

**Why:** The user declined to select the proposed same-slot/version-plus-one
replacement rule, explicitly classifying it as software work to be determined.

**How to apply:** Do not treat that proposal as approved or infer it from the
separately approved pool-release/reallocation rules. Preserve those prior rules.

Phase 1 acceptance for TPERM NULL/EXACT, HARDFAULT diagnostics and exclusive
Mint publication requires simulator, RTL and exact-build physical FPGA evidence,
with Genesis override authority.

**Why:** The user approved the proposed three-layer evidence requirement and
explicitly added “with Genesis override.”

**How to apply:** Keep exercised overrides distinguishable from passed tests;
report missing/failed/unobservable evidence honestly. Authority to override
is not an exercised blanket waiver or authorization to build/upload/flash.

Automatic IDE-assisted lazy loading is deferred to Phase 2. Phase 1 uses
explicit IDE-controlled loading before execution. Working Mint/pkverify/nstab
and the alternative validated service-reload delivery path remain required
as previously scoped; the deferral does not permit resident replacement.

**Why:** The user selected deferral rather than requiring execution-triggered
loading and continuation in Phase 1.

**How to apply:** Keep automatic lazy-load lifecycle acceptance out of Phase 1,
while retaining explicit-load admission checks and service-delivery evidence.
This scope decision alone does not authorize removing existing runtime code.

Phase 1 Mint supports application Abstractions, Threads, LS C-list objects and
RW data objects within an existing Namespace, with explicit Destroy required.
MMIO objects are excluded from Mint scope, not from the platform's existing
hardware I/O. Creating Namespace LUMPs through Mint is deferred to Phase 2;
PassKey forging remains required.

**Why:** After selecting Abstractions and Threads, the user corrected the
incomplete list: “No MMIO but LS c-list and RW data are required to gether
with explicite destroy”.

**How to apply:** Preserve replacement restrictions and unresolved eligibility
mechanics. Type support is not permission to replace RESIDENT LUMPs or active
Threads, and it does not settle the direct-replacement version policy.
Keep LS and RW as the respective object permissions. Destroy is not GC or
PassKey-only revocation; preserve approved pool-release version rules while
leaving its authority, target eligibility and safe reclamation mechanics open.

Every supported Mint Create, authorized Replace and explicit Destroy case
requires a valid, appropriately authorized PassKey GT plus its 128-bit proof,
including LS C-list and RW data objects.

**Why:** The user explicitly clarified “A passkey is needed for each case”
after adding LS C-list objects, RW data and Destroy to the required scope.

**How to apply:** Validate both credential state and authority for the requested
operation/target; hard-fault failures before protected changes. Do not infer
distinct credentials per type, a bootstrap bypass or new proof checks for
ordinary ISA LS/RW accesses.

Authorized Destroy may invalidate outstanding GTs without locating their
copies or proving no references remain. Subsequent stale accesses must fault,
including after slot reuse.

**Why:** The user selected invalidation rather than a no-outstanding-GTs
precondition for Destroy.

**How to apply:** Preserve software increment-before-free, no wrap, permanent
retirement at 511, and retained usable slot versions. Do not infer
permission to destroy active/protected objects or skip safe reclamation
and interruption safeguards.

Destroy must refuse RESIDENT objects, the active Thread, and objects supplying
currently executing code or the active C-list, even with valid authorized
PassKey credentials. Hard-fault before target-version changes or target-memory
modification/reclamation.

**Why:** The user explicitly approved these safety exclusions separately from
allowing invalidation of outstanding unused GT copies.

**How to apply:** Enforce target eligibility independently of credential
validity. Do not turn this into a ban on all outstanding GTs or assume that
the active-use detection mechanism has already been specified.

Reclaimed object memory must be zeroed across the entire block before another
object can use it, including unused capacity.

**Why:** The user explicitly approved full-block zeroing before reuse to prevent
old data or C-list contents from passing to the next object.

**How to apply:** Keep clearing during Destroy versus allocation, the mechanism
and interruption handling as software TBD. Incomplete clearing must not permit
reuse. Preserve Destroy exclusions and slot-version rules; documentation
approval is not implementation or hardware authorization.

Replace must reject the active Thread and objects supplying currently executing
code or the active C-list, even with valid operation-authorized credentials.
Hard-fault before changing the target Namespace entry or target memory.

**Why:** The user explicitly extended active-use exclusions to Replace, in
addition to the existing RESIDENT replacement prohibition.

**How to apply:** Keep active-use detection and direct replacement's slot/version
policy as software TBD. Do not import Destroy's version/invalidation semantics
into Replace or treat this documentation approval as implementation evidence.

Initial PassKey pairs are created by Mint through a separate Genesis-authorized
setup procedure for explicitly approved recipients and permissions, never an
unauthenticated first-caller shortcut.

**Why:** The user approved a separate initial-issuance authority to avoid the
circular dependency on an already-issued PassKey.

**How to apply:** Ordinary Create, Replace and Destroy retain PassKey checks.
Keep setup mechanics, authorization representation and protected delivery
software TBD; do not infer NSRW-GT delegation or unrestricted later issuance.

Onward sharing of a PassKey GT/proof pair requires explicit Genesis
authorization; possession alone grants no delegation rights. Unauthorized
attempts must hard-fault.

**Why:** The user approved the authorization restriction and explicitly added
“Hard Fault when attempted”.

**How to apply:** Preserve the hard-fault requirement. The user corrected blanket
detection-TBD wording: “Save GT detects Abstract Passkeys”. SAVE is the identified
GT-side detection point. Keep Genesis-authorized sharing representation,
recipient identification and separate proof protection/transfer TBD. Do not
equate GT detection with arbitrary proof-byte-copy detection or claim physical
conformance without evidence.

The Abstract PassKey bit format remains an unapproved draft. An Owner is an
abstraction hierarchy with an A-GT-id, proposed as four bits for Phase 1 in
[30:27]. Retain B as Bind; [24:0] is Owner-defined, not a required generation/ID
split. Four is the field width, not numeric Owner ID 4.

**Why:** The user explicitly declined format approval and corrected the proposed
`perm=000, dom=1` interpretation, then clarified the Owner as an abstraction
hierarchy with its own A-GT-id and requested B remain Bind.

**How to apply:** Do not reserve `0x0E000000` as a universal PassKey prefix or
assume those four bits identify the subtype. Owner-ID allocation, reservations,
scope and reuse remain unresolved; do not assume all 16 encodings are usable.
Preserve SAVE detection, separate proof and Genesis sharing
requirements without claiming their exact encoding has been approved.

Software cannot block the Phase 1 bitstream. The Abstract PassKey Owner-ID
and Owner-defined payload format are software issues, not bitstream gates.

**Why:** The user explicitly corrected the review scope: “This is a software
issue and software cannot block the Phase 1 bitstream”.

**How to apply:** Keep software delivery and acceptance separate from hardware
readiness. Do not require software-contract closure, service completion or
reload-path validation before proceeding with bitstream review. Preserve hardware
ISA/conformance requirements and do not interpret this as build/flash permission.

Phase 1 fault-code assignments are approved: THREAD_CONTEXT=0x1D,
THREAD_PERMISSIONS=0x1E and WATCHDOG=0x1F, within the existing five-bit field.

**Why:** The user explicitly approved all three proposed hardware assignments.

**How to apply:** Do not reopen their numeric allocation or confuse them with
instruction opcodes/TPERM operands. Additional trigger conditions and precedence
were not selected by this approval; implementation and exact-build evidence
remain separate from the documentation decision.

Watchdog context capture uses the existing validated Thread-save path, never
a separate unrestricted RAM-write bypass. An unsuccessful save remains failed.

**Why:** The user explicitly approved retaining Thread-save validation for
watchdog capture.

**How to apply:** Do not reopen capture authority or permit validation bypass
to obtain diagnostics. Preserve existing save-first recovery and CR13 rules;
implementation and hardware evidence remain outstanding.

At watchdog expiry, latch the fault immediately and stop new program writes.
Already-accepted writes finish within a verified hardware bound before recovery
uses memory; validated recovery Thread-save writes are separate.

**Why:** The user approved bounded completion of accepted writes without
delaying fault latching or granting extra program execution time.

**How to apply:** Do not complete unaccepted writes from a multi-write operation
or promise rollback. Establish the acceptance/completion boundary and exact bound
with hardware evidence; reset or elapsed time alone does not prove completion.

When an instruction fault and watchdog expiry occur on the same clock edge,
report the instruction fault, while retaining immediate stopping and watchdog
write containment.

**Why:** The user explicitly chose instruction-fault reporting in this tie.

**How to apply:** Do not confuse reporting priority with continued execution,
deadline-equal transfer renewal, a general fault-priority order, or permission
to replace an earlier latched fault. Hardware conformance still needs evidence.

Failure of the supplied Thread GT's mandatory no-permissions check reports
THREAD_PERMISSIONS (0x1E) as a hard fault.

**Why:** The user explicitly approved this mapping after approving the numeric
fault-code allocation; rejection itself was already required.

**How to apply:** Treat this as a separate operand check from Thread-context
validation, which the user subsequently mapped uniformly to THREAD_CONTEXT
(0x1D). Do not infer priority for simultaneous failures or weaken validation.
Implementation evidence remains separate.

All Thread-context validation failures report THREAD_CONTEXT (0x1D), not only
structural failures without a more-specific code.

**Why:** The user selected the broad context mapping, then explicitly retained
THREAD_PERMISSIONS (0x1E) for the separate supplied-Thread-GT permission check.

**How to apply:** Preserve every underlying check but report 0x1D within context
validation. Do not remap ordinary instruction faults outside that validation,
change validation order, or infer a priority for distinct simultaneous failures.

Incoming Thread activation requires no full C-List pre-scan. Runtime mLoad
checks apply; CHANGE checks each GT on its CRn load through mLoad.

**Why:** The user selected structure/resume-authority validation with other
entries checked on use and explicitly specified mLoad for CHANGE CRn loads.

**How to apply:** Do not restore unchecked CR-held GTs or scan every unused
C-List row. Preserve structural/resume checks and applicable mLoad NULL/Abstract
semantics. Simulator pre-scan behavior is not a hardware requirement.

Never propose multiword instructions for this review. Indexed CALL must reclaim
zero/fixed fields within one 32-bit word. Genesis approved the revised indexed
C-list CALL layout and subsequent direct-CALL runtime-method extension for
Phase 1; the previously recorded direct-method encoding gap is resolved.

**Why:** The user explicitly rejected the multiword alternative and requested
a better single-word encoding using the existing unused fields, then explicitly
approved the resulting proposal and then its single-word direct-CALL extension
for Phase 1.

**How to apply:** Keep IDX1 as historical evidence, not an option to revive.
Distinguish approved encoding from implemented/verified hardware. Do not reopen
its allocation or silently reinterpret old indexed binaries. Preserve the
direct-immediate form alongside both new forms; no implementation or migration
was authorized.

Phase 1 DREAD/DWRITE adopts the common LOAD/SAVE signed-offset operand layout,
including the ±1023 immediate range; larger effective offsets can come from DRs.

**Why:** The user explicitly approved the common layout after being told it
replaces the old 14-bit immediate-only range.

**How to apply:** Do not preserve the old immediate-mode meaning of bit 14 or
silently reinterpret old binaries. Keep checked arithmetic and access validation;
encoding approval is not implementation, migration or hardware-test approval.

Phase 1 BRANCH is single-word with a DR index and separate sign plus 18-bit
magnitude, relative to the address of the BRANCH itself.

**Why:** The user approved reclaiming both unused register fields to support
runtime indexing and a larger relative offset in one word.

**How to apply:** A negative displacement is valid; reject invalid target
addresses, not backward branches. Do not wrap arithmetic, retain the old
signed-15-bit encoding as current, or silently reinterpret saved binaries.
