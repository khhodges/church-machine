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

LUMPs without a PetName must be recompiled by the programmer.

**Why:** The user explicitly requires programmer-owned recompilation, rather
than automatic migration of artifacts that lack a PetName.

**How to apply:** Do not invent a PetName from a filename, catalog entry, or
old slot, patch the original, or automatically recompile it. Preserve the
original for inspection and report that programmer recompilation is required
before assignment/reloading. Destination-local binding is not a substitute
for this requirement.