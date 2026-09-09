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

The save response must carry the server-derived canonical dot name, issue,
filename, abstraction, and hashes. Register that complete descriptor before
selecting the new token. If the save began from a restored draft, delete the
exact old draft token and relinquish its editor ownership only after the
durable save succeeds.

**Why:** Selecting an unregistered response token makes a valid fresh artifact
look unknown until a later repository refresh. Leaving the old draft key or
dirty listener active makes that draft reappear and mask the newly saved source.

**How to apply:** Centralize every save-success path through one client commit
step: register canonical response metadata, evict code-only memory, delete the
captured pre-save draft identity, exit saved-LUMP editor ownership, then set
current and pending selection to the new token.

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

Fault-dialog editing must reopen the immutable LUMP identified by the captured
CR14 Namespace slot, rather than merely switching to the editor view.

**Why:** The editor buffer may belong to another program even though the fault
modal can correctly identify the executing LUMP. A view switch then makes
embedded source appear lost when it is still present in the binary.

**How to apply:** Resolve the fault-time slot to its current server token and
run the normal saved-LUMP editor-open path before attempting source navigation.
Also compare filenames/hashes, not only stable tokens, across development and
production: the same protected token can bind different deployed revisions.

Saved-LUMP simulator deployment must resolve its target slot from live Namespace
state when the caller does not provide one; never default immediately to the
canonical boot abstraction slot.

**Why:** Manifest records intentionally do not own deployment slots. Falling
back to the boot slot can overwrite SelfTest and leave CR6 bound to SelfTest's
C-List while a different saved abstraction executes.

**How to apply:** Match the immutable token against live Namespace bindings
first, then use the abstraction label as a secondary lookup. Use the canonical
boot slot only for genuinely unbound legacy artifacts.