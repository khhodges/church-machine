---
name: Visible binding progress
description: Bind must visibly present each C-list during processing, not only at completion.
---

The user requires C-list windows to appear progressively while Bind works.
DOM changes alone are not evidence that progress appeared on screen.

**Why:** The initial implementation passed DOM tests but the user saw no
intermediate steps. Network chunks can coalesce multiple progress events and
the browser can complete all their updates before painting.

**How to apply:** Verify intermediate windows across browser paint frames,
including a response containing all events in one chunk. Distinguish per-entry
binding evidence from final confirmation that the Namespace save completed.
