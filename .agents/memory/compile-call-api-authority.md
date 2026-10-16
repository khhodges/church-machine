---
name: Compile CALL API authority
description: Dot-name compilation is independent of destination API availability; the linking loader owns resolution.
---

The compiler needs the declared dot-name to form the LUMP; the linking loader
does the rest. Preserve unresolved references rather than requiring destination
APIs or method conventions at compilation. Missing destination evidence is a
linking concern, not a reason to reject LUMP formation.

**Why:** On 2026-10-16 the user explicitly corrected the agent: “The dot.name is
all the compiler needs to do to form the LUMP the linking loader does the rest.”
This supersedes the earlier policy of compile-time destination API warnings
and method validation. It is an architectural requirement, not a claim that
the current implementation already satisfies it.

**How to apply:** Move destination-dependent resolution and validation to the
linking loader, retaining symbolic evidence in compiler output. Never guess
a numeric selector or suppress errors while emitting guessed executable bytes.
Local source syntax and structural validation remain compiler responsibilities.

An unresolved binding is a HardFault only when referenced during execution.
Its presence alone must not block loading or starting execution.

**Why:** The user rejected the agent's proposed all-bindings-resolved execution
gate. Unused unresolved references are valid.

**How to apply:** Keep unresolved references explicit through compile, save,
binding and load; fault on actual execution-time reference, never guess a
target or silently rebind from Run, Step or Walk.

CALL diagnostics and lowering must share object/method interpretation, using
the active or finalized C-list. Missing API evidence must never turn a full
dot-name into a shorter object name. Source metadata removal must preserve
editor line breaks rather than adjusting diagnostic numbers afterward.

**Why:** The user reported `CALL ide.SelfTest` and `CALL ide.WukongCallHome`
both being diagnosed as calls to `ide`, and requested a shared-parser fix
rather than warning suppression. Independent header parsing missed active
C-list names and comments.

**How to apply:** Test exact object identity and original source coordinates
through both browser compilation and the server worker, including missing
and mismatched API evidence.

Any legacy path still using embedded method conventions must keep them
request-local until migrated to the linking-loader boundary above.

**Why:** A regression using globally seeded test conventions can pass while
the live worker drops exact API metadata. Static Run/Main aliases can also
hide an authoritative empty method table in the selected binary.

**How to apply:** Test public compile entry points without seeded global
conventions; include selected artifacts with empty APIs. Do not repair missing
method metadata by guessing selector zero or mutating saved binaries.

Read-only method descriptions obey the same exact-artifact boundary. Missing
input/output or index fields mean unavailable, not permission to substitute a
catalog convention. Historical descriptions remain explicitly unverified.

**Why:** Catalog return registers and method positions can disagree with saved
APIs. Presentation cleanup must not alter compiler or execution behavior.

**How to apply:** Preserve historical convention tables used by compilation;
isolate display evidence and keep archived previews tied to their own bytes.