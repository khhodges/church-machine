# Mint Phase 1 decision record

Status: approved policy transcribed from the supplied guided-Q&A handoff; not implementation or test evidence. Publication date: 2026-10-17. The full questions, selected answers, proposal qualifications and substantive comments below are preserved verbatim. Recommendation labels are part of the recorded answers. No private task access is required to interpret this record.

Read [the effective contract](service-contract.md), [supersessions](supersessions.md), and [source provenance](sources.md) alongside this record. Q18.1–Q18.3 are three distinct answers, not revisions to discard. Q54 supplies the final positive issuance rule. All 57 answer records (Q01–Q55, with three Q18 entries) are included.

## Approved questions and answers

This is the handoff source for the published decision ledger. Preserve both the actual questions/answers and the proposal qualifications below. Q18 was asked three times with different proposals: all three answers are significant. Q54 is the final approved issuance rule. Questions used recommendation labels; acceptance approves the stated scoped proposal, not a claim of implementation or test success.

**Q01 — “Approve this PassKey GT bit layout for Phase 1?”**
Answer: “Approve this layout (recommended)”.
Approved layout: bit 31 B retains Bind semantics; bits 30:27 are a four-bit Owner A-GT-id identifying an abstraction hierarchy; bits 26:25 are `11` Abstract; bits 24:0 are Owner-defined. The independent 128-bit proof is outside the GT. This alone did not assign IDs, reserve values or define PassKey classification.

**Q02 — “Should Genesis alone control Owner-ID assignments?”**
Answer: “Yes—Genesis controls assignments (recommended)”.
Genesis assigns; Mint uses approved assignments and cannot invent or reassign them. Owner ID is identity, not authority by itself.

**Q03 — “Use one shared Owner-ID mapping across the Phase 1 configuration?”**
Answer: “Shared across the configuration (recommended)”.
Same hierarchy has the same ID throughout the configuration; different hierarchies cannot share an ID there. Not a worldwide/network registry.

**Q04 — “Make all 16 Owner-ID values available for Genesis assignment?”**
Answer: “Yes—no reserved Owner IDs (recommended)”.
Values 0–15 are assignable; availability is not authorization. Owner 0 is not architectural NULL because the GT remains Abstract.

**Q05 — “Keep each Owner ID assigned to its original hierarchy for the configuration’s lifetime?”**
Answer: “Yes—no reassignment to another hierarchy (recommended)”.
Assignments survive reset/reboot and revocation; the same hierarchy may receive further credentials under its ID.

**Q06 — “Can an Owner hierarchy issue Abstract GTs other than PassKeys?”**
Answer: “No—all its Abstract GTs are PassKeys”.
Under an assigned Owner ID, that hierarchy’s Abstract GTs are PassKeys; no additional PassKey subtype in the 25-bit payload was selected. Do not silently apply this new interpretation to unrelated historical Abstract encodings, Outform/device paths or portable locks without compatibility/authority analysis. SAVE detection is a requirement, not demonstrated conformance.

**Q07 — “May one PassKey authorize multiple explicitly approved Mint operations?”**
Answer: “Yes—an explicit selection per PassKey (recommended)”.
One credential may authorize an explicit subset of Create/Replace/Destroy, with independent operation checks; no blanket Mint authority.

**Q08 — “Specify allowed object types separately for each authorized Mint operation?”**
Answer: “Yes—type permissions per operation (recommended)”.
Authorization is per operation/type combination, not a cross-product that accidentally broadens rights. Types: application Abstractions, Threads, LS C-list objects, RW data objects.

**Q09 — “Require explicitly approved target objects for Replace and Destroy?”**
Answer: “Yes—explicit targets per operation (recommended)”.
Bind targets to intended objects, not just reusable Namespace slot numbers. Type authorization alone does not authorize every object.

**Q10 — “How many destination Namespaces may one PassKey’s Create permission authorize?”**
Answer: “One explicit Namespace (recommended)”.
Create authority does not follow the caller’s currently active Namespace when it switches.

**Q11 — “Keep each PassKey’s permissions in a protected authorization record outside the GT?”**
Answer: “Yes—protected authorization record (recommended)”.
Mint maintains the trusted record under Genesis authority; the verifier cannot trust caller-supplied expected permissions. This did not yet select proof storage or record layout.

**Q12 — “How should an issued PassKey’s permissions be changed?”**
Answer: “Revoke and issue a replacement (recommended)”.
No in-place permission editing of an issued credential. Revoking a PassKey does not revoke object GTs already issued through it.

**Q13 — “Should a replacement PassKey receive a different GT as well as a fresh proof?”**
Answer: “Different GT and fresh proof (recommended)”.
The previous credential remains revoked; this did not prescribe a generation/ID bit split.

**Q14 — “Compare the complete 128-bit proof without an early exit on a partial mismatch?”**
Answer: “Yes—fixed-work proof comparison (recommended)”.
Compare all 128 bits before deciding proof equality; mismatch hard-faults. This does not assert constant-time behavior of the entire verifier or prevent earlier validity checks.

**Q15 — “Which approach should Mint use to generate the 128-bit proof?”**
Answer: “Trusted cryptographic randomness (recommended)”.
Fresh trusted cryptographic randomness, not GT-, timestamp-, or ordinary-counter-derived proofs. A hardware entropy provider was not established.

**Q16 — “Which randomness source should Phase 1 Mint use?”**
Answer: “IDE-provisioned private randomness pool (recommended)”.
Genesis-authorized IDE setup supplies private one-use randomness before execution; Mint forges the credentials. The IDE is trusted with this secret material. Finite supply, exhaustion hard-faults; protected delivery and persistence need implementation. No on-board RNG or firmware primitive was approved.

**Q17 — “Require a fresh randomness pool after board reset or Mint service reload?”**
Answer: “Preserve the pool with trusted persistent consumption tracking”.
The user rejected the recommended fresh-pool policy. Preserve the pool and trustworthy consumption state; do not treat reset alone as authorization to replace/discard it.

**Q18.1 — “Commit consumption before issuing the proof, accepting a lost entry if issuance is interrupted?”**
Answer: “Use a different persistence rule”.
User comment, verbatim: “Phase 1 only no lost entries”.
Rejected consuming/burning an entry separately before issuance when interruption could lose it. Do not restore that policy as an implementation default.

**Q18.2 — “May an interrupted issuance be explicitly completed after restart using the same reserved GT/proof pair?”**
Answer: “No—use a different Phase 1 rule”.
User comment, verbatim: “Hard boot forgets the past”.
Rejected a pending-issuance recovery/resumption protocol. Q18.3 clarifies that forgetting execution does NOT mean erasing previously issued credentials.

**Q18.3 — “Does each hard boot discard the old pool and require a freshly generated pool?”**
Answer: “No—clarify a different pool rule”.
User comment, verbatim: “Prior pass codes still work after boot at lease for Phase 1”.
Previously issued GT/proof pairs remain valid after hard boot unless revoked. No pool-discard rule was approved. Hard boot forgets execution, not durable credential authority; Q54 later supplies the positive atomic issuance rule.

**Q19 — “Where should Phase 1’s persistent security records be held?”**
Answer: “IDE-managed protected storage (recommended)”.
IDE holds authoritative issued credentials, permission records, revocations and pool-consumption state. Authorized setup restores necessary state before execution. Do not revive revoked credentials or restore stale permissions. Exact protected storage/update/transport mechanisms remain to be established.

**Q20 — “Should pkverify verify locally using a protected board-resident copy of the trusted records?”**
Answer: “Yes—local verification (recommended)”.
Protected board working copy is restored during authorized setup; ordinary proof verification does not require an IDE round trip. Synchronization and non-stale use remain requirements.

**Q21 — “Require IDE persistence and matching board state before reporting issuance or revocation success?”**
Answer: “Yes—confirm both before success (recommended)”.
Credential changes require durable IDE confirmation and matching board state; ordinary verification remains local. This alone did not approve dropped entries, automatic retries or interruption recovery.

**Q22 — “Which abstraction hierarchy should receive the first operational Mint PassKey?”**
Answer: “ide.Mint”.
This chooses the operational recipient for Create/Replace/Destroy, not an unauthenticated initial-setup authority.

**Q23 — “Which operations should ide.Mint’s first operational PassKey authorize?”**
Answer: “Create, Replace, Destroy”.
Operation selection did not grant forging, sharing, revocation or arbitrary target rights. Later Q28/Q29 give no Replace/Destroy targets, so the effective initial credential is Create-only.

**Q24 — “Which object types may ide.Mint’s first PassKey authorize Create for?”**
Answer: application Abstractions, Threads, LS C-list objects, RW data objects (all four).
No Namespace LUMP creation or MMIO creation in Phase 1.

**Q25 — “Which object types may ide.Mint’s first PassKey authorize Replace for?”**
Answer: application Abstractions, Threads, LS C-list objects, RW data objects (all four).
Explicit target authorization and protected-target exclusions still apply; Q28 gives no permitted targets.

**Q26 — “Which object types may ide.Mint’s first PassKey authorize Destroy for?”**
Answer: application Abstractions, Threads, LS C-list objects, RW data objects (all four).
User comment, verbatim: “As long as NOT RESIDENT”.
Existing active-use exclusions remain; Q29 gives no permitted targets.

**Q27 — “Which single Namespace should ide.Mint’s first PassKey authorize Create within?”**
Answer: “Boot”.
Resolve the user-designated Boot Namespace to its explicit authoritative identity during design; do not invent a new canonical Namespace name or silently use whichever CR15/browser selection is current.

**Q28 — “Which specific objects may ide.Mint’s first PassKey authorize Replace for?”**
Answer, verbatim: “None, period”.
A firm empty target grant, not “none initially” awaiting automatic expansion. First credential cannot authorize any replacement. This does not remove the general Replace method from the service scope.

**Q29 — “Which specific objects, if any, may ide.Mint’s first PassKey authorize Destroy for?”**
Answer, verbatim: “none period”.
First credential cannot authorize any destruction. General Destroy implementation is still required; tests needing positive Replace/Destroy authority must use separately labeled synthetic grants, never reinterpret this credential.

**Q30 — “Should ide.Mint also be the Owner hierarchy of this first PassKey?”**
Answer: “Yes—ide.Mint is Owner and recipient (recommended)”.
Recipient and Owner are distinct roles, assigned to the same hierarchy for this first credential.

**Q31 — “Assign Owner ID 0 to the ide.Mint hierarchy?”**
Answer: “Yes—assign Owner ID 0 (recommended)”.
Shared configuration-wide assignment, not reassigned during the configuration lifetime. It is not extra authority and not a NULL encoding.

**Q32 — “Use Mint’s 25-bit payload as a persistent, non-reused sequential credential ID?”**
Answer: “Yes—sequential credential ID (recommended)”.
Starts at 0; issued IDs never reused after revocation or hard boot; exhaustion hard-faults, no wrap. This public identifier is not the random secret proof. Other Owners retain their own payload formats. Candidate IDs that were never committed/issued must be distinguished from issued IDs under Q54.

**Q33 — “May ide.Mint share this first PassKey GT/proof pair with another hierarchy?”**
Answer: “No—ide.Mint only (recommended)”.
No onward sharing of the same pair. Separately authorized new issuance is a different operation. Unauthorized onward-sharing attempts hard-fault.

**Q34 — “Who may authorize revocation of ide.Mint’s first PassKey?”**
Answer: “Genesis through the IDE only (recommended)”.
Mint performs the authorized state change; mere possession gives no revocation authority. Previously issued object GTs are not automatically revoked.

**Q35 — “Who may authorize new or replacement PassKeys in Phase 1?”**
Answer: “Genesis through the IDE only (recommended)”.
No delegated issuance authority was granted. Restoring an existing credential after boot is not new issuance and must not consume a new random entry or credential ID.

**Q36 — “Use ide.PkVerify as the verifier abstraction’s canonical dot-name?”**
Answer: “Use ide.PkVerify (recommended)”.
Namespace slot 15, E service; no Namespace-write authority is granted.

**Q37 — “Use ide.NSTab as the Namespace-table RW object’s canonical dot-name?”**
Answer: “Use ide.NSTab (recommended)”.
Names the existing table RW object at slot 14, not an additional table or executable helper service. Only Mint’s same-scope Lambda may reference its NSRW authority, including reads/rechecks.

**Q38 — “Should ide.PkVerify check credential validity and authorization for the exact request?”**
Answer: “Yes—validate and authorize the request (recommended)”.
Checks non-NULL/valid GT, trusted active issuance, full bound proof and revocation, then operation/type/destination/target permission on the exact frozen request. Success is not a reusable blanket approval. Mint separately checks live object eligibility, residency, active use and allocation constraints.

**Q39 — “How should callers supply the 128-bit proof?”**
Answer: “Read-only capability to a proof buffer (recommended)”.
Mint takes a protected snapshot; trusted expected proof comes independently from protected records, not caller-provided expected values. Bounds, presence, coherence, scratch cleanup and trace protection remain engineering obligations; an R-cap buffer alone does not establish secrecy.

**Q40 — “Set B=0 for ide.Mint’s first, non-shareable PassKey?”**
Answer: “Yes—B=0 (recommended)”.
Ordinary SAVE of this token into another C-list must fault under Bind rules. This is not a universal B=0 rule and does not detect arbitrary proof-byte copying. Initial delivery/restoration uses separately authorized provisioning.

**Q41 — “Allow authorized IDE setup to provision and restore this credential before normal execution?”**
Answer: “Yes—protected pre-execution provisioning (recommended)”.
Genesis-authorized setup provisions the B=0 GT directly into a protected Mint-owned credential C-list and the proof into separate protected storage. Mint remains issuer; restore the same credential, no new ID/randomness. Not an ordinary runtime SAVE bypass; no secret proof embedding in published LUMPs/bitstreams. Exact protected transfer/storage remains to be verified.

**Q42 — “Make Mint the runtime writer and PkVerify a read-only reader of protected credential records?”**
Answer: “Yes—separate write and verification authority (recommended)”.
Mint has runtime RW to the private registry; PkVerify gets read-only access. Ordinary callers have no registry access, only their own authorized credential material. PkVerify has no randomness-pool or NSRW authority. IDE setup is the separate authorized provisioning path.

**Q43 — “Approve these five core method names for ide.Mint?”**
Answer: “Approve the five method names (recommended)”.
Methods: Create, Replace, Destroy, ForgePassKey, RevokePassKey. Credential revocation is not object destruction. Exact selectors/register ABI were not approved by this choice.

**Q44 — “Use a read-only request descriptor for Create, Replace and Destroy parameters?”**
Answer: “Yes—read-only request descriptor (recommended)”.
The called method selects the operation. Descriptor contains ordinary parameters such as type, size and destination/target identity; Mint freezes the inputs. Capabilities remain actual GT arguments, not raw ordinary integers promoted into authority. No specific register numbers or binary field layout were approved.

**Q45 — “Who selects the Namespace slot and memory block for Create?”**
Answer: “Mint selects eligible free placement (recommended)”.
Caller supplies type/required size; Mint selects within authorized pools and Namespace. No overwrite of occupied slots or silent residency changes; first credential is limited to Boot.

**Q46 — “Should Replace retain the slot and advance its version once, faulting at version 510?”**
Answer: “Yes—same slot, next version (recommended)”.
General Replace uses same slot and increments the nine-bit version once, invalidating old object GTs. Publish after confirmed update. At current version 510, fail before target changes: no wrap and no live version 511. This does not grant the first credential any Replace target.

**Q47 — “Always prepare replacement bytes in a separate free block rather than overwrite the existing block?”**
Answer: “Yes—separate replacement block (recommended)”.
Prepare separate eligible allocation, then switch the entry under exclusive update. Require temporary capacity for both objects; lack of space hard-faults, no in-place fallback. Reclaim/zero the old block before reuse; separate allocation alone is not atomicity evidence.

**Q48 — “When should reclaimed blocks be fully zeroed?”**
Answer: “During reclamation, before entering the free pool (recommended)”.
After Destroy invalidates the old binding, or Replace commits the new one, clear the whole old block including unused capacity before publishing it as free. Interrupted/failed clearing must not yield an allocatable block. Reclaiming Replace’s old block does not increment the slot version a second time.

**Q49 — “Should live return-frame dependencies also count as in-use objects that Replace and Destroy cannot change?”**
Answer: “Yes—protect live return dependencies (recommended)”.
Protect code/C-list objects needed by live pending return frames as well as active Thread/executing code/active C-list. This does not protect every object merely because an outstanding GT exists. Scope and authoritative traversal of suspended contexts must be made precise, not silently narrowed to current CR14/CR6 or implemented using diagnostic host callStack.

**Q50 — “Limit Phase 1 Mint to one in-flight state-changing request, with overlaps hard-faulting?”**
Answer: “Yes—one request at a time (recommended)”.
Covers all five methods; overlap faults before that overlapping request’s mutations. No automatic queue/retry. Verifier may not observe partial credential records. This admission rule is not proof of Namespace external-writer/read exclusion.

**Q51 — “Require the LAMBDA to read back and verify all four Namespace-entry words before publishing the GT?”**
Answer: “Yes—verify all four stored words (recommended)”.
Read actual NS storage, compare all prepared words, keep exclusion until confirmation, fault on mismatch with no retry or rollback. Readback does not itself hide partial entries, exclude other observers, or establish acknowledged write completion on every target.

**Q52 — “Require the actual requesting hierarchy to be an approved recipient whenever the PassKey is used?”**
Answer: “Yes—enforce recipient identity at use time (recommended)”.
Preserve original authenticated requester through Mint -> PkVerify. Caller-supplied name/Owner bits are insufficient; treating immediate caller Mint as every original requester is a confused-deputy defect. Actual trusted context mechanism is not yet proven.

**Q53 — “Grant ide.PkVerify’s execute capability only to ide.Mint in Phase 1?”**
Answer: “Yes—Mint is the only authorized caller (recommended)”.
Distribute the E capability only to Mint. This is not a hard-coded-name substitute for authority, and does not waive original-requester authentication.

**Q54 — “Commit the issued credential, randomness consumption and ID counter together as one durable IDE update?”**
Answer: “Yes—one atomic issuance record update (recommended)”.
FINAL positive issuance rule: complete issued credential, consumption of its randomness entry and credential-ID advancement commit together, all-or-nothing, durably in the IDE. Before commit no credential is issued and no proof is exposed to the recipient. After commit the entry belongs to an existing recorded credential, not a discarded entry. If execution stops after commit before return, that credential still exists and authorized boot setup restores it as already issued; the interrupted call is NOT resumed. Normal success still requires matching board state. This does not approve automatic request retry, a pending-issuance recovery protocol, dropped entries or compensating rollback. The atomic store, secret-containment and cross-boundary failure evidence must be implemented/tested before claims of conformance.

**Q55 — “Move on to a concrete technical implementation and validation plan using the approved decisions?”**
Answer: “Yes—prepare the technical plan (recommended)”.
User comment, verbatim: “Provide sufficent .md documentation together with code references where needed for expert external review including all Q&A decisions, This is a TSB requirement for Worldwide Open Source review”.
Approved deliverable is the technical plan and external-review documentation. It does not authorize live installation, FPGA programming or claiming an operational verified Mint service.


## Retained baseline requirements

Reconcile current source and the active Master ISA, retaining earlier requirements not superseded above:

- ide.Mint is assigned slot 9 E, table view slot 14 RW, verifier slot 15 E. A placement/name does not confer capabilities. The Lambda is internal same-scope code, not a separate LUMP/service; only it references NSRW, including table reads and rechecks. No CALL, CHANGE, SWITCH or yield during the write interval. Freeze destination and request state; verify/prep before writes; publish only after confirmed completion.
- All faults hard-fault; no fabricated success, ordinary rejection-return path, silent repairs, fallback targets, rollback or automatic retry/recovery. Post-write faults cannot promise that no data changed. Preserve fault evidence without secrets; reporting failure must not prevent the hard fault. Watchdog/reset cannot be waived for Mint; already-accepted writes require bounded completion, not finishing unaccepted remainder writes.
- Phase 1 supports application Abstractions, Threads, LS C-list and RW data; no new Namespace LUMPs, MMIO creation, GC or automatic execution-triggered lazy installation. Do not weaken normal ISA permissions or impose PassKey proof checks on ordinary ISA LS/RW accesses.
- Resident objects are never replaced/destroyed, including Mint/PkVerify if resident. Preserve existing Phase 1 residency intent; current request does not approve changing saved layout or residency to make tests pass. Reject current active Thread/executing code/active C-list and now live return dependencies before modifying target memory/version.
- Slot generation is nine bits, distinct from the 25-bit credential ID: never-used slot starts 0; live 0–510; Destroy increments before freeing; 510 -> 511 retires permanently; no wrap/reset/reuse of retired slots; reuse retained usable release version without another increment. Q46 separately settles direct Replace.
- Per-size-class memory free/used pools are separate from Namespace slots/generations. Ascending 256-slot starting geometry and half FPGA memory are approved constraints; prior Mint/PkVerify 2/1 KiB estimates and 100% headroom are not measured/approved reservations. Do not select pool capacities or reduce safeguards to meet guessed sizes; resource assessment must account for complete payloads, registry, proofs, snapshots and temporary replacement blocks.
- PassKey GT+proof is reusable until revoked, not one-time authentication. Revoke the pair only, not previously minted object GTs. Exact GT equality alone is not validity/authentication. NULL tests use architectural type semantics, not word==0; missing trusted state or absent proof cannot become zero defaults. No special all-zero-proof value prohibition was selected.
- The non-executable HARDFAULT candidate word 0xF7000000 was selected, but emission/map binding and exact-target acceptance are separate gates. Inspect current assembler and exact-artifact map code; do not reenact already completed research or enable disabled emission. Maps cannot attribute accidental identical WORD bytes or expose proofs/private authority.
- T/network identity and virtualGT binding need reconciliation with the existing Phase 1 contract; absent networking T===GT is not permission to use old hash rules or zero W3. No new global owner registry/networking/multi-machine protocol is approved here.
- Software completion and software reload-path validation do not block the Phase 1 bitstream. Require honest simulator/RTL/exact-build physical evidence for software release under the existing approved gates; any explicit Genesis override must remain distinct from a passed test. No image adoption or hardware action follows from this design task.

