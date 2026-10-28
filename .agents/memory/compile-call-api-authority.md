---
name: Compile CALL API authority
description: Unencodable CALLs are compile errors; never substitute WORD placeholders or guess a selector.
---

An unresolved CALL that cannot be encoded as a real CALL is a compile error.
Do not emit a successful candidate containing a WORD placeholder and do not
present symbolic metadata as an encoded instruction.

**Why:** On 2026-10-28 the user explicitly corrected the earlier deferred-binding
policy: “Then the case must be flaged as a compile error ! That is the correct
compiler action.” This supersedes the previous allowance for unresolved CALL
placeholders in newly compiled artifacts.

**How to apply:** Report the source line and unresolved target, return no
successful candidate, and never guess selector zero or a method name. Preserve
existing saved artifacts and their inspection/binding support; this rule does
not authorize rewriting historical binaries or changing runtime permissions.

Named-method syntax such as `CALL ide.CapabilityTest, Run` remains valid.
Attempt method resolution before declaring a CALL unencodable.

**Why:** The user corrected the blanket rejection of named CALLs: specifying
an explicit method must be able to resolve to a real numeric CALL. The new
compile-error policy concerns unresolved operands, not the use of PetNames in source.

**How to apply:** Resolve the declared row and method from the selected target's
API; absent browser API knowledge must not prevent the server authority lookup.
Keep the resulting disassembly numeric and never invent a selector.

For compile-time API lookup, explicit artifact pins take precedence, then exact
Namespace assignments. Only an otherwise unbound name may use its unambiguous
latest non-archived saved library definition; ambiguous latest revisions fail.
An invalid or ambiguous existing assignment must never fall through to library
selection. This does not install or change any runtime binding.

**Why:** A saved target exposed its declared method when addressed by token but
not by name because it was not assigned under that name in the committed
Namespace. Requiring installation just to compile against a saved API incorrectly
conflates source compilation with runtime placement.

**How to apply:** Retain exact token/hash API evidence in the compile response,
preserve explicit choices, and verify actual CALL encoding separately from
whether the destination program is ready to run.

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

For existing artifacts, an unresolved binding is a HardFault only when referenced during execution.
Its presence alone must not block loading or starting execution.

**Why:** The user rejected the agent's proposed all-bindings-resolved execution
gate. Unused unresolved references are valid.

**How to apply:** Preserve historical unresolved references during binding
and load; new unencodable CALLs fail compilation under the rule above. Fault on actual execution-time reference, never guess a
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