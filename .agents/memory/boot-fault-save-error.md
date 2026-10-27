---
name: Boot fault save memory-error classification
description: Approved secondary code for memory failures during the one outgoing save.
---

Use THREAD_CONTEXT (0x1D) for missed memory grant/completion during the
fault-entry outgoing context save. Preserve existing validation error codes.
Boot stash, status-store and activation failures remain catastrophic.

**Why:** The user explicitly approved this classification rather than allocating
a new fault code; the five-bit nonzero code space is already allocated.

**How to apply:** Use this as DR5's secondary code with DR3=2 when the outgoing
save cannot complete; do not widen the interface or reinterpret the original
fault. This approval is not permission to program or activate hardware.
