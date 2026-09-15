---
name: History preview archive identity
description: Historical LUMP previews must resolve the exact immutable archive named by the history record.
---

Historical preview requests must carry the archive filename recorded on the history row. The server may accept that value only after matching it to the requested token's archived manifest entry; the browser must not construct or infer archive paths.

**Why:** Normal revisions, legacy bootstrap records, and archived records with reused tokens can point at different immutable files. Resolving only by token or version can preview the current artifact, the wrong historical artifact, or no artifact at all.

**How to apply:** Keep preview read-only and source-first. Permit raw word-aligned inspection for invalid bytes, but keep restore, approval, and runtime validation bound to the exact validated binary hash.

Opening historical source for editing is a draft-copy operation, not activation.

**Why:** The normal saved-LUMP opener can redirect an old token to a current revision; that would silently substitute different source for the revision the programmer selected.

**How to apply:** Copy the exact preview response into a personal draft, preserve existing editor work, and leave active artifact and boot bindings unchanged until explicit save/approval.

Historical provenance belongs in separate draft metadata, never in the program name.

**Why:** The programmer expects to continue the same abstraction; adding “from v…” to its name suggests a rename and can leak into identity handling.

**How to apply:** Retain the abstraction name unchanged and show the originating revision separately. Assembly metadata labels such as `Abstraction:` are not part of the name.