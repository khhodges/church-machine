---
name: Intentional capability faults
description: Authored missing-row accesses may be saved and executed without modifying the source.
---

Allow deliberately absent C-list accesses to reach runtime checks. Static range
diagnostics are advisory, not proof that an artifact is malformed.

**Why:** The user explicitly approved publishing Mallory's unchanged missing-row
LOAD so the actual machine produces NO_CAPABILITY. Increasing the C-list size or
rewriting the operand would invalidate the demonstration.

**How to apply:** Keep compiler authentication, immutable history and structural
validation. Do not turn predicted capability faults into publication or simulation
admission failures. An authenticated artifact's own declared RW binding may target
its own resident body; this must not grant other artifacts access to that body.

Apply this boundary to browser pre-save auditing as well as server publication.

**Why:** Server-side acceptance alone did not let users compile Mallory: the
browser independently rejected the intentional absent-row LOAD.

**How to apply:** Keep absent-row diagnostics advisory without enlarging the
C-list; keep malformed binary checks blocking. Exercise the real browser
audit policy in regressions, not only compiler or server acceptance.
