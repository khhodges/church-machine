---
name: Boot freshness requires admissible identity
description: Defines which compiled artifacts may be presented as newer executable boot candidates.
---

Boot freshness comparisons must exclude artifacts that fail the bootstrap identity contract. Such artifacts remain inspectable evidence and must produce a separate persistent failed-save warning with source recovery; they are not successful boot revisions.

**Why:** An identity-invalid compilation was labeled “latest successful,” producing a warning and action that routed users to a server-rejected promotion flow.

**How to apply:** Before ranking revisions for boot freshness, verify record token, sealed SELF row, and live binding agree. Compare only admissible candidates, while reporting rejected newer saves through a distinct recovery action.