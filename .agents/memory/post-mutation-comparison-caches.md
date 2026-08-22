---
name: Post-mutation comparison caches
description: Keeping status views truthful immediately after a GitHub sync or other remote mutation.
---

Any action that changes the source being compared must clear the corresponding derived comparison cache before asking the UI to refresh.

**Why:** A long-lived file-diff cache can return the exact pre-mutation result after a successful push, making the UI report a failure even though the remote already matches.

**How to apply:** Invalidate server-side comparison payloads on successful mutation, then refetch the comparison. Do not rely on a client-side refresh alone, because it can receive the same cached response.