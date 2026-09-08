---
name: Quiet hardware loops are not freezes
description: Defines when missing Wukong trace traffic is sufficient evidence for an execution-stalled diagnostic.
---

Do not classify a continuously running Wukong as frozen from stale trace age alone. Intentional idle loops can keep executing without producing newer interesting trace events.

**Why:** WukongCallHome's normal LED write loop was repeatedly reported as “Execution Stalled” even though no architectural fault or explicit halt existed.

**How to apply:** Require a causal bounded expectation, such as a confirmed single-step command that produces no newer retirement, before opening the freeze diagnostic. Continue to surface real fault, breakpoint, transport-disconnect, and explicit-halt evidence directly.