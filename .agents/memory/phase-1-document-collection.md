---
name: Phase 1 shared documents
description: User-requested ISA-first organization and single-source preservation policy.
---

Keep the related Phase 1 architecture and release documents together in one
shared collection, starting with the ISA.

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

CR13 is reserved in Phase 1 with no automatic interrupt or watchdog-Thread
role. Successful SWITCH CR15 still clears CR13 including M; ordinary CHANGE
gets no new clearing rule.

**Why:** The user approved reserving CR13 rather than retaining the conflicting
requirement to install an interrupt Thread after Namespace handoff.

**How to apply:** Remove that installation requirement when reconciling current
documents; keep watchdog policy a separate decision and preserve historical
proposals unchanged.

The user approved the Master's ascending layout as the sole new Phase 1
Namespace layout and requested three trailing additions in this order:
`ide.Mint E`, `nstab RW` (hand-crafted Namespace-table RW capability, “the
power”), and `pkverify E` (a new, yet-to-be-defined LUMP).

**Why:** These are explicit user requirements accompanying layout approval,
not inferred runtime provisioning or a completed verifier design.

**How to apply:** Preserve the order and exact requested rights. Establish
which table and capability holder the user means before assigning rows or
granting authority; do not invent pkverify behavior.
