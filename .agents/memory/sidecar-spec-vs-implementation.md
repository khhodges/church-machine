---
name: Sidecar spec vs implementation
description: Spec claims about sidecar authorship must be reconciled with the many real write paths in server/app.py
---
The CM_LUMP spec's "sidecar = pure mechanical cache, one write path" rule is **future-normative** (T7-gated), not current fact.

**Why:** Completion reviews reject spec text that asserts unimplemented behavior as fact. Current reality: `POST /api/lumps/save` populates most fields from request `metadata`; additional writers exist (save-wip, import, upload-lump, namespace-build create sidecars; meta, wip-source, content, resize, fork-version [`forked:true` flag], mtbf mutate them). `group`/`doc_refs` still on disk; freespace is still enforced all-zero.

**How to apply:** When editing lump/sidecar docs, verify every field and writer claim against server/app.py (~line 5300–7800) and actual `server/lumps/*.json`. Gotchas: `domain_perms` is a string ("L+S+E"), `media_tags` is an object registry, `description`/`status`/`source_file` are legacy catalogue-curated (not save-emitted), petname/identity_string/identity_hash/issue_number ARE save-emitted (dual-seal), `image_width`/`image_height`/`namespace_meta` come from import/namespace-build paths.
