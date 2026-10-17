---
name: Mint context authority boundary
description: Keep synthetic context evidence distinct from granting Mint access to protected Thread state.
---

Genesis authorized proposing the minimal missing Mint machine interfaces for
review, not implementing them. The proposal is in
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
