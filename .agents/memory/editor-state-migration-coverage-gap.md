---
name: One-shot text migrations must cover every independent save/restore path
description: Why a bug "reappeared" after being fixed — a localStorage-backed migration only patched some of the save/restore call sites, not all of them
---

When a browser-side bug bakes bad text into `localStorage` (e.g. a
since-fixed disassembler emitting invalid operand syntax) and the fix is a
one-shot "migrate on read" helper, that helper must be wired into **every**
independent place that reads the tainted key back into the UI — not just the
one or two call sites that happened to be involved in the original bug
report.

**Why:** the same piece of UI (e.g. a code editor) can have more than one
save/restore mechanism layered on top of each other — a per-item draft store
(keyed by token/tab id) *and* a generic "last session snapshot" store that
persists whatever is currently on screen regardless of which item is active.
A migration applied only to the specific/keyed store leaves the generic
snapshot store unpatched. Any browser still holding a stale generic snapshot
keeps restoring the broken text on every reload, which looks exactly like the
original bug "coming back" after later, unrelated work — even though nothing
regressed and the real gap was there from the start.

**How to apply:** when adding a migration for tainted persisted text, grep
for every `localStorage.getItem`/`setItem` pair touching that data (or data
of the same shape) across the whole app, not just the ones near the bug
report's stack trace or screenshot. A generic "restore last editor state on
page load" function is an easy one to miss because it doesn't look
token/item-specific. Add a static/source-based regression test asserting the
migration call appears, and appears *before* the restored value is used, so
a future edit to that restore path can't silently drop the call again.
