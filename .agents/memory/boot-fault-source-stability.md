---
name: Boot fault source stability
description: Direct-stash source lifetime and scheduler combinational acceptance boundaries.
---

Freeze the issuing engine on fault acceptance, not one cycle later, when
implementing a direct first-copy fault stash. Keep original source state through
stash, save and post-save diagnostic capture; transport completion is not an
execution authorization.

**Why:** A terminal execution-unit fault can disappear on its next edge. A delayed
freeze can preserve registers while losing the original code/instruction source,
tempting an unauthorized intermediate event bank.

**How to apply:** Use local fixed-port simulations with delayed faults as well
as decoder faults. Preserve the accepted write edge; do not replay it.

Scheduler fault exclusion must be checked with whole-wrapper netlist elaboration,
not only simulation.

**Why:** Aggregate fault feedback through accepted-start operand reads, and
start-dependent busy feeding instruction-valid, can form combinational cycles
even when behavioral simulation converges for the chosen stimulus.

**How to apply:** Separate registered scheduler ownership from immediate accepted
start, and make front-end fault checks independent of the scheduler operand mux.
