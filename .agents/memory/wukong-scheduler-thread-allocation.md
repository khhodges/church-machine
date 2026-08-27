---
name: Wukong scheduler Thread allocation
description: Board-only Thread allocation rule for physical round-robin context switching.
---

Projected Wukong Thread contexts must allocate at least 512 words when physical round-robin scheduling is enabled. The simulator’s compact 256-word Thread format remains valid for simulator use.

**Why:** hardware CHANGE restores persisted private capability state through CR14, whose capability home follows the fixed caps zone. A 256-word physical allocation places that restoration outside the descriptor’s capacity and must fail closed.

**How to apply:** preserve/resize the board-only forward-namespace projection and its header/descriptor capacity together; do not change the generic simulator LUMP format solely for this hardware reserve.

CR12 remains the system Thread root during physical scheduling. Track the active
private backing base separately, and use that base for outgoing saves, incoming
restores, and active-Thread telemetry.

**Why:** Using CR12 for scheduled saves makes every switch overwrite Thread.1
and leaves telemetry reporting Thread.1 even after another context is active.

**How to apply:** Commit the active backing base only after descriptor preflight
and CHANGE complete; restore DR, PC/NIA, flags, M state, and private CRs from the
validated incoming base at an instruction-safe boundary.