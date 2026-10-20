---
name: Alice and Mallory thread isolation
description: User-directed separate Thread setup for the NewLayout protection demonstration.
---

Run Alice and Mallory in different Threads for the protection demonstration.
The user proposed priming them in CR1; the stated interpretation is each
Thread's respective entry capability, not the protected object's capability.

**Why:** The user explicitly requested different Threads rather than running
both actors in one execution context.

**How to apply:** Preserve distinct saved register contexts and deliberate
capability grants. Do not infer that Thread separation alone restricts object
access, or that this requires separate Namespaces or SWITCH.
