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

Callable code LUMPs require explicit declarations of their own methods; labels
and comments do not constitute an interface. The compiler generates the dispatch
table, and must reject missing declarations during compilation rather than Format LUMP.
This does not require destination method APIs or apply to data/Thread/Namespace artifacts.

**Why:** The user approved this simpler rule after raw assembly compiled successfully
but failed packaging because its own method declarations were absent.

**How to apply:** Preserve compiler-owned method metadata through format/save.
Never synthesize an implicit public `run` method for undeclared callable assembly.

Requiring at least one parsed method is not sufficient: callable compilation
must account for all non-comment source and reject malformed declarations,
unconsumed executable text, and unclosed scopes before issuing a candidate.

**Why:** A malformed second method was silently omitted while the first method
satisfied the new declaration check. Successful signed reproduction of compiler
output cannot independently establish that the compiler consumed the whole source.

**How to apply:** Include negative syntax and partial-parse tests alongside valid
multi-method save/reload tests; never equate compiler authentication with semantic completeness.

An unresolved binding is a HardFault only when referenced during execution.
Its presence alone must not block loading or starting execution.

**Why:** The user rejected the agent's proposed all-bindings-resolved execution
gate. Unused unresolved references are valid.

**How to apply:** Keep unresolved references explicit through compile, save,
binding and load; fault on actual execution-time reference, never guess a
target or silently rebind from Run, Step or Walk.

Missing/nonresident named LUMPs must not impose an all-resident precondition
on simulation preparation or image/bitstream building.

**Why:** The user explicitly rejected the “private ascending replay requires
Resident bodies” blocker and reiterated that dot.name is sufficient until
resolution; missing items are runtime concerns.

**How to apply:** Keep names and exact selections in the design, leave absent
bodies without executable authority, and retain runtime faults on use. This
does not waive structural, integrity or hardware-profile checks on bytes that
are actually supplied.

Destination SELF mismatches also belong to execution-time binding checks, not
whole-image admission. Preserve the mismatched C-list without rebinding it.

**Why:** The user's simulation remained blocked on an unused Namespace member's
SELF after missing-body checks were removed. Availability of a body does not
make its destination binding a prerequisite for executing unrelated code.

**How to apply:** Validate supplied-byte integrity and allocation independently;
test both an unused mismatched SELF and actual entry into that LUMP.

Symbolic CALL sites must preserve their execution condition while unresolved.
An untaken conditional reference must not fault. Binding modifies only private
destination copies; original names and relocation evidence remain covered by
the saved artifact's integrity.

**Why:** Making every unresolved placeholder unconditional violates the user's
“only if referenced” rule even when unused entries correctly remain harmless.

**How to apply:** Test both true and false conditions, actual approved save,
and replay of an existing binding without invoking the resolver again.

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