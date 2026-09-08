---
name: Starter handoff must be acyclic
description: The startup validation chain cannot contain a SelfTest-to-Starter-to-SelfTest cycle.
---

Startup SelfTest hands off once to the selected Starter. The Starter must continue
to its next stage, such as WukongCallHome, and must not call SelfTest back.

**Why:** ELOADCALL is a frame-pushing fused LOAD+CALL in the implemented simulator
and hardware contract. A reciprocal SelfTest/Starter ELOADCALL cycle therefore
grows the protected LIFO until stack overflow; it is not a tail-call loop.

**How to apply:** Keep negative terminal-fault checks in isolated tests, not in
the continuing Starter path. Regressions should verify the chain is acyclic and
that the Starter's final continuation is not SelfTest.