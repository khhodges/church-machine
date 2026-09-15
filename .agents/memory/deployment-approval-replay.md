---
name: Deployment approval replay binding
description: One-time simulator deployment approvals must fail closed on expiry, replay, session, digest, and action mismatches.
---

Deployment approval intents are single-use even when the first presented
request is invalid. A live intent must be consumed on any consuming-path
rejection, not only after a successful validation.

**Why:** If a mismatched request leaves the intent alive, an attacker can probe
its binding and replay the same approval with corrected session, digest, or
action data. Read-only preflight paths are the explicit exception.

**How to apply:** Keep expiry, session, digest, and action checks inside the
same lock as intent removal. Verify the deploy endpoint computes the digest
from the current immutable artifact before consuming the matching intent.