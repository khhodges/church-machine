---
name: Mint context authority boundary
description: Keep synthetic context evidence distinct from granting Mint access to protected Thread state.
---

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

The Phase 1 test credential is exactly the Passkey GT in CR2, `0xFFFFFFFF`.
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
