---
name: Portable LUMP binding boundary
description: Security boundary between portable unresolved artifacts and destination-local capability materialization.
---

## Simulator binding lifecycle

Only the user's explicit BIND action may materialize destination-local GTs,
including SELF. Compile produces a portable LUMP; selecting or adding a local
slot records placement without binding its C-list. BIND creates a separate
local derivative and preserves the portable original.

**Why:** The user explicitly rejected a local SELF slot in an otherwise
unbound C-list: adding a local slot must not destroy mobility.

**How to apply:** Do not bind on Add, compile, save, inspect or execution.
Advisory dependency validation may report readiness without materializing GTs.
This supersedes any earlier Add workflow that implicitly produced bound bytes;
activation remains separate.

Obsolete binding snapshots are disposable derivatives, not immutable LUMP
history. Delete unreachable snapshots on authorized maintenance; protect exact
saved designs and retained execution/preparation references, and serialize
cleanup with snapshot readers and writers. Never recreate a missing binding
silently during inspection or execution.

**Why:** The user approved throwing away stale binding snapshots instead of
retaining them indefinitely, separately from the archive age/version policy.

**How to apply:** Determine reachability from exact saved selections, not age;
keep cleanup failures separate from a successful design save.

Bound inspection must read an already-persisted derivative, never run the linker
as a read-time convenience. Original saved bytes remain a distinct inspectable mode.

**Why:** A report of successful binding alongside a preview of original words
misled users into treating unresolved source words as evidence of failed binding.
Re-linking during inspection would instead change the evidence being inspected.

**How to apply:** Tie C-list words, hex and decoding to one hash-verified snapshot;
reject stale destination context without hiding the original immutable revision.

Resolve declared dot-names afresh when Bind Namespace Design is clicked; never
assume existing destination GTs are still correct. Run, Step and Walk must not
trigger rebinding or change the established bindings.

**Why:** The user rejected reuse of old bindings, confirmed that continuation
controls must preserve them, then moved the binding action to the renamed
Bind Namespace Design control instead of automatic load-time binding.

**How to apply:** Validate each resolved destination binding and show
one movable, staggered overlapping inspection window per C-list, all together.
Show actual binding results, not inferred labels. Namespace edits during execution
must not silently relink the session. Binding reports alone are not executable
image activation or hardware certification.

Unresolved bindings do not block compilation, saving, loading, or starting
execution. Only an executing instruction that references an unresolved binding
causes a HardFault; unused unresolved entries do not fault. Binding reports
may expose unresolved entries without imposing an all-resolved execution gate.
Run, Step and Walk still must not rebind.

**Why:** The user explicitly corrected the agent's proposed execution gate:
“An unresolved binding is a HardFault at execution time only is referenced.”

**How to apply:** Preserve unresolved references without fabricated authority.
Validate successful resolutions individually and test both an unused unresolved
entry and an executed reference to it. This does not waive structural,
integrity, or authorization checks.

Publication validation must use the exact portable artifact's declaration
contract, not destination lookup results. Verify the real Save preflight and
final-plan checks whenever changing binding diagnostics.

**Why:** An informational audit previously concealed a separate Save gate that
still demanded resolved GTs and rejected valid permissionless Thread imports.
Passing the audit alone did not prove that saving worked.

**How to apply:** Cover unresolved dependencies and permissionless Thread
imports through both publication checks, alongside identity, permissions,
row-count and injected-GT rejection. Keep destination validation strict.

All new compiler/save profiles use NULL (zero) plus integrity-covered row-zero
SELF E relocation. Historical compiler markers remain readable under their
existing authenticated provenance; they are not architectural SELF tokens.

**Why:** SELF is the owner GT. Before placement, existing NULL relocation rules
express the lack of destination authority without inventing a slot or sentinel.

**How to apply:** Check browser and server symbolic guards together, including
the real isolated approval/publication path and injected-GT negative cases.

Canonical portable LUMPs must contain symbolic Self and unresolved dependency
rows. Local slots, sequences, and GTs are permitted only in a destination copy
after exact N, T, actual-byte full hash, identity hash, authorization, rights,
type, and live Namespace state all verify.

**Why:** Allowing a sidecar to assert hashes, or allowing a portable save to
carry an already-materialized GT, lets compiling-machine authority leak into a
transferable artifact and bypasses destination policy.

**How to apply:** Validate unresolved rows before legacy c-list validation,
derive candidates from verified bytes plus live Namespace records, and bind on a
private copy. Unresolved entries remain unresolved and fault only if referenced
during execution; do not require every relocation to succeed. Catalog/API
projections must preserve explicit grants, type, and authorization fail-closed.

The compiler must not populate destination Golden Tokens. The linking loader
owns their resolution for both bitstream boot-image construction and lazy loading.

The compiler's canonical dot-name identity rule applies to every referenced
object, including MMIO. Device shorthand, a fixed Namespace slot, or a physical
address must not substitute for the declared target identity in compiler output.

**Why:** The user explicitly requires the LUMP compiler to use a dot-name for
all objects, including MMIO; devices are not a naming exception.

**How to apply:** Preserve the declared device identity through compilation and
integrity coverage. Resolve it through destination linking, rather than guessing
a target from LED/UART shorthand or inventing a missing device pet name.

The user supplied `ide.UART` as an example of the required MMIO dot-name form.
Treat it as naming guidance, not blanket authorization to rename historical
artifacts or infer canonical names for other devices.

Qualified dot-names may contain numeric components, for example `ide.Thread.2`
and `ide.Thread.3`; do not impose a letter-first rule on every component.

**Why:** Numeric Thread components are legitimate object names, not missing
qualification or MMIO shorthand.

**How to apply:** Preserve those names exactly when validating compiler identities,
while still rejecting unqualified names and empty dotted components.

**Why:** The user explicitly assigns Golden Token materialization to the linking
loader, not the compiler; compilation must not import the compiling Namespace's
authority into a portable artifact.

**How to apply:** Keep symbolic declarations in compiler output. Validate and
materialize them only in the destination executable copy, preserving the saved
artifact and existing approval boundaries. Do not describe this agreed boundary
as proof that every current compilation and loading path already implements it.

LUMPs without a PetName must be recompiled by the programmer.

**Why:** The user explicitly requires programmer-owned recompilation, rather
than automatic migration of artifacts that lack a PetName.

**How to apply:** Do not invent a PetName from a filename, catalog entry, or
old slot, patch the original, or automatically recompile it. Preserve the
original for inspection and report that programmer recompilation is required
before assignment/reloading. Destination-local binding is not a substitute
for this requirement.

Binding snapshot identity must be consistent between explicit BIND and replay,
independent of extra diagnostic/provenance fields added during preparation.

**Why:** A preparation-only canonical-token annotation changed a snapshot key,
so replay missed an existing explicit binding and used unresolved SELF instead.

**How to apply:** Use the same complete selection graph, including selected
Lazy artifacts, for snapshot lookup. Residency controls body emission, not
whether selected artifacts contribute to binding identity.
