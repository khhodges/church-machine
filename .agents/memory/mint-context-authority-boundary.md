---
name: Mint context authority boundary
description: Keep synthetic context evidence distinct from granting Mint access to protected Thread state.
---

## PkVerify responsibility

PkVerify's sole objective is to establish that the caller is approved to execute
the protected function—“No more no less.”

**Why:** The user explicitly narrowed its purpose while replacing the isolated
always-approve stub.

**How to apply:** Keep caller authorization separate from allocation, operational
argument validation, function execution and success reporting. This scope
agreement does not itself choose the approval evidence or verification mechanism.

The user defines PkVerify's proof as an immutable, untransferable Abstract GT,
with B=0 defining its non-transferability.

**Why:** This is the stated proof requirement, not ordinary writable proof data.

**How to apply:** Do not retain the four-word DATA proof as the intended design
or invent another non-transferability mechanism. Use the stated Abstract GT,
B=0 contract and verify simulator behavior against the ISA. The user clarified
B=0 after the agent incorrectly left the architectural mechanism unresolved;
implementation conformance remains a separate verification question.

Genesis approves and installs this token in authorized callers' C-lists and
issues the matching reference token to Mint for an EXACT comparison.

**Why:** The user specified this as the complete authorization design:
Genesis provisioning establishes approval; Mint checks the approved proof.

**How to apply:** Replace unconditional approval with the ISA EXACT check
against Mint's trusted reference before the protected operation. Do not add
four-word proof data, an authentication service or another authorization scheme.
Provisioning the token defines the approval scope. A verifier comparing two
arguments does not establish who approved them: Mint must obtain the reference
from its own Genesis-provisioned authority, never accept the caller's reference.

**Why:** An attacker can supply two equal unapproved tokens; EXACT alone cannot
distinguish those from the approved pair without trusted reference provenance.

**How to apply:** Keep reference selection in the protected service. Preserve
operation-input capabilities across verification RETURN when later validation
still needs them; erased inputs can otherwise appear to satisfy NULL checks.

## Phase 1 Mint ownership and local Lambda decision

Use only existing instruction encodings for the Mint happy path. Report what
cannot be expressed; do not propose or assign new encodings as a workaround.
This includes preserving operand encodings: the user explicitly rejected using
currently unused opcode-7 operand bits for a local-label displacement.

**Why:** The user explicitly rejected both the encoding/interface expansion and
the subsequent proposal to extend opcode 7's operands.

**How to apply:** Distinguish missing assembler syntax, runtime implementation,
and capability provisioning from an ISA encoding limitation. Do not call the
whole path impossible merely because a source-level label or GT literal is not
an existing instruction operand. Preserve the ordinary execution requirement.

The local Mint Lambda branches to its label under the existing CR14 code
authority. Do not require a separately provisioned X capability in CR9 or
another register for this local transfer.

**Why:** The user explicitly reaffirmed the agreed local-label branch using
existing CR14 after the agent incorrectly reintroduced a separate X-capability
binding requirement. This supersedes that earlier interpretation.

**How to apply:** Preserve CR14 and the same Mint context; verify actual labeled
body entry and return, not just an inline RETURN. Preserve existing instruction
encodings. If implementation cannot express the approved transfer, report
the exact gap rather than substituting a separate capability requirement.

For Mint's single-entry local slot-writing block, use ordinary BRANCH entry
and a fixed BRANCH continuation, not an opcode-7 frame or RETURN that would
consume the enclosing CALL continuation.

**Why:** This local transfer does not cross an authority boundary, and existing
branches provide the agreed label transfer under CR14 without a separate GT,
new operand encoding, or return-stack protocol. Do not generalize this fixed
continuation to a multiply-called or recursive routine.

Outward completion cleanup follows final result validation; do not erase
descriptor/identity evidence before those checks. Preserve the completion
result and Thread heap pair. This does not authorize erasure on the local
branch continuation or bypass the unresolved early-entry clearing gates.

**Why:** Result validation still needs working evidence. Ordinary data
instructions can erase scratch values afterward, while the existing CALL
return mask performs the outward capability cleanup.

Mint owns the memory pool and free-slot list. Phase 1 code is single-threaded.
The Lambda name is a label in Mint's code block; it executes with the same
authority as Mint and uses Mint's NS/RW capability. Do not model it as a
separate service or demand removal of Mint's authority on this internal return.

**Why:** The user explicitly supplied these architectural decisions after the
Data CREATE blocker review.

**How to apply:** Implement the scoped happy path around Mint-owned allocation
and a same-context local Lambda. Preserve Lambda-return CRs. Keep outward CALL
boundary checks separate. This does not approve hardware changes or the
previously declined protected-profile shortcut.

## FPGA-first Mint review

The user's CREATE DATA fault-injection acceptance criterion permits leaked
reservations, never recycling after a hard cut and authorized restart setup.
It also requires no delivered GT without completed publication/read-back and
no caller-readable private authority after a fault.

**Why:** The user's review explicitly distinguishes non-return on a live fault
from safe state after reset/power loss and asks for per-store cut fixtures.

**How to apply:** Treat restart persistence, partial-entry visibility and
private result containment as separate proof obligations. Do not infer them
from passing arithmetic, normal RETURN cleanup or component issuance tests.
This criterion does not itself authorize a new interlock or rollback mechanism.

For Phase 1 CREATE, a faulted request never returns a result GT. Leave its
consumed reservation or partially written slot unused; do not introduce rollback
or recovery as a prerequisite for the happy path.

**Why:** The user explicitly accepts abandoned faulted requests, conditional on
the seal rejecting invalid descriptors and the caller never receiving an invalid GT.

**How to apply:** Keep result issuance after successful publication and validation.
Do not turn this fault-path decision into an unverified claim that every partial
descriptor fails its seal or that concurrent access is safe.

Agree the native FPGA-targeted Mint algorithm and instruction sequence first,
one field/step at a time. Existing IDE prototype choices are not requirements.

**Why:** The user explicitly corrected the review: “I dont care to follow the
IDE design I want to agree the FPGA code.”

**How to apply:** Do not present the IDE's pool-relative offsets, register
assignments or helper conventions as agreed FPGA design. Separate existing
hardware constraints from proposed software choices; adapt the IDE after
agreement rather than using it to settle the FPGA contract.

## Mint public return convention review

DESTROY, MakeOutform, and MakeInform identify their target solely through its
GT supplied as a capability argument. Never accept a caller-supplied Namespace
slot number as an object selector, including a redundant slot alongside the GT.

**Why:** The user explicitly rejected the proposed DESTROY slot argument:
these methods must use a GT, "NOT (NEVER EVER) a slot#".

**How to apply:** There is no scalar target argument. The ABI proposal uses
CR2 for the target and CR1 for the always-required PassKey.
Do not preserve the current implementation's
slot-number input as architectural authority. Internal resolution must follow
the GT's validated authority, not substitute bare slot identity.

Every Mint method requires a PassKey, including MakeOutform and MakeInform.
The conversion methods take one target-object GT in addition to that PassKey.

**Why:** The user explicitly corrected the agent's interpretation with
"A PassKey is always required!" The earlier "one GT not 2" must not be used to
remove authorization from conversion methods.

**How to apply:** Keep CR1 as PassKey input/result output and CR2 as the target
object for the three object-targeting methods. Authorization is implicit in the
shared calling convention rather than an optional per-method flag.

Do not impose an always-zero DR4 input merely because current Mint methods
do not use it.

**Why:** The user challenged the unnecessary zero-input restriction. Register
argument meaning and private-data cleanup on return are separate concerns.

**How to apply:** Propose unused scalar inputs as ignored rather than zero-
validated. Keep any output cleanup rule explicit and separate; do not infer
preservation or reserved-register semantics from absence of an argument.

The LUMP's embedded public definition should be an ABI, not merely an API
description; use Mint's register-level contract to design that extension.

The user requested minimum ABI size through one standardized register convention
for all methods, rather than repeated per-method register assignments.

Use a programmer-facing `PassKey Required` declaration rather than a
`Standard1` calling-convention selector. The compiler owns one shared convention.

**Why:** The user explicitly prefers the meaningful PassKey declaration and
accepts recompilation with no backward compatibility once the upgraded compiler
has been retested.

**How to apply:** Plan a clean compiler/ABI-reader cutover, rejecting obsolete
executable ABI formats rather than guessing or adapting them. Recompile affected
callers and callees into new revisions; preserve historical bytes. This decision
does not authorize immediate mass recompilation, publication, or board installation.
The declaration expresses an authorization requirement, not proof that runtime
PassKey verification occurred.

**Why:** Repeated register maps inflate the embedded ABI and allow inconsistent
calling conventions.

**How to apply:** Propose a versioned shared convention and encode only each
method's signature differences. Specific registers, type codes, error values and
compact record layouts remain proposals until reviewed.

**Why:** The user explicitly requested an ABI carried by the LUMP.

**How to apply:** Extend the single canonical embedded definition rather than
adding a competing sidecar. Concrete schema extensions and implementation remain
subject to review; do not infer agreed register preservation or error numbers.

A one-time-use Passkey must be explicitly defined before it is used.
Replacing a Passkey register with a result does not define or enforce one-time use.

**Why:** The user required prior definition of any one-time-use Passkey while
discussing CR1 as a possible proof-input/object-output register.

**How to apply:** Do not infer consumption, revocation, retry behavior, or
persistence semantics from register clearing or B=0. CR1 proof input remains a
proposal, not an approved implementation; define and review single-use semantics
separately if that feature is requested.

Mint's public returned status should use DR1 = 0 for success and a nonzero
error code for failure (the user's example is insufficient budget). Exact error
numbers remain unassigned in this review.

**Why:** The user corrected the proposed demonstration's DR1 = 1 success
convention and asked that Mint follow the zero-success convention.

**How to apply:** Reconcile public completion and caller checks before continuing
the demonstration. Do not confuse an internal predicate/readiness flag with
public return status, or convert machine hard faults into normal returns.
This review does not authorize adding budget enforcement.

The user also rejected overwriting the Mint E GT in CR1 with the result object.
Separate target and result register roles in the proposed interface; the exact
register assignment and preservation/RETURN contract still need joint review.

**Why:** Reloadability from the C-list does not address the user's objection to
overwriting the call-target register.

**How to apply:** Do not silently retain the old CR1 input/output convention,
or promise preservation merely by selecting another CALL operand. Review the
callee's register use and RETURN behavior before implementation.

## Agreed FPGA slot location

Namespace W0 receives the physical byte address of the allocated block,
retained by the allocator and used unchanged by Mint.

**Why:** The user approved this rule during the FPGA-first, field-by-field
review, explicitly rejecting IDE prototype conventions as the design basis.

**How to apply:** Preserve that allocator/descriptor contract. Do not substitute
a pool-relative offset or require an IDE lookup. Register assignments and the
remaining descriptor fields are separate decisions.

### Demonstration-only word-address exception

For the current unchanged-BIT Mint demonstration, the user selected a scoped
exception: retain allocator byte addresses, convert the resident descriptor W0
to a word address at publication preparation, and calculate integrity from that
encoded W0. Keep word-valued allocation limits unchanged.

**Why:** After reviewing the byte-contract/installed-BIT mismatch, the user chose
“1 for now 2 later”: a BIT-specific demonstration now, followed later by adopting
word-addressed resident descriptors as the supported architectural contract.

**How to apply:** This exception does not yet revise the general byte-address
contract, authorize rewriting saved artifacts, or establish demonstration success.
Review the exact software scope against the frozen BIT before implementation.
Keep MMIO treatment separate. Continue joint step-by-step approval; no inferred
RTL simulation, hardware build, board installation, or flash authorization.
The later contract alignment is a chosen direction, not current implementation scope.

Keep the initial unchanged-BIT adaptation descriptor-only, not a deployable full
Mint variant.

**Why:** The approved step is isolated descriptor adaptation and non-RTL checks;
exposing the full service would imply compatibility for DESTROY and allocator/
publication paths that have not been adapted or accepted.

**How to apply:** Component success does not authorize full-service integration,
caller provisioning, image generation, or board execution. Review those separately.

## Agreed FPGA slot limit

W1 limit_offset is the inclusive word offset: allocated_word_count minus one.
Reject zero size and a result that does not fit 21 bits; never truncate.

**Why:** The user approved this rule in the FPGA-first field review. Location
uses byte addresses, but FPGA access bounds use word offsets.

**How to apply:** Keep address units distinct from limit units when preparing
the native Mint descriptor. Register assignments remain a separate decision.

## FPGA CREATE sequence rule

For the typical CREATE case, new_gt_seq = current_gt_seq + 1.
The slot and newly issued GT must use the same resulting sequence.

**Why:** During the FPGA-first field review, the user corrected the proposal
to reuse the slot's version unchanged: “The typical case is current # +1”.

**How to apply:** Use this rule for the normal native Mint CREATE design,
not the older retained-version/no-increment proposal. This is explicit
software management, not an automatic hardware version change. The completed
field review also approved first use at zero, 509→510 usable, 510→511 retired,
and 511 remaining retired, without wrapping. Coordination with release must
not silently introduce another increment.

## Agreed Phase 1 F/G initialization

Initialize Namespace W1 bit 30 (G) and bit 31 (F) to zero for Phase 1.

**Why:** The user explicitly approved “G=0 for Phase 1” during the FPGA-first
field review, then specified “F is also 0 for Phase 1”. GC behavior is outside
Phase 1.

**How to apply:** Clear F and G while preparing the slot authority word,
preserving limit and sequence. This approval does not decide later GC behavior.

## Agreed FPGA slot integrity calculation

Prepare W2 as ROL32(W0, 7) XOR ROL32(W1 AND 0x3FFFFFFF, 13)
XOR 0xDEADBEEF, using 32-bit operations. F/G are excluded; W3 is not an input.
The user approved this calculation as a private, same-context LAMBDA with
W0/W1 inputs, W2 output and no side effects.

**Why:** The user agreed to the FPGA's existing exact formula and pure helper
contract during the field-by-field Mint review.

**How to apply:** Preserve the agreed formula and caller inputs; do not add
Namespace writes or authority issuance to this calculation. Implement using
approved native encodings and agreed local-transfer conventions; agreement on
the formula does not by itself prove a CLOOMC implementation or board execution.

## Agreed non-networked W3

For this Phase 1 DATA RW CREATE, W3 is the same Inform DATA RW B=1 GT being
created, with the selected slot and new sequence, not a content hash.

**Why:** The user approved T === GT and then approved coding the complete
field package.

**How to apply:** Calculate these bits privately for descriptor preparation.
Do not expose the GT in CR1 until slot publication has been confirmed.
W3 remains excluded from W2 integrity.

## Native helper scratch hazards

Native FPGA CREATE acceptance must not be inferred from the legacy simulator:
its Namespace slots descend and its locations are word-valued, while the scoped
native publication path uses ascending slots and physical byte locations.

**Why:** End-to-end testing exposed ordinary LOAD consulting a different entry
from native publication. Even pre-provisioning that other entry can mask the
mismatch and return authority to unrelated storage.

**How to apply:** Keep component issuance tests explicitly isolated; never
redirect stores, mirror entries, or translate instructions to claim acceptance.
Require consistent FPGA memory wiring for complete CREATE evidence. Do not
install the candidate into the legacy execution profile.

Allocator address/cursor comparisons must use unsigned branch conditions.
Keep physical byte-base provisioning and persistent slot history as explicit
trusted software-state obligations, not inferred from empty Namespace words.
Reserve history before cursor mutation; a later fault may lose capacity but
must never make a reserved slot available again. Release retains the issued
version; CREATE performs the single increment.

**Why:** Native integration exposed signed comparison accepting physical
address wraparound. The agreed CREATE increment also rules out incrementing
once again on release. Fail-closed reservation is preferable to invented rollback.

**How to apply:** Test high-bit addresses, duplicate queue entries, and repeated
retirement attempts in disposable native execution. Do not treat fixture
provisioning as production authority or reboot-persistence evidence.

Review actual assembler lowering when preserving live scratch registers
across comparisons; do not assume source-level immediate comparisons are
register-preserving.

**Why:** Native descriptor tests against the FPGA reference exposed immediate
MCMP lowering overwriting the live integrity constant in DR15. Register-form
comparison avoids that implicit scratch use.

**How to apply:** Use register-form comparisons when DR15 is live, and keep
independent reference tests for the complete native instruction sequence.

## Phase 1 PkVerify decision

For Phase 1, PkVerify always returns APPROVED.

**Why:** The user explicitly clarified this scope when real credential/proof
verification was presented as the next Mint blocker.

**How to apply:** Treat PkVerify as an unconditional Phase 1 approval stub.
Do not require a trusted credential record, proof verification or a particular
GT value to obtain its APPROVED result. Keep this scoped to Phase 1; it does
not change machine capability checks or prove real authentication.

For Phase 1 CREATE, use PkVerify APPROVED as allocation approval; do not add
a separate allowance/quota blocker.

**Why:** The user explicitly directed “Use PkVerify for approval” after a
separate allowance blocker was retained behind the completed verification call.

**How to apply:** On APPROVED, continue to allocation with existing pool/slot
capacity checks intact. Approval is not completed CREATE and must not publish
a successful result before the remaining operation completes.

The earlier Phase 1 test credential is exactly the Passkey GT in CR2, `0xFFFFFFFF`.
The user explicitly selected the GT only, not the four-word proof at CR3.
This is a scoped Mint testing exception, not general GT validity or a grant
of memory/Namespace access to that word.

**Why:** The user clarified “The Passkey GT” when offered GT, proof, or both.

**How to apply:** Do not require an all-ones CR3 proof, weaken general GT
validation, or import the isolated protected-profile shortcut. Keep the
testing exception distinct from real credential verification.

New layout must retain ordinary execution semantics for the requested Mint
Data CREATE path. Do not connect it to the isolated protected Mint profile
as a shortcut; resolve the ISA/interface questions first.

**Why:** The user explicitly declined using those protected interfaces in
New layout's private simulation and requested a problem list instead.

**How to apply:** Earlier isolated-profile approval remains scoped there.
Separate missing CLOOMC implementation and provisioning from actual ISA
changes; do not assume every missing binding requires a new instruction.

The programmer clarified: “The RETURN from LAMBDA should NOT CLEAR any CRs
that is a security rule that only applies to CALL packets.”
Lambda returns to the saved stack address in the existing context.

**Why:** Mint cleanup initially treated the simulator's shared RETURN clearing
as ISA authority. Passing native tests demonstrated that implementation, not
its architectural correctness. The programmer explicitly rejected applying
CALL boundary cleanup to same-context Lambda return.

**How to apply:** Never propose a Lambda-return mask as an erasure mechanism.
Preserve current CRs rather than restoring snapshots or reconstructing CR6.
For returns across an authority boundary, require a legal cleanup mechanism.
The same-authority local Phase 1 Lambda described above is not such a boundary.
Separate entry failures from continuation loss.
Do not substitute host redirection or claim hardware alignment from simulator
tests. The master ISA carries the normative rule.

Apply that rule to protected adapters too: a host-side clear immediately before
delegating to ordinary Lambda RETURN is still forbidden return-time erasure.
If a service requires private authority removed before resumption and lacks a
legal mechanism, stop rather than return with that authority.

**Why:** Correcting the ordinary core alone left the isolated protected profile
enforcing the rejected behavior through its own pre-return hook.

**2026-10-17 superseding approval:** The user explicitly approved implementation
of the proposed protected Mint interfaces in the isolated simulator, with no
live installation or hardware changes. New candidates use `ide.*` identities
while retaining approved slots and display labels.

**Why:** The approval form separately asked about canonical names and protected
Mint implementation; both were approved. This supersedes the historical
design-only restriction below, not the safety obligations.

**How to apply:** Implement and verify isolated M1/M2/M3 semantics, including
G4 exclusion and fault containment. Do not infer live publication, FPGA changes,
new credential recipients, or successful runtime acceptance from this approval.
Unspecified encodings and protected continuation packing still need deliberate
ISA reconciliation; approval is not permission to bypass enforcement.

The user explicitly selected **one GT with combined L+S in the isolated
profile**, not separate L/S outputs, for Thread-LS and LS object results.

**Why:** The approved Mint types require LS, while the legacy simulator rejects
multiple Church permissions. The user chose a scoped permission-rule extension
rather than changing the single-CR1 result ABI.

**How to apply:** Preserve one result in CR1 and the existing GT encoding/B
semantics. Do not propagate combined-LS permission admission into the legacy
simulator, hardware, or other profiles without separate approval.

Keep the protected execution boundary sealed when integrating it with candidate
linking or the IDE: do not hand loaders, editors, diagnostics or callbacks the
underlying mutable simulator, RAM or registers.

**Why:** The legacy simulator intentionally exposes direct mutation and rich
diagnostic paths. Guarding BEGIN alone cannot exclude those actors or retract
proof material already emitted. The isolated implementation chooses a private
execution instance rather than claiming that the unrestricted IDE is protected.

**How to apply:** Preserve the isolated boundary or explicitly qualify every
new producer/observer against the shared inventory before connecting it. Treat
real candidate linking and all-entry execution as separate acceptance evidence,
not something established by the standalone protected-service path.

For combined-profile evidence, distinguish authenticated source-bearing
candidates from their API-only execution derivatives, and measure both forms.
Do not transfer an original compiler attestation to bytes changed by compaction.

**Why:** The complete editing form can exceed the approved half-memory budget
even when the complete API execution form fits. Source-free compilation also
does not satisfy a save request that claims matching embedded editor source.

**How to apply:** Reuse qualified candidate admission and linking first, retain
those exact artifacts, then derive and separately hash complete API output.
Never drop API frames or safeguards to claim fit. Keep startup variants and
Mallory's intended rejection distinct from a single continuous zero-fault run.

Historical scope: Genesis authorized proposing the minimal missing interfaces
for review, not implementing them. The proposal is in
`docs/reviews/mint-phase1/minimal-machine-interfaces.md`.

**Why:** The request for complete simulator code exposed unresolved caller
evidence, private Lambda entry/return and lawful GT-result delivery contracts.
Genesis explicitly chose “propose the minimal interfaces” after these limits
were explained.

**How to apply:** Treat the new document as proposed semantics only. Preserve
the existing no-raw-Thread-access, approved-recipient, fixed-slot and GT-format
constraints. Obtain implementation approval rather than inferring new
architectural authority from permission to design.

Synthetic M3 result manufacturing must not justify redirecting Mint's C-list
scope or provisioning private aliases. Treat publication enforcement and
observer confidentiality as separate approval/evidence obligations.

**Why:** A test-privileged scope can demonstrate manufacturing without proving
lawful entry or return. A future exact-value write permit would still not
protect read aliases, retained Thread homes or previously emitted diagnostics.

**How to apply:** Use the bounded result-containment investigation as evidence
of gaps, not permission for a CR6 workaround. Preserve its distinction between
host-observer exposure and an ordinary caller exploit.

Genesis's subsequent design review endorsed the direction but requested explicit
G4 dependency, READ/COMMIT binding, fault-before-clear containment and stronger
M3 publication-bound write restrictions. It did not approve implementation.

**Why:** A software admission boundary is not an interlock; even exact old-word
equality misses change-and-restore ABA; a bounded RW alias constrains address,
not write timing/value; cleanup cannot protect data before a fault.

**How to apply:** Keep those distinctions in all Mint claims. The revised
proposal's single-use result-write permit is still proposed new machine
enforcement, not existing GT behavior or authority granted by this review.

Mint context work must stop at a demonstrated missing authority path rather
than granting a raw Thread-read capability, widening the heap, or treating host
callStack as authenticated evidence.

**Why:** The user explicitly bounded the investigation to source-grounded
feasibility and isolated cross-layer fixtures, requiring approval for new
architectural authority. Synthetic RAM/register construction is test privilege,
not a legal provisioning mechanism or evidence of a functioning service.

**How to apply:** Preserve that distinction when continuing G1–G3 work.
Request approval for a concrete protected attestation/traversal interface and
Lambda binding/continuation decisions before implementation. Component probe
success must not be recorded as service, full-core or physical acceptance.

The Genesis review endorses the Mint Phase 1 assurance package and its existing
policy, not closure of G1–G8 or authorization of operational Mint.

**Why:** The user supplied their Genesis assessment distinguishing documentation
and arithmetic evidence from unproven service behavior. It prioritizes G4
whole-update exclusion and G1 legal Lambda/result authority, recommending early
assessment of a minimal interlock without approving one.

**How to apply:** Preserve the decision ledger. Address the review's three
documentation refinements: share the Mint/Amobea activation-path inventory,
clarify protected Thread word +17 ownership/frame access and live/saved rules,
and explain durable issuance with a stale board mirror. Treat these as review
requests, not new architectural grants. Genesis authorized incorporating these
refinements while preserving the decision ledger. Validate running-bit premises
against the current specification: the live indicator and saved frame are
distinct physical words, and a review recommendation does not approve bit
placement or a new protected access interface.
