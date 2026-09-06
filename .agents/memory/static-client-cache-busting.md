---
name: Static client cache busting
description: Pinned script query strings can keep the browser on an older UI after a client fix.
---

When a browser-loaded simulator script changes, its pinned query-string version must change with it.

**Why:** The preview can continue serving a cached script when the HTML keeps the old version, making a completed client fix appear not to work.

**How to apply:** Bump the script asset version in simulator/index.html whenever changing a directly loaded simulator JavaScript file, then restart the IDE workflow.