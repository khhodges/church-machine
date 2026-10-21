# ide.Mint — Forge_GT_At_Slot contract draft

## Current review entry point — 2026-10-17

The **[Mint Phase 1 review package](reviews/mint-phase1/README.md)** publishes the
complete approved Q01–Q55 record (including all three Q18 answers), effective
service contract, proposed ABI/work packages, security analysis and evidence gates.
Its [supersession index](reviews/mint-phase1/supersessions.md) identifies which
software TBDs and earlier proposals below have been resolved. This is a design
package, not an operational Mint service or authorization to install/program it.

In particular, the PassKey layout/Owner rules are now selected; the canonical
names are **ide.PkVerify** and **ide.NSTab**. The first credential belongs only
to ide.Mint (Owner ID 0, B=0, sequential 25-bit ID), creates four supported types
only in Boot, and has **no Replace or Destroy targets**. Direct replacement is
same-slot/+1 with current-version-510 refusal and a separate block. Reclamation
zeroes the entire old block before free; live return dependencies are protected.
All five methods share admission; Lambda readback checks all four actual words.
**Q54** supplies atomic durable issuance/consumption/counter state, preserving
issued credentials across boot without burn-first loss or resumed calls.

The [active Master ISA](phase-1/01-isa/instruction-set.md) remains hardware
authority. Older “unapproved,” “TBD,” rejection-return and recovery language
below describes its dated record, not an override of the newer selections.
Unresolved mechanisms remain genuine release gates; neither approval nor a
source draft proves runtime security. Historical prose is retained below;
links to moved historical documents have been repaired.

## Historical contract record

Date: 2026-10-11  
Status: **Approved Phase 1 requirements below; unresolved software mechanisms
remain TBD. Not an operational service or implementation approval.**

## Current Phase 1 contract — reconciled 2026-10-14

This section supersedes conflicting prescriptions in the earlier draft retained
below. Authority: [Master ISA](phase-1/01-isa/instruction-set.md#approved-phase-1-contract) and
[Genesis resolution log](archive/phase-1-expanded-collection/REVIEW-2026-10-14.md). The
[service draft](archive/phase-1-expanded-collection/MINT-FIRST-DRAFT.md) and
[CLOOMC review sources](archive/phase-1-expanded-collection/source-drafts/README.md) expose remaining TBDs,
not executable implementations.

- Provide working ide.Mint (NS[9], E), nstab (NS[14], RW) and pkverify
  (NS[15], E). Slot assignment does not itself issue capabilities. The agent
  owns delivery. Software cannot block the Phase 1 bitstream: service completion,
  unresolved software contracts and reload-path validation are not bitstream
  gates. Services and a validated delivery path remain software-release
  requirements, separate from hardware readiness.
- Automatic IDE-assisted lazy loading is deferred to Phase 2. Phase 1 uses
  explicit IDE-controlled loading before execution. This does not remove the
  validated service-reload delivery option or authorize automatic
  execution-triggered installation/continuation as a Phase 1 requirement.
- Mint supports create and authorized replacement, **never replacement of a
  RESIDENT LUMP**, including Mint/pkverify if resident. Any resident update path
  requires its own contract. Growth space does not waive this exclusion.
- **Replace active-use exclusions — approved:** Reject the active Thread and
  objects supplying currently executing code or the active C-list, even with
  valid operation-authorized credentials. Hard-fault before changing the target
  Namespace entry (including its version) or target memory. Retain the RESIDENT
  exclusion. Active-use detection and direct replacement's slot/version policy
  remain software TBD.
- **Object scope — approved:** Support application Abstractions, Threads,
  **LS C-list objects and RW data objects** within an existing Namespace in
  Phase 1. LS and RW describe the respective object permissions, not a combined
  LS/RW grant. **MMIO objects are excluded from Phase 1 Mint scope.**
  Defer creating Namespace LUMPs through Mint to Phase 2.
  PassKey forging remains required. This type scope
  does not waive replacement restrictions or authorize replacing an active
   Thread; replacement eligibility and safeguards remain separate requirements.
- **Explicit Destroy — required:** Phase 1 must provide explicit authorized
  object destruction, not automatic garbage collection or merely PassKey
  revocation. For pool release, preserve the approved software-managed
  increment-before-free, no-wrap and retained-slot-version rules. Destroy
  detailed authorization, remaining per-type eligibility, active-use detection,
  memory reclamation, interruption behavior and ABI remain to be defined.
- **Destroy exclusions — approved:** Reject RESIDENT objects, the active
  Thread, and objects supplying the currently executing code or active C-list.
  Hard-fault before changing the target slot version or modifying/reclaiming
  target memory, even with a valid operation-authorized PassKey. This is an
  eligibility requirement, not a selected active-use detection mechanism.
- **Reclaimed memory — approved:** Zero the entire reclaimed block, including
  unused capacity, before another object can use it. Whether Destroy or
  allocation performs clearing, its mechanism and interruption handling remain
  software TBD; incomplete clearing must not permit reuse. Preserve Destroy
  exclusions and slot-version rules.
- **Outstanding GTs on Destroy — approved:** An authorized Destroy may
  invalidate outstanding GTs under the approved software slot-version release
  rules, without finding/removing every copy or proving none remain.
  Subsequent stale-GT accesses must fault. Increment before freeing, never
  wrap; 510→511 destroys and permanently retires the slot. Reuse only retained
  versions 1–510, never 511. This does not waive active/protected-target eligibility checks
  or resolve safe reclamation and interrupted-write mechanics.
- **PassKey required in each case — approved:** Each supported Mint request
  requires a valid, appropriately authorized PassKey GT and its separate
  128-bit proof. This includes Create, authorized Replace and explicit Destroy
  for application Abstractions, Threads, LS C-list objects and RW data objects.
  Possession does not authorize every operation or target; validate the
  requested case against Genesis-approved authority. Missing, invalid, revoked
  or insufficiently authorized credentials hard-fault before protected changes.
  This does not assign a distinct credential per type or settle bootstrap
  mechanics, and does not add proof checks to ordinary ISA LS/RW accesses.
- **Only a same-scope LAMBDA references NSRW-GT**, one Namespace slot at a time,
  including reads and commit rechecks. No separate LAMBDA service LUMP or
  automatic delegation to callers/pkverify.
- Finish verification/preparation before the first table write. Exclude other
  writers and prevent readers using partial entries. No CALL, CHANGE, SWITCH
  or yield during writes; publish the resulting GT only after confirmed writes.
  Exact exclusion, confirmation and interrupted-write containment are TBD,
  not proved by four DWRITEs. No watchdog/reset exemption or promised rollback.
- All faults hard-fault, not recoverable rejection returns. Use the approved
  HARDFAULT/fault-map direction in the master; exact lowering remains unverified.
- **Phase 1 PkVerify exception:** `ide.PkVerify.Verify` unconditionally returns
  APPROVED (`DR1 = 1`), including for NULL or invalid credentials/proofs.
  It does not read proof memory or perform allowance accounting. Other DRs,
  including Mint's requested size in DR6, are preserved; RETURN keeps CR2/CR3.
  This is an explicit Phase 1 stub, not evidence of real authentication.
  The credential-verification requirements below apply to the real verifier.
- Mint forges the PassKey GT **and separate 128-bit proof at forging time**.
  Genesis defines/approves the permitted sharing structure and approved-GT list.
  Mint enforces it rather than choosing recipients. pkverify requires both GT
  and proof. Validate non-NULL, valid, actively issued/bound reference state,
  independent of caller-controlled expected values; no missing-state zero
  defaults. EXACT alone does not authenticate.
- **Credential lifetime — approved:** The PassKey GT and separate proof are
  reusable until revoked. Successful use does not consume the pair or require
  reissuance. Every operation still requires current credential validation
  and operation authorization; reuse is not one-time-use replay protection.
  Revoked or otherwise invalid credentials hard-fault.
- **Revocation scope — approved:** Revoke the PassKey GT/proof pair only.
  Do not automatically invalidate object GTs previously issued under its
  authority. Those GTs retain their own validity checks and separately
  authorized revocation rules; no cascading revocation is implied.
- **Onward sharing — approved:** A holder needs explicit Genesis authorization
  to share its GT/proof pair onward; possession alone grants no delegation
  rights. Unauthorized onward-sharing attempts must hard-fault. **SAVE GT
  detects Abstract PassKeys**, providing the identified GT-side detection point.
  Genesis-authorized sharing representation, recipient identification and
  separate proof protection/transfer remain TBD. Do not equate SAVE's GT check
  with detection of arbitrary proof-byte copying or verified simulator/RTL/FPGA
  conformance.
- **Revocation authority — approved:** Only an explicitly Genesis-authorized
  revoker may revoke a PassKey GT/proof pair. Possession of the pair alone
  does not grant revocation authority. Unauthorized revocation attempts
  hard-fault under the existing authorization rule.
- **Format review — unapproved draft:** Bits 30:27 are free for reuse as defined
  by the Owner, not fixed permission/domain values. Do not adopt the proposed
  `0x0E000000` prefix or Church/zero-permission subtype marker. Other proposed
  field assignments remain unapproved. The Owner is an abstraction hierarchy
  with an A-GT-id, proposed as four bits for Phase 1 at [30:27]; retain B as Bind
  and [24:0] as Owner-defined, not a required generation/ID split. See the
   [format draft](archive/phase-1-expanded-collection/MINT-CODE-DRAFT.md#abstract-passkey-format--unapproved-draft).
- **Initial PassKey issuance — approved:** A separate Genesis-authorized setup
  procedure has Mint create the initial GT/separate-128-bit-proof pairs for
  explicitly approved recipients and permissions. No unauthenticated first-caller
  shortcut. Ordinary Create, Replace and Destroy still require valid,
  operation/target-authorized PassKeys. Setup mechanics, authorization
  representation and protected delivery remain software TBD.
- Proof generation, protected storage/transfer, ABI, concrete revocation
  mechanics, list representation and bootstrap implementation remain software TBD.
- Track used/free blocks per LUMP size class, separately from slots/generations.
  **No GC in Phase 1.** G-setting location/control is Phase 2 TBD.
- Software versions are 9 bits. A genuinely never-used slot starts at 0.
  Ordinary issued versions are 0–510; 511 is reserved for permanent retirement.
  Release increments before freeing; 510→511 destroys and retires the slot.
  Never wrap, reset or reallocate a retired slot. Retain usable versions with
  the slot and reuse without another increment. Memory reclamation remains
  separate from slot retirement. Boot-pair generation also excludes 511,
  choosing each half independently from 0–510.
  **Direct replacement's slot/version policy is software
  TBD**; do not infer same-slot/+1 approval. Release authority, bookkeeping and
  in-use safeguards still need definition.
- Use ascending 256-slot starting geometry and **half the FPGA memory**.
  Mint/pkverify planning guesses are 2/1 KiB, not measured reservations; 100%
  headroom is unapproved. Budget pool/proof storage and complete payloads.
- T is networked object identity; without networking T===GT. IDE virtualGTs
  may identify non-memory objects beyond table capacity. Representation/binding
  remains TBD; do not substitute the old frozen/content-hash split.
- Require simulator, RTL and exact-build physical FPGA evidence for TPERM
  NULL/EXACT, HARDFAULT attribution and exclusive update/publication, **with
  Genesis override**. An override is not a passed test or implicit hardware
  authorization.

## Earlier contract proposal — superseded where inconsistent above

The following dated draft preserves design rationale and source observations.
Its create-only preference, bootstrap T restriction, ordinary rejection returns,
unqualified resident scope and unresolved create/replace language are not current
Phase 1 requirements. Unsettled ABI/atomicity proposals are not adopted by retention.

This document specifies requirements and records unresolved decisions. It does
not change the saved LUMP, Namespace, simulator, hardware or release selection.
“Non-operational pending contract” is a design/release restriction here, not a
claim that a new runtime interlock has been installed.

Bootstrap correction: for the frozen resident base on one machine, T is the
literal full runtime GT (CM_LUMP_SPECIFICATION.md, “Bootstrap Identifier”).
The legacy writer now places that GT in W3 in both profiles; this narrow code
correction does not approve operational Mint, resolve the gates below, or change
saved LUMPs. Phase 1 needs the bounded R1–R3 rule, not a full transaction engine.

## 1. Scope and authority

The reviewed method takes a passkey GT in CR2, a proposed base in DR3 and a
proposed slot in DR4, and proposes returning GT bits in DR1. Its declared
`pkref` and `nstab` capabilities are privileged implementation inputs, not
caller-granted authority.

**Requirement:** authentication and operation authorization are distinct.
Matching the trusted token and proof must not authorize arbitrary slot,
allocation, type, or permission changes.

Existing constraints:

- Protected operations require an object-scoped GT and an independent 128-bit
  proof. EXACT compares token bits; it does not verify that proof.
- Normal ISA type, permission and bounds checks remain mandatory.
- Method-specific authorization must not create a new global permission rule
  for ordinary DWRITE or a persisted POLA layer for dynamic state.
- No fourth resident LUMP or replacement of the existing Mint is authorized.

## 2. Evidence and limits

Checked against the current source and specification:

| Evidence | What it establishes | What it does not establish |
|---|---|---|
| `docs/CM_LUMP_SPECIFICATION.md`, Namespace entry representation | Resident Inform W0 = location, W1 = authority, W2 = integrity32, W3 = content token T | T or integrity32 as cryptographic authentication |
| Same specification, Heap convention | CR5 is the Thread Heap GT, paired with DR5 | A spare register for this method |
| `hardware/core.py`, Mint NS write states | Separate write states exist for the four words; W3 now uses the full resulting bootstrap GT | Atomic replacement, portable content identity, or a callable software ABI |
| `hardware/church_outform.py`, ChurchOutformFSM | Outform ingress is deliberately fault-closed because trusted authenticated identity is unavailable | An available authenticated commit service for ide.Mint |

These paths are evidence to investigate, not approved mechanisms to invoke.
In particular, a four-state writer is neither proof of atomicity nor proof of
its absence: visibility, exclusion, interruption and recovery must be examined.

The subsequent [hardware atomicity review](ide-mint-hardware-atomicity-review.md)
finds local CPU busy exclusion but no acknowledged, interruption-safe transaction
mechanism. Ordinary Outform ingress remains fault-closed. The legacy writer must
not be treated as the resolved commit mechanism for this draft.

## 3. Authentication contract — mechanism unresolved

Before protected work, verify both the supplied object-scoped GT and its
independent proof against trusted private state.

The design must specify:

1. Issuance, private storage and isolation of the expected proof.
2. Transfer ABI and protection against exposure in registers, traces and dumps.
3. Verification, failure handling and timing behavior.
4. Revocation of the entire GT/proof pair.
5. Whether proof is reusable or request-bound; replay rules if request-bound.
6. Binding to the intended object and authenticated calling context. Possession
   of a credential is not by itself proof of a particular human's identity.

No proof registers, cryptographic primitive or verifier entry point are assigned
by this draft. Missing verification means rejection, not token-only fallback.

## 4. Operation authorization — policy unresolved

Authorize a frozen request containing at least the destination Namespace/slot,
create-versus-replace operation, expected destination state, backing allocation,
object identity/type, requested rights and resulting bounds.

The policy must establish who may:

- Create in an empty slot, replace an occupied slot, or access protected slots.
- Allocate the proposed memory and use it for this object.
- Issue the requested capability type and permissions.
- Replace a live object with outstanding capabilities.

Numeric base and slot arguments are requests, not ownership evidence. The design
must provide authoritative allocation and identity inputs and their validation.
Do not hard-code protected-slot membership from historical catalog positions.

All fields and authorization evidence must be revalidated at the commit
boundary or covered by a mechanism that prevents them changing. A sequence field
alone is insufficient if its reuse can admit an ABA race.

## 5. Validation and representation

Before commit, validate slot bounds, alignment, allocation extent/overlap,
object framing/type, executable bounds where applicable, artifact identity and
the correct generation on reuse. Which checks apply to each supported object
type must be specified; this method must reject unsupported types explicitly.

For a resident Inform entry use the four-word representation in section 2:

- W3 is T: for the frozen resident single-machine bootstrap, the exact full
  resulting runtime GT, not zero, a projected SELF, or a textual dot-name.
- A separate content-hash input is not required in that bootstrap scope.
  Dynamic rebind/re-sequencing or a machine boundary activates the deferred
  portable identity rules; cooperative scheduling alone does not extend scope.
- T is a cache/index, not ownership, revocation or authentication.
- integrity32 is local corruption detection, not cryptographic identity proof.
- Full trusted identity remains separate from these compact fields.

Freeze exact field packing, address units, hash input bytes and integrity
algorithm/test vectors before implementation. Neither absence of a convenient
instruction nor a reference to an Amaranth helper specifies a software path.

The ABI must assign scratch registers and clobbers explicitly. Do not use CR5
for `nstab` without a reviewed preservation strategy compatible with the Heap
convention. Do not select another CR merely because it looks unused.

DR1 is a data register: returning raw GT bits does not itself populate a
capability register. Specify the authorized consumption/materialization path.

## 6. Commit and interruption — mechanism unresolved

Phase 1 narrowing: a single non-suspending method body (no CALL/yield) excludes
other scheduled Threads. R1 requires external-writer exclusion or accepted-write
acknowledgements; R2 requires bounded reset/fault drain or proven recovery; R3
publishes the GT only after all writes reached RAM and the reset boundary passed.
Preferred form is exclusion plus bounded drain, create-only, subject to exact
hardware bounds and the still-open create/replace decision. No general-purpose
transaction engine is required for this scope. A marker alone cannot reconstruct
overwritten old words. The broader obligations below are not a mandate to build
a full transaction engine for Phase 1.

Required ordering:

1. Initialize failure outputs.
2. Authenticate and authorize the frozen request.
3. Validate and privately prepare the complete entry.
4. Recheck destination/evidence freshness under commit exclusion.
5. Commit using an explicitly specified mechanism.
6. Publish the resulting GT and success status only after commitment.

Define a single observable commitment point. Readers must see a complete old
entry or complete new entry, never a mixture. This includes concurrent
execution, interrupts, reset and replacement of a live entry. Identify all
observers, lock ownership, recovery behavior and backing-object lifetime.

Four ordinary DWRITEs, a valid-word-last convention, or restoring old words
after a failure do not establish this guarantee.

**Important exit distinction:** rejection before commit can guarantee zero
Namespace write events. An interruption during/after commit is not necessarily
an ordinary rejection. If commitment occurred but the return was lost, recovery
must identify that outcome without blindly retrying or claiming “no change.”
Power-loss guarantees require an explicit durability scope; do not promise RAM
survival or rollback that the machine cannot provide.

## 7. Exit contract scaffold

Status names below are descriptive, not assigned numeric values or registers.
The final ABI must define status transport and the complete preserved/clobbered
CR, DR, NZCV, Thread and stack state.

| Outcome | DR1 | Status | Namespace effect |
|---|---|---|---|
| Method initialized, before validation | 0 | Non-success | None |
| Ordinary authentication/authorization/validation rejection | 0 | Non-secret rejection category | Zero Namespace write events |
| Destination changed before commitment | 0 | Conflict | Zero Namespace write events by this operation |
| Successful return | Exact resulting GT bits | Success | Exactly the authorized committed change |
| Fault/reset before output initialization | Not promised by this method | Architectural fault, not a normal return | Governed by entry/fault contract |
| Interrupted commit or lost return | No successful return may be inferred | Recovery outcome required | Complete old/new state per approved mechanism; never an assumed rollback |

Never leak expected/supplied proof, private reference capabilities or authority
through errors, traces, residual scratch state or return values. Rejection
categories must also avoid revealing protected object existence to unauthenticated
callers. Define cleanup timing and ownership of caller-supplied proof storage.

## 8. Acceptance matrix scaffold

For every ordinary denial: independently check DR1 = 0, zero Namespace write
events, no protected authority/proof exposure, and the approved preserved-state
set. Compare write events attributable to this operation, not unrelated actors.

| Case | Required result/evidence |
|---|---|
| Wrong token, including single-bit changes | Denial invariants |
| Correct token, wrong/missing/revoked proof | Denial invariants |
| Valid credential, forbidden slot or operation | Denial invariants |
| Unauthorized, misaligned, overlapping or out-of-range allocation | Denial invariants |
| Unsupported object type, rights escalation, invalid identity/integrity | Denial invariants |
| Stale destination/generation or changed validation input | Conflict/denial invariants |
| Same slot requested concurrently | Only authorized serialized commits; losing request cannot silently overwrite |
| Interrupt/reset injected at each commit stage | Old/new visibility and recovery requirements; classify pre/post-commit separately |
| Commit succeeds but return is lost | Recovery distinguishes commitment; retry cannot duplicate or replace inadvertently |
| Authorized create | Independent bit-exact four-word entry and GT; exact permitted write-event set |
| Authorized replacement, if supported | Same checks plus generation, outstanding-GT and backing-lifetime rules |
| Returned GT consumption | Approved capability materialization succeeds without extra authority |

Expected words must be calculated independently of the implementation encoder.
Record contract/input hashes, initial state, register effects and intermediate
write events across simulator, RTL and FPGA. Mark unobservable state explicitly,
never as PASS.

## 9. Approval gate

Before implementing or admitting ide.Mint into a release, resolve:
proof protocol, authorization policy, commit/recovery mechanism, representation
vectors, scratch/output ABI, capability isolation and supported object types.
Then implement and run the matrix against the exact candidate bytes.

This draft alone closes none of those mechanism or test gates.
