---
name: Shared served-script dependencies
description: How shared browser modules should be loaded and integration-tested when multiple UI surfaces depend on them.
---

For real review dialogs, streamed Bind evidence and delayed preparation races,
see [Browser service regression boundaries](browser-service-regression-boundaries.md).

Declare shared UI dependencies explicitly in the served script manifest before every consumer. Do not hide the dependency in `document.write` or another runtime injection path. A focused integration gate should derive and execute the relevant order from the served manifest rather than maintaining a separate hand-written order.

**Why:** A shared decoder had unit coverage but could silently disappear from the served IDE because source harnesses injected consumers in a different order. Runtime injection also made the actual dependency invisible to source-order checks and cache-version review.

**How to apply:** When extracting browser logic into a shared module used by multiple classic scripts, add it explicitly to the page manifest, retain the project’s cache-version convention, and make one focused integration test load the relevant scripts by parsing that manifest.

Refresh content-hashed script pins whenever a served compiler or shared API
module changes, and verify compilation using the scripts loaded by a browser.

**Why:** Mint compiled and saved successfully in server tests while an existing
editor still rejected typed imports using the older browser compiler. Local
preflight can reject a source before it reaches the authoritative server.
The user confirmed successful editor compilation/save after refreshing the
script pins and reloading; server-only compilation was not sufficient evidence.

**How to apply:** Run the existing browser-script freshness check/update and
its regressions. An already-open tab still needs a reload to replace its
in-memory compiler; do not overwrite the owned draft to fix compiler freshness.

Classic-script top-level classes are global lexical bindings, not necessarily
properties of `window`. Test browser consumers without CommonJS shims.

**Why:** A shared save module passed Node tests but failed in the browser when
it constructed a compiler via a missing window property; initial compilation
had hidden the issue by receiving an existing compiler instance.

**How to apply:** Integration tests should load the real scripts in browser
order with `module` and `require` absent, including deferred construction paths.

Execution integration checks must exercise the normal state observers, not
only the interpreter in isolation. Metadata slot zero is not a capability in
the ascending Namespace, including during state snapshots and UI enumeration.

**Why:** Direct execution passed while browser stepping faulted inside state
reporting that enumerated slot zero. Connecting a new runtime to existing views
exposed legacy table assumptions after an instruction had executed.

**How to apply:** Test instruction execution together with state snapshots,
Thread enumeration, and instruction-owner lookup. Exclude metadata from
observation without weakening runtime rejection of invalid capability slots.