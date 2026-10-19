---
name: Mint context authority boundary
description: Keep synthetic context evidence distinct from granting Mint access to protected Thread state.
---

The programmer clarified: “The RETURN from LAMBDA should NOT CLEAR any CRs
that is a security rule that only applies to CALL packets.”
Lambda returns to the saved stack address in the existing context.

**Why:** Mint cleanup initially treated the simulator's shared RETURN clearing
as ISA authority. Passing native tests demonstrated that implementation, not
its architectural correctness. The programmer explicitly rejected applying
CALL boundary cleanup to same-context Lambda return.

**How to apply:** Never propose a Lambda-return mask as an erasure mechanism.
Preserve current CRs rather than restoring snapshots or reconstructing CR6.
Keep Mint's pre-return cleanup gates unresolved until a separate legal
mechanism is established. Separate entry failures from continuation loss.
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
