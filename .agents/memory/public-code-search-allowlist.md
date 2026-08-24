---
name: Public code search allowlist
description: Security boundary for searchable and viewable project source.
---

Landing search may index public code only from explicit source roots and
text-file extensions. Result links must use the guarded code viewer, which
canonicalizes the requested path, rejects traversal and symlinks outside the
workspace, limits file size, and HTML-escapes source before rendering.

**Why:** Broad workspace search or raw file serving can expose secrets, build
artifacts, caches, and arbitrary internal files even when the user only asked
to make code discoverable.

**How to apply:** Add a new code location or extension to both the index and
viewer allowlists deliberately. Keep generated binary directories, dependencies,
hidden state, and credential-bearing files outside the searchable surface.