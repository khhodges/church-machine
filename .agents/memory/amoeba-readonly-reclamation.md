---
name: Amoeba read-only reclamation
description: First reclamation step excludes mutable or modified LUMP bodies.
---

Limit the first Amoeba memory-reclamation implementation to read-only LUMPs
that remain true to their compilation. Do not introduce mutable-body
checkpointing as a prerequisite for that first step.

**Why:** The user narrowed the scope on 2026-11-13 to simplify the first
retirement/reload implementation after the missing modified-state custody
contract was identified.

**How to apply:** Preserve the admitted artifact and its validated local
bindings as the reload authority. Retain mutable or modified bodies rather than
discarding their state. Read-only eligibility does not waive executing,
return-frame or suspended-continuation protection. Keep retirement explicit,
preserve Namespace slots and identities, and do not infer permission for
automatic eviction, saved boot replacement, vendor builds or hardware operations.

While Amoeba runs, no USER code executes concurrently.

**Why:** The user explicitly corrected the retirement discussion to rely on
Amoeba's exclusive execution rather than inventing a concurrent execution race.

**How to apply:** Do not add concurrent-USER execution tracking or synchronization
for this step. Distinguish exclusive current execution from retained RETURN and
suspended-Thread continuations, which may still require a body when resumed.
Keep Amoeba's own executing body resident.
