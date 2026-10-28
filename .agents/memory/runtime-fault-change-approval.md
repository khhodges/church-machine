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

For diagnostic replay limits, see
[mixed binding replay evidence](mixed-binding-replay-evidence.md): partial
localization can create downstream faults absent from a complete bound image.
