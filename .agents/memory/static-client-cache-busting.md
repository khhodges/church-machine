---
name: Static client cache busting
description: Pinned script query strings can keep the browser on an older UI after a client fix.
---

When a browser-loaded simulator script changes, its pinned query-string version must change with it, using the exact content-derived hash rather than a manually added suffix.

**Why:** The preview can continue serving a cached script when the HTML keeps the old version, making a completed client fix appear not to work. Function-only tests with mocked helpers can pass even while the entry page assembles incompatible helper versions.

**How to apply:** Check content-derived pins whenever changing directly loaded simulator JavaScript, then restart the IDE workflow. For cross-script flows, verify the entry-page assets and real shared helpers, not just an extracted function with mocked dependencies.