---
name: Boot freshness requires admissible identity
description: Defines which compiled artifacts may be presented as newer executable boot candidates.
---

Boot freshness comparisons must exclude bootstrap artifacts that fail the bootstrap identity contract. Such artifacts remain inspectable evidence and must produce a separate persistent failed-save warning with source recovery; they are not successful boot revisions. Exact compiler-attested artifacts use compiler admission instead: bootstrap ancestry alone must not impose the legacy record-token-equals-destination-SELF rule on them.

**Why:** An identity-invalid compilation was labeled “latest successful,” producing a warning and action that routed users to a server-rejected promotion flow. Conversely, imposing bootstrap identity on an already admitted compiler revision made freshness falsely recommend an older bootstrap revision.

**How to apply:** Compare only admissible candidates and report rejected saves separately. Rank revision before timestamp because imported history timestamps need not reflect revision order. Freshness is advisory, never consent to change an exact pin. A rendered recovery action must use its frozen target; do not re-gate it on mutable Namespace state that may be replaced after render.