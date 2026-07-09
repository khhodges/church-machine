---
name: Stale-version client redirect strips query strings
description: A version-mismatch cache-bust redirect (server or client) that doesn't forward the current query string silently breaks every URL param (?debug=1, ?learn=1, etc.) on every page load.
---

Two independent places can strip query strings on `/simulator/` page loads:

1. A server-side redirect to a versioned path (e.g. `/simulator/~/<version>`) that only
   copies the path, not `request.query_string`.
2. A client-side "cache bust" IIFE that compares a hardcoded version constant against the
   current version and force-redirects when they differ. If that constant is stale (never
   updated to match the live/dynamic version), the redirect fires on *every* load, and if it
   only preserves `window.location.hash` (not `.search`), query params are dropped on every
   single page view — a real, user-facing bug, not just a test artifact.

**Why:** This class of bug is easy to miss because each redirect looks correct in isolation
(it does redirect, it does preserve *something*), and it silently swallows query strings that
gate features behind flags (e.g. `?debug=1`, `?learn=1`), making those features look "broken"
or "missing" with no error anywhere.

**How to apply:** When a test or bug report shows a URL flag/param having no effect after
page load, check for *any* redirect in the load path (server-side route handler and
client-side version/cache-bust guards) and confirm each one forwards the full
`location.search` (or `request.query_string`), not just the hash or path.
