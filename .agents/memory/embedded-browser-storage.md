---
name: Embedded browser storage
description: Distinguish iframe startup failures from server readiness without risking drafts
---

A successful standalone page load does not establish that the IDE works in
an embedded browser with storage restrictions.

**Why:** An iframe reproduction denied localStorage/sessionStorage access and
stopped startup while the same URL worked as a standalone page.

**How to apply:** Check the embedded context, not only HTTP status. Never
silently substitute ephemeral storage for persistent drafts. Expose storage
denial and offer a standalone link or an explicit browser storage-access request.
