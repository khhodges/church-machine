---
name: Boot freshness requires admissible identity
description: Defines which compiled artifacts may be presented as newer executable boot candidates.
---

Boot freshness comparisons must exclude artifacts that fail the bootstrap identity contract. Such artifacts remain inspectable evidence, but they are not successful, bootable revisions and must not trigger update or repair prompts.

**Why:** An identity-invalid compilation was labeled “latest successful,” producing a warning and action that routed users to a server-rejected promotion flow.

**How to apply:** Before ranking a resident abstraction’s compiled revisions for freshness, verify the record token, sealed SELF row, and live resident binding agree. Compare the prepared image only against admissible candidates.