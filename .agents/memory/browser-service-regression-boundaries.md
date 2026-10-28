---
name: Browser service regression boundaries
description: Real review and streamed binding evidence in disposable browser journeys.
---
Keep Save/Bind race regressions on real review dialogs and real service responses.
For a delayed-response race, hold the received response unchanged and correlate
subsequent admission requests by preparation ID, not image hash.

**Why:** Rebinding an unchanged graph legitimately produces the same image bytes
while revoking the previous preparation. A hash-difference assertion tests the
wrong property. Streamed Bind response bodies also may not remain available
through browser response-body inspection after consumption.

**How to apply:** Capture streamed evidence at the network boundary using the
real upstream response and forward it unchanged. Never substitute synthesized
successes, acceptance callbacks, source repairs, or changed graph membership.
Retained-graph fixture drift must fail explicitly, not be silently normalized.
