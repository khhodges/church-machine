# Minimal Mint machine interfaces — proposal for review

**Status: APPROVED FOR ISOLATED SIMULATOR IMPLEMENTATION, 2026-10-17.**
The user explicitly approved the protected interfaces and `ide.*` candidate
identities, retaining slots and display labels. Live installation and hardware
changes are excluded. This approval does not establish operational acceptance
or remove any exclusion, authority or containment obligation below. Unspecified
encodings and protected continuation packing remain engineering reconciliation
items; existing instruction meanings must not be silently repurposed.

**Implementation evidence:** the [protected isolated simulator](protected-simulator.md)
now implements the approved path with its own explicitly gated encoding profile.
The user subsequently approved combined L+S in one Inform GT only in this
isolated profile, preserving the single-CR1 return ABI. This explicitly resolves
the Thread-LS/LS result conflict without changing the legacy simulator's rules.
The proposal below is retained as the requirement record; statements describing
the earlier missing implementation are historical. Full-profile candidate
linking, durable custody and hardware acceptance are not supplied by this result.

## Goal and limits

Make a real compiled caller → Mint → PkVerify → private Lambda → returned
capability path possible in the approved Phase 1 simulator. Keep the 17 named
entries, Resident intent, 256-slot table and 32-bit GT format unchanged.
nstab is the existing table's RW view, not a callable helper service.

The first positive Create test must use the credential's approved recipient:
ide.Mint, Owner 0. An arbitrary Alice/test-caller grant must not be fabricated.
Alice/Mallory receive only explicitly authorized capabilities and requests.
The first credential's Replace/Destroy target sets remain empty.

Three changes are necessary. Their complete runtime implementation is pending:

| ID | Proposed change | Architectural consequence |
|---|---|---|
| M1 | Protected Mint admission/context interface | New privileged machine support; not a JavaScript-only source of authority |
| M2 | Linked same-artifact Lambda entry and protected continuation | Resolves the open entry/return contract; changes inconsistent current execution behavior |
| M3 | Private result C-list with narrowly bounded RW alias | New explicit capability-manufacturing grant to trusted Mint |

All three now have isolated implementation approval. Instruction encodings are deliberately not assigned
in this review: an implementation must allocate/check encodings against the
actual assembler/decoder before emitting executable bytes. No published
instruction is silently repurposed, and existing image profiles remain distinct.

## M1 — protected admission and caller/live-use evidence

### Authority

Privileged operations are admitted only for provisioned exact Mint or PkVerify
artifact identities, roles and Namespace configuration. A name, numeric slot,
Owner field, host callStack or browser flag grants no authority.
The trusted initializer installs this role binding; ordinary code cannot edit
it. Changing selected code invalidates the binding until explicit provisioning.

### Operations

These are semantic interface names, not new source instructions or available APIs.

| Operation | Inputs | Machine-owned result and checks |
|---|---|---|
| BEGIN | Mint entry selector and the proposed typed CR inputs from implementation-plan.md: credential CR2, proof CR3, request CR4, target CR7, payload CR8 | Request configuration-wide admission from the unresolved G4 mechanism; once exclusion is established, validate and capture the outer caller's protected E authority; bind current Thread, exact Mint identity, Namespace, operation and immutable inputs |
| VERIFY_CONTEXT | Only the provisioned PkVerify entry reached from the active Mint invocation | Supply authenticated original recipient/configuration to the verifier from the active context, never from its immediate caller or a supplied integer |
| CHECK_LIVE_USE | Frozen target in the active context, used only for an otherwise authorized Replace/Destroy | Validate all live/suspended protected return contexts and active objects; record clearance tied to that exact target and interval |
| FINISH | The active Mint invocation, after confirmed publication and prepared result | Release admission and discard private snapshots/context before ordinary wrapper RETURN; no credential or context survives as a reusable grant |

There is one machine-owned context, tied to the admitted Thread and invocation.
No forgeable integer handle, extra public GT type or general Thread-read
capability is returned. Nested Mint admissions fault; PkVerify consumes the
existing invocation context without replacing the original caller.

Caller capture must happen before nested CALL. BEGIN requires coherent
descriptor/proof/payload snapshots: G4 must exclude competing mutation during
capture, and only the private snapshots may subsequently be checked or consumed.
This specifies a requirement, not an existing coherence mechanism. A matching
hash alone is not a snapshot or caller authentication.

The verifier still performs actual credential/proof/operation checks against
its provisioned registry R view, including all four proof words and fixed-work
XOR/OR comparison. M1 does not replace PkVerify with an unconditional machine
success flag. Public copies of evidence cannot authorize a request.

CHECK_LIVE_USE is non-destructive and covers suspended contexts, not just the
current CR14 or last frame. Corrupt, missing or unbounded evidence faults; it
never means “unused.” It grants no raw frame offsets or arbitrary Thread access.
Ordinary outstanding GTs do not by themselves mean an object is in use.

### Admission interval and failure

All five Mint methods require the same BEGIN/FINISH exclusion interval.
**M1 specifies that interval but cannot enforce it without G4's whole-update
exclusion mechanism. Until G4 is supplied and verified, BEGIN/FINISH is only a
software-visible boundary, not a proven interlock.** A component context test
must not be reported as operational Mint or G4 acceptance. Operational BEGIN
must fault before mutation if the required exclusion cannot be established.

In a simulator, every instruction path and asynchronous
memory/image/Namespace mutator must honor the eventual mechanism;
protecting only a JavaScript function call is insufficient. Trusted same-Thread
Mint/PkVerify execution is allowed; unrelated activation or mutation is not.
Hardware actors are a separate implementation obligation, not qualified here.
Use the existing [producer/observer inventory](namespace-update.md#producerobserver-inventory),
including Amobea activation/capture/restore and live-use checks, rather than a
separate incomplete list. An admission flag or running bit alone proves none
of that exclusion.

Any validation, overlap, replay, stale configuration or permission failure
hard-faults. There is no normal rejection return, queue, retry or rollback.
At fault/reset, discard invocation authority and prohibit resuming the call.
If publication was interrupted, affected state remains non-executable until
trusted reinitialization; clearing a volatile lock cannot certify that state.
Do not finish unaccepted writes or convert a partially written entry into success.

## M2 — private same-artifact Lambda entry and return

Mint CR9 holds an X GT for its own executable object. A trusted link record binds
that exact artifact to one checked dispatcher entry offset within its executable
body. The record does not manufacture a new Namespace descriptor or change the
GT's location, rights or bounds. The effective address is derived using the
actual executable-body base, not a guessed LUMP-header offset.

LAMBDA validates the X GT normally, proves the exact active Mint identity and
matching link record, checks the entry lies within executable bounds, preserves
CR6/C-list scope, and transfers to that entry. It must not merely advance inline
as the current JS implementation does. No caller-controlled label offset is
accepted and no separate service identity is introduced.

At instruction acceptance, capture the next caller instruction address and
original execution authority before changing the PC. Use a protected continuation
record containing that return address, caller identity/bounds, prior stack
position and a Lambda discriminator. The machine must revalidate it on RETURN;
a debug shadow or cached PC alone is not authoritative. No new packing of this
record is approved by this proposal.

Lambda performs one frozen-slot READ/recheck/COMMIT operation per invocation.
Only its audited code references CR10's nstab RW view; clear CR10 before RETURN.
**2026-10-19 clarification:** This remains a required pre-return postcondition,
not permission for RETURN or its host adapter to erase CR10. LAMBDA RETURN
preserves every CR and ignores the CALL keep mask. The proposed interface has
no approved separate erasure mechanism; the protected adapter now stops with
`MINT_CLEANUP_UNBOUND` rather than returning with Namespace authority.
It remains a leaf: no nested CALL, CHANGE, SWITCH or yield during the update.
Ordinary CALL/RETURN behavior and CR13 remain unchanged. Any change to existing
Lambda re-entry semantics requires separate reconciliation rather than being
silently bundled into this Mint proposal.

READ and COMMIT are separate non-nested invocations when verifier work is needed
between them. READ captures all four actual old Namespace words into protected
invocation state, bound to the exact request, Namespace configuration, target
slot and identity. COMMIT must match that binding and compare all four old words,
not merely the generation or a plausible descriptor, before any target write.
It must recheck mutable authority under the still-valid G4 exclusion.

**Exact-word equality is necessary but does not itself detect ABA:** a writer
can change and restore all four words. G4 must prevent intervening writes and
activation changes throughout the READ/verifier/COMMIT interval, including the
gap while Lambda is inactive. If that guarantee is absent, lost or cannot be
established, COMMIT faults before writing; no ordinary reread supplies it.
Do not introduce an unapproved history counter as an implicit substitute.

After writes, confirm all four new words from actual storage, not an echoed
payload. This post-write confirmation is separate from the old-word precondition.

## M3 — private GT result delivery using ordinary LOAD

**Investigation update:** [isolated M3 probes](result-containment.md) demonstrate
spatial checks but not legal provisioning, publication-bound writes or
fault/reset confidentiality. The historical non-CR6 L-only LOAD blocker was
subsequently corrected. The semantics below have isolated implementation
approval, but neither a test-installed CR6 view nor a passing component probe
qualifies them.

**Highest-review privilege:** M3 creates authority bits. It needs explicit
review beyond M1's identity and M2's entry/continuation rules.

Provision a one-result C-list object privately to Mint, plus a separate,
word-bounded RW view of its result row. Keep the C-list framing intact.
The L view and RW view must each satisfy ordinary descriptor/type/bounds checks;
never issue a mixed-domain RW+L token.

Establish and verify containment of the result object, its aliases and all
temporary access capabilities **before the first access**. The caller and
unrelated contexts must be unable to read, execute, map, alias or acquire those
views, including through diagnostics, snapshots and reset handling. Clearing
later is hygiene, not the access-control mechanism.

After confirmed Namespace publication, the trusted Lambda writes the newly
validated GT word through the private RW view. On return, Mint reloads its
private L view and uses ordinary LOAD to materialize the result in CR1.
Clear the result cell and temporary private capabilities after loading; return
with the existing CR1-preserving mask. The caller receives only the intended
object GT, never either private result view or NSRW.

CR1 and the private result cell are cleared before admission. An invalid result
or missing ordinary LOAD authority hard-faults. No DR-to-CR conversion, direct
host register assignment or general set-B bypass is substituted.

If a fault occurs after the GT write but before LOAD or clearing, the existing
containment must still deny access. Reentry/reset must not expose the uncleared
cell or deliver a previous result; trusted reinitialization clears it before
reuse. There is no continuation of the interrupted call. If containment across
a relevant reset/observer path is unproven, that path is not qualified.

### Publication-bound write authority — additional proposed enforcement

A bounded RW alias constrains addresses but **does not constrain write timing
or value**. Auditing trusted Mint code cannot be presented as a machine-enforced
guarantee that the alias cannot write arbitrary GTs. The required acceptance
invariant is:

> A non-NULL object-result GT can be written only to the designated result row's
> GT word, only for the current authorized invocation, and only as delivery of
> its confirmed Create/Replace publication, with the exact authorized GT value.

Recommended mechanism for review: a machine-owned, single-use result-write
permit, bound to the invocation, Namespace/configuration, published slot and
identity, confirmed four-word descriptor, result-cell address and exact result
GT (including permission/B ceilings). Arm it only after confirmed publication
under G4; consume it on the accepted result write. The memory write path must
enforce it for every alias, not only a convenient Mint helper. Reject early,
duplicate, wrong-address, wrong-value, stale and cross-invocation writes.
Fault, reset, FINISH or loss of the publication interval destroys the permit.

Only protected initialization/cleanup may write the canonical zero NULL value
without a publication permit; that does not authorize a different GT or access
to another word. Ordinary LOAD, type, permission and bounds checks still apply.
This is **new proposed machine enforcement**, not an ability supplied by the
existing RW GT. Its implementation/encoding is not approved or proven here.
ForgePassKey's protected delivery remains subject to G5/G6; this object-result
permit does not create an alternative credential-issuance path.

This RW/L alias is a real capability-manufacturing privilege. Restrict it to
the approved Mint code/configuration and audit all writes. Any extra private
Namespace descriptors needed for these views must be explicitly counted in
capacity and GT coverage; do not hide them under the claim of 17 initial entries
or overwrite an approved entry. Exact private placement is a provisioning output,
not permission to relabel public slots.

## First complete acceptance scenario

1. Prepare an isolated approved-layout image and explicit trusted provisioning
   for the exact Mint/PkVerify code, the first credential and private views.
2. Enter Create as its genuinely authorized recipient through compiled execution.
3. BEGIN captures the caller and inputs; real PkVerify checks the frozen request.
4. Allocate a supported RW object in an eligible slot without changing the
   original 17 assignments; initialize it and commit through the private Lambda.
5. LOAD the issued result into CR1, FINISH, and RETURN. The caller writes and
   reads back through that GT; verify actual memory and descriptor state.
6. Repeat and check allocation, generation, bounds and forward progress.
7. In separate negative runs, prove unauthorized/replayed requests, exhaustion,
   overlapping admission and interrupted updates produce the specified faults
   without granting authority. Do not report these expected faults as normal-run
   failures, and never suppress unexpected faults.

A synthetic helper invocation or prefilled result register is not acceptance.
Report exact input/code/image identities and every extra dynamic/private slot.

### Review-driven acceptance controls — not yet executed

| Concern | Required evidence |
|---|---|
| M1/G4 dependency | Context operations alone cannot qualify exclusion; demonstrate every applicable producer/observer is controlled during the complete interval, or reject operational admission before mutation |
| M2 READ/COMMIT | Changed old words, changed request/target and loss of exclusion all reject before writing; a deliberate change-and-restore attempt must be prevented by G4, not accepted on equality |
| M3 containment | Inject faults before/after result write, LOAD and clear; prove the cell and its aliases remain inaccessible to the caller/unrelated contexts across the relevant reset paths |
| M3 write authority | Early, duplicate, wrong-word, wrong-value and previous-invocation writes fail; exactly one confirmed publication permits exactly its authorized result write; cleanup cannot forge authority |

These are required tests, not new passing results. Simulator evidence must be
followed by independent RTL evidence before any hardware claim.

The subsequent [bounded G4 investigation](exclusion-evidence.md) reproduces
intervening writes, ABA and activation despite an inert admission marker.
It tests existing paths, not these proposed interfaces. All four old words can
match again without exclusion; G4 remains open.

## Review disposition

The [Genesis review](../../../attached_assets/Pasted-This-is-the-right-next-document-and-it-s-well-construct_1792259460983.txt)
endorses the proposal's direction and requests the four refinements above.
That review was **not implementation approval**. The later explicit approval
recorded at the top of this document now authorizes isolated implementation.

M1 links to G2 (requester), G3 (all-context live use) and depends on G4
(whole-update exclusion); M2/M3 address the two G1 mechanisms. None of these
gates is closed by revised wording. The M3 permit is a proposed response to the
stronger enforcement invariant, not an authority grant inferred from the review.

## What approval would and would not mean

The subsequent approval permits implementation of these semantics in isolated simulator,
compiler/linker and provisioning paths, with explicit tests for the privileged
boundary. It does not certify existing code, install replacements into the
saved Namespace, activate a live image, publish new ISA encodings without
consistency checks, or authorize hardware builds/programming.

G4 publication exclusion and G5/G6 durable credential custody/provisioning remain
real dependencies. A private test credential is test evidence, not production
custody. This proposal does not close all Mint gates or promise a functioning
service before those dependencies are implemented and verified.

References: [effective contract](service-contract.md),
[existing proposed public ABI](implementation-plan.md),
[source-grounded limitations](context-feasibility.md),
[update exclusion](namespace-update.md).
