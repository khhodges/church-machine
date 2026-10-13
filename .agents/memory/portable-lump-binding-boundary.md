---
name: Portable LUMP binding boundary
description: Security boundary between portable unresolved artifacts and destination-local capability materialization.
---

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