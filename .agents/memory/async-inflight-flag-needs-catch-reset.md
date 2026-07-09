---
name: Async in-flight UI flags must reset in the catch, not just the .then()
description: A boolean "saving/in-flight" flag that gates a UI control (disabled state, spinner text) must be cleared on every exit path of the async call — success, explicit server-side failure, AND the rejected-promise/exception path — or the control gets stuck disabled forever.
---

Pattern seen in `simulator/app-compile.js`: three near-identical call sites all POST to
`/api/lumps/save` and set `window._lumpSaveInFlight = true` before the fetch, then set it back
to `false` (and refresh the dependent UI) inside `.then(resp => { ... })`. Two of the three also
correctly reset it inside `.catch(err => { ... })`. The third (the plain "clean compile, no
version prompt" path) only reset it in `.then()` — so a network failure, or a non-2xx response
whose body wasn't valid JSON (making `r.json()` itself throw), left the flag `true` forever with
no recovery path short of recompiling. The dependent "Open Lump" link stayed rendered as a
disabled "Saving…" placeholder indefinitely.

**Why:** `fetch(...).then(r => r.json()).then(resp => {...})` has three distinct outcomes
(explicit success, explicit failure via a normal error-shaped JSON response, and a *rejected*
promise), but it's easy to only handle the first two inside `.then()` and forget that `.catch()`
is a third, separate exit path that needs the identical cleanup — not just an error log.

**How to apply:** Whenever an in-flight/loading flag is set before an async call and read by a
UI-disabling function, grep for every place that flag is set to `true` and verify each has a
matching `.catch()` (or `finally`, if available) that resets it — don't just check the success
path. When copy-pasting one working save/fetch call site to create a second, diff the `.catch()`
blocks specifically; that's the block most likely to be trimmed down and lose the reset.
