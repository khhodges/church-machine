---
name: History preview archive identity
description: Historical LUMP previews must resolve the exact immutable archive named by the history record.
---

Historical preview requests must carry the archive filename recorded on the history row. The server may accept that value only after matching it to the requested token's archived manifest entry; the browser must not construct or infer archive paths.

**Why:** Normal revisions, legacy bootstrap records, and archived records with reused tokens can point at different immutable files. Resolving only by token or version can preview the current artifact, the wrong historical artifact, or no artifact at all.

**How to apply:** Keep preview read-only and source-first. Permit raw word-aligned inspection for invalid bytes, but keep restore, approval, and runtime validation bound to the exact validated binary hash.