---
name: Boot fault register context
description: Boot-time mLoad diagnostics must name the destination CR rather than the executing CR14 context.
---

When a boot state validates a capability before writing its destination register, its fault message must identify the register that the step is trying to populate (for example, CR6), while preserving the namespace slot and server/simulator reason. CR14 identifies the executing abstraction and is not automatically the capability that failed.

**Why:** Pre-write boot faults have no newly populated destination CR in the snapshot, so relying on the executing abstraction register produces a plausible but misleading diagnosis.

**How to apply:** Add the architectural destination register at each boot mLoad call site and keep the raw mLoad failure reason unchanged. Add a focused invalid-slot regression test when changing these messages.