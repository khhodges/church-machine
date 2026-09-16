---
name: Boot freshness requires admissible identity
description: Defines which compiled artifacts may be presented as newer executable boot candidates.
---

Boot freshness comparisons must exclude artifacts that fail the bootstrap identity contract. Such artifacts remain inspectable evidence and must produce a separate persistent failed-save warning with source recovery; they are not successful boot revisions.

**Why:** An identity-invalid compilation was labeled “latest successful,” producing a warning and action that routed users to a server-rejected promotion flow.

**How to apply:** Compare only admissible candidates and report rejected saves separately. A rendered recovery action must use its frozen target; do not re-gate it on mutable Namespace state that may be replaced after render.