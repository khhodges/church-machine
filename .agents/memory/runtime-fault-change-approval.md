---
name: Runtime fault change approval
description: Approval boundary for investigation of the recurring NS21 CALL fault.
---

For the recurring NS21 CALL fault, investigate without applying fixes until the
user explicitly approves the proposed change. Investigation is not permission
to bind, prepare or activate a replacement image, rewrite source, restart the
application, or change Namespace assignments or hardware.

**Why:** The user explicitly stopped further fixes after repeated unsuccessful
iterations and requested a deep investigation first.

**How to apply:** Use read-only evidence and separate in-memory replays. Report
proven facts, inferred action ordering and remaining uncertainty separately.
Task creation or status changes do not override the approval requirement.

On 2026-10-28 the user explicitly approved the scoped stale pre-binding
simulation fix: revoke older loaded/pending simulation inputs around explicit
Bind and retain the existing fresh prepare/approve/activate path. This approval
does not authorize source rewrites, automatic binding during Run, fallback
grants, live Namespace reassignment, or hardware changes.

**Why:** Binding completion can change execution bytes without changing the
saved design fingerprint; the user approved invalidation, not runtime repair.
**How to apply:** Keep other fault hypotheses behind separate explicit approval.

On 2026-10-28 the user separately approved disposable-clone Save → Bind →
Prepare → Run → Reset → fresh-session verification after the binding-freshness
correction merged. This does not authorize live-state or hardware operations,
Namespace membership changes, approval bypasses, or silent source adoption.

**Why:** Workflow verification has a distinct approval boundary from the fix.
**How to apply:** Use isolated storage and real review dialogs; report blocked
steps as unverified rather than substituting frontend mocks for browser evidence.

For diagnostic replay limits, see
[mixed binding replay evidence](mixed-binding-replay-evidence.md): partial
localization can create downstream faults absent from a complete bound image.
