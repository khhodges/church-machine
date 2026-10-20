---
name: Alice and Mallory thread isolation
description: User-directed separate Thread setup for the NewLayout protection demonstration.
---

Run Alice and Mallory in different Threads for the protection demonstration.
The user confirmed priming each Thread's respective actor entry capability
in CR1, not the protected object's capability.

**Why:** The user explicitly requested different Threads rather than running
both actors in one execution context.

**How to apply:** Preserve distinct saved register contexts and deliberate
capability grants. Do not infer that Thread separation alone restricts object
access, or that this requires separate Namespaces or SWITCH.

Isolated actor fixture provisioning is not adoption into the user's selected
Namespace. Keep the evidence and user-facing claims distinct.

**Why:** An ascending-layout runtime can exercise protection correctly using
preboot fixture provisioning without proving the saved-design preparation path.

**How to apply:** Label fixture-only initialization and historical source
adaptations explicitly; never present that run as installation or execution
of the user's saved NewLayout.

Alice's stash must survive fault restart and be readable afterward without
running Stash again.

**Why:** The user accepted LUMP-backed storage conditionally on survival through
fault restart; unchanged bytes at the fault itself are insufficient.

**How to apply:** Distinguish restarting execution over retained memory from
reloading a pristine image. Verify Reveal after recovery, not just the
pre-restart value. Do not imply persistence across power loss.
