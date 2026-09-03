---
name: Stale-version client redirect strips query strings
description: A version-mismatch cache-bust redirect (server or client) that doesn't forward the current query string silently breaks every URL param (?debug=1, ?learn=1, etc.) on every page load.
---

The server-side `/simulator/` redirect is the sole authority for the current
versioned URL. It must copy `request.query_string`.

Do not add a second client-side "cache bust" IIFE with a hardcoded version. A
stale constant makes every current versioned page navigate again after scripts
begin loading. That aborts in-flight assets, can be reported as a fatal
non-`Error` runtime exception, and can also lose query parameters.

**Why:** This class of bug is easy to miss because each redirect looks correct
in isolation. In combination, the late client redirect races resource loading
and silently breaks URL flags or the artifact runtime itself.

**How to apply:** Keep version selection in the server route, preserve the full
query string there, and reject hardcoded client-side simulator-version
redirects in regression coverage.
