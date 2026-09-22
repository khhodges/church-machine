---
name: Programmer change consent
description: Explicit consent for source replacement and persisted Namespace or repository changes.
---
Programmatic source replacement and persistent Namespace/LUMP changes require an explanation and explicit confirmation; rejection must preserve the protected state. Do not treat a browser/server source difference as evidence that the browser copy was never saved.

**Why:** The programmer reported a previously saved, working CR11 correction appearing only as a browser draft beside an older selected binary, and explicitly requested control over all such changes.

**How to apply:** Bind approval to the exact proposed change and current state; reject stale/replayed approvals. Background tools must stage or stop rather than bypass consent. Ordinary typing and draft preservation are not automatic source replacement. Browser consent cannot intercept arbitrary agent filesystem edits; disclose that boundary and obtain approval before changing the programmer's artifacts directly.