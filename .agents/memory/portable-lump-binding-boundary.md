---
name: Portable LUMP binding boundary
description: Security boundary between portable unresolved artifacts and destination-local capability materialization.
---

## Simulator binding lifecycle

Resolve declared dot-names afresh when Bind Namespace Design is clicked; never
assume existing destination GTs are still correct. Run, Step and Walk must not
trigger rebinding or change the established bindings.

**Why:** The user rejected reuse of old bindings, confirmed that continuation
controls must preserve them, then moved the binding action to the renamed
Bind Namespace Design control instead of automatic load-time binding.

**How to apply:** Validate fresh destination bindings before execution and show
one movable, staggered overlapping inspection window per C-list, all together.
Show actual binding results, not inferred labels. Namespace edits during execution
must not silently relink the session. Binding reports alone are not executable
image activation or hardware certification.

Canonical portable LUMPs must contain symbolic Self and unresolved dependency
rows. Local slots, sequences, and GTs are permitted only in a destination copy
after exact N, T, actual-byte full hash, identity hash, authorization, rights,
type, and live Namespace state all verify.

**Why:** Allowing a sidecar to assert hashes, or allowing a portable save to
carry an already-materialized GT, lets compiling-machine authority leak into a
transferable artifact and bypasses destination policy.

**How to apply:** Validate unresolved rows before legacy c-list validation,
derive candidates from verified bytes plus live Namespace records, bind on a
private copy, and commit only after every relocation succeeds. Catalog/API
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