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

Phase 1 uses bounded execution turns with a watchdog hard fault at **one
second**, except in IDE Debug or IDE Trace mode. Instruction retirement does
not renew the deadline. Every successful CHANGE or SWITCH starts a fresh second,
including self-transfers and helper-Thread transfers; renewal is not restricted
to scheduler handoffs.
When normal execution resumes with neither IDE Debug nor IDE Trace active,
start a fresh second rather than restoring a partially spent interval.

**Why:** The user selected bounded turns and explicitly fixed “ONE second to
Hard Fault unless in IDE debug or IDE Trace mode.” They then explicitly selected
every successful CHANGE/SWITCH as the renewal event.
They also explicitly selected a fresh second on return from Debug/Trace.
They approved arming when execution starts after reset (including boot, except
in the exempt IDE modes), elapsed-time rather than instruction-count timing,
and expiry winning at exactly one second. A transfer must complete strictly
before the deadline to renew it.

**How to apply:** Preserve the duration, exceptions and transfer-based renewal.
Do not introduce scheduler-only renewal, or claim this guarantees useful progress
or return to a scheduler. Preserve fresh-second mode exit; broader maintenance
exemptions must not be inferred. CR13 remains untouched.

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
Keep any reuse/exhaustion policy in software. The suggested no-wrap rule was
not approved; do not turn it into a hardware or software requirement.
