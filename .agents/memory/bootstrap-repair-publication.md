---
name: Bootstrap repair publication
description: Rules for publishing corrected resident bootstrap artifacts from recovered source
---

A bootstrap recovery is not complete when corrected bytes alone are saved. The next save must retain the server-issued bootstrap destination context so its approval carries trusted bootstrap admission evidence.

**Why:** Loading recovered source without its repair metadata can produce correct row-zero bytes but an ordinary approval. The save appears committed, then startup rejects the artifact as untrusted.

**How to apply:** Preserve the repair context through the immutable save snapshot, clear it only after success, and remove any superseded non-archived manifest row that points to the newly published filename.