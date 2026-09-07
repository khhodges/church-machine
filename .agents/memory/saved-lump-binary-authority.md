---
name: Saved LUMP binary authority
description: Why the registry must switch from compile-time words to the complete server artifact after a successful save.
---

After a successful LUMP save, the registry entry for the saved token must use
the immutable server artifact as its authority. Evict any compile-time
code-only memory source for that token rather than treating it as the complete
LUMP.

**Why:** Compile-time words omit the LUMP header, self-definition frame, and
C-list. If they shadow the saved server binary, a Fully documented artifact
reopens as “embedded source unavailable” even though its persisted binary
contains the source.

**How to apply:** Any save/import path that transitions an in-memory
compilation into a persisted LUMP must register the returned canonical server
token and filename, then remove the pre-save memory representation for that
token before selecting or reopening it.

Resolve archived tokens again at the editor action boundary. Repository
filtering and reload-time selection repair are insufficient because stale
pending navigation or an already-rendered detail panel can still call the
editor with a historical token.

**Why:** An archived API-only revision can share the same abstraction name as
the current Fully documented revision. If Open in Editor trusts that token, it
correctly fetches the historical source-less bytes but presents them as though
they were the current saved artifact.

**How to apply:** History may preview exact archived bytes, but an editable
open must select the newest approved non-archived server artifact for the same
abstraction before fetching or decoding its content frame.

A divergent browser draft must be offered, not automatically restored over a
saved LUMP.

**Why:** Draft age is not ordered against immutable artifact revisions. An old
draft can mask newer saved source and make the compiled pane appear newer than
the editable text.

**How to apply:** Open with recovered server source by default. Show an
“Unsaved draft available” choice with explicit Restore and Discard actions;
only Restore may replace the editor buffer with draft text.