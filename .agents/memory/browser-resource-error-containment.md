---
name: Browser resource-error containment
description: Why the IDE's non-Error window error guard must run during capture.
---

Register both IDE guards for non-`Error` window errors and promise rejections
with capture enabled. Continue to let genuine JavaScript `Error` objects
propagate. Production promise boundaries must also reject with `Error` objects,
never strings or other scalar values; the global guard is containment, not a
substitute for typed failures.

**Why:** Resource-load failures dispatch an `error` event whose `error` property
is absent and which does not bubble normally. A bubbling-only guard misses that
event, allowing the artifact runtime monitor to report a fatal generic
"uncaught exception ... not an error object" even though the application itself
did not throw a JavaScript exception. Malformed promise rejections have the same
listener-ordering problem; protecting only `error` still lets
`unhandledrejection` reach the artifact monitor first. Some artifact-monitor
contexts observe malformed rejections without preserving their source or stack,
so a scalar rejection can still become a generic fatal report.

**How to apply:** Keep the early listener in the document head, preserve its
`preventDefault()` and `stopImmediatePropagation()` calls for non-`Error`
events, and ensure both listeners are registered with capture enabled.
Regression tests should assert capture-phase registration, value normalization,
and that production code does not call `Promise.reject` with a scalar literal.

Browser telemetry must register before these containment listeners. It records
only error categories, allowlisted script locations, timing and coarse UI context,
not arbitrary exception messages or stack text.

**Why:** Containment stops later listeners from seeing the events; exception
messages can embed editor source or credentials. Location-only frames preserve
useful evidence without transmitting those values.

**How to apply:** Keep reporting independent of login, bounded and non-recursive.
Test a browser-produced payload through server ingestion. Reports are untrusted
client observations, not proof of server failures; tab termination and offline
delivery may leave no record.