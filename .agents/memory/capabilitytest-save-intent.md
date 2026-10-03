---
name: CapabilityTest SAVE intent
description: Programmer intent and authorization boundary for the capability SAVE round-trip.
---

CapabilityTest must retain an authorized SAVE round-trip, not replace the
failing SAVE with a repeated LOAD equality test.

**Why:** The programmer explicitly selected testing an authorized SAVE after
being offered the simpler read-only alternative. That intent is distinct from
authorization to publish source changes or provision live grants.

**How to apply:** Review source-export authority and destination-write authority
separately. Use a disposable scratch destination for diagnostic tests; preserve
saved history and hardware state. A test harness's grants do not establish that
the retained live program has those grants or authorize installing them.