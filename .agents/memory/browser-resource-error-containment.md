---
name: Browser resource-error containment
description: Why the IDE's non-Error window error guard must run during capture.
---

Register the IDE's non-`Error` window error guard with capture enabled. Continue
to let genuine JavaScript `Error` objects propagate.

**Why:** Resource-load failures dispatch an `error` event whose `error` property
is absent and which does not bubble normally. A bubbling-only guard misses that
event, allowing the artifact runtime monitor to report a fatal generic
"uncaught exception ... not an error object" even though the application itself
did not throw a JavaScript exception.

**How to apply:** Keep the early listener in the document head, preserve its
`preventDefault()` and `stopImmediatePropagation()` calls for non-`Error`
events, and ensure the listener is registered with capture enabled. Regression
tests should assert capture-phase registration as well as value normalization.