---
name: Instruction commentary evidence
description: Separate static instruction meaning from immutable execution evidence.
---

Static listings must remain symbolic even when live registers are available. Historical operands and effects require a frozen record from that exact execution occurrence; never reconstruct inputs from outputs or borrow a later snapshot.

**Why:** Recomputing an already-executed in-place IADD from its current destination displayed 4096 + 4096 = 8192 even though the actual occurrence was 0 + 4096 = 4096, misleading authorization debugging.

**How to apply:** Preserve exact instruction/artifact context alongside occurrence evidence. Loops and resets are distinct occurrences. Hardware packets without operands must say unavailable; software registers cannot fill that gap. Static decode must not imply a skipped or rejected instruction took effect.