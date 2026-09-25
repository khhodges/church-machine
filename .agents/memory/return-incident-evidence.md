---
name: Return incident evidence
description: Evidence standards for apparent RETURN-triggered boot restarts.
---

Do not infer an incident's cause from post-event state or a currently available
artifact alone. Preserve contemporaneous pre/post state, lifecycle provenance,
and execution identity before drawing a conclusion.

Correlate independent control-flow, state-transition, and artifact-identity
evidence. Treat absent historical evidence as a reason to add bounded,
observational capture—not to speculate, change runtime behavior, or replay a
workload without authorization.

Keep next-boot image readiness separate from live execution authority.

**Why:** A resume action routed through boot preparation can replace protected
Thread state and reset the machine before the paused instruction executes,
making a UI reset look like an instruction failure.

**How to apply:** Resuming a booted machine must preserve its live frames;
image refresh and replacement belong to explicit boot/preparation operations.