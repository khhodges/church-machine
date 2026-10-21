---
name: LUMP output profile stability
description: Why repeated LUMP saves must retain the selected embedded-content profile.
---

Save all three linked variants for source-bearing compiler revisions: full source
for IDE editing, API-only for build/test, compact source for sharing. This
supersedes the earlier single-output preference policy. Preserve explicit
source-dependent ISA admission restrictions rather than bypassing them.

**Why:** Retaining all three uses together prevents source loss without
disabling API-only. Allocation changes across variants
are legitimate; the primary build artifact remains exact-byte authority.

**How to apply:** Commit the variants atomically; resolve editing source through
the exact revision's content-addressed bundle, never latest-by-name or primary
binary hash alone. Comment-only source revisions can have identical API-only
binaries but require distinct full-source siblings. Test the build bytes, not a
different source-bearing sibling. Never rewrite immutable historical artifacts.

Full source is the canonical editing input; API-only and compact are read-only
derivations, not co-equal editable records. Keep a shared revision identity and
separate binary/source hashes.

For caller-visible encapsulation, see [Black-box public API](black-box-public-api.md):
public contracts exclude implementation dependencies, while binding evidence stays intact.

Version inspection should expose all three forms together, with repeated version
clicks cycling Full → Compact → API focus, not selecting another revision.

**Why:** The user wants one comparison view opened from the V# cell, rather than
three separately navigated artifacts.

**How to apply:** Keep inspection read-only and bind every pane to the exact
revision bundle. Only the full-source form offers editor navigation.

**Why:** Derivation prevents independent source variants from drifting.
Comment removal cannot reproduce the exact full-source seal, and generating
consistent variants does not prove compiler metadata semantics are correct.

**How to apply:** Require compact rebuild equivalence evidence before advertising
it as reproducible source; do not describe packaging equality as that proof.

Full/compact equivalence must use the same exact dependency identities, not
whatever artifacts their names select later.

**Why:** Catalog movement can otherwise make a compact derivation appear to
change semantics even when only the selected dependency changed.

Profile selection during Format review must switch the displayed binary and
the captured save candidate together, including non-IDX1 drafts. This does not
authorize changing the server's linked-variant retention or build-primary policy.

**Why:** A visible profile control that silently ignores clicks cannot provide
an exact review of the selected artifact.

**How to apply:** Verify byte equality between each selected candidate and its
save snapshot; keep publication approval and compiler attestation mandatory.

Format review must bound each output profile independently. An oversized
embedded-source variant disables that choice, not an otherwise valid API-only
candidate. This does not waive publication's source-retention requirements.

**Why:** Exact source can be retained in the revision bundle independently of
the selected execution binary; rejecting every profile loses a valid save path.

**How to apply:** Show why a profile is unavailable, retain valid choices, and
recheck allocation after destination-name repacking as metadata can grow.

The RedISA replacement bitstream must use the small API-only executable LUMP
variants, not full-source or compact-source editing/sharing variants.

**Why:** The user explicitly reaffirmed this memory-saving requirement when
questioning the rebuild memory map. Successful full-source compilation is not
evidence that the correct hardware footprint has been selected.

**How to apply:** Verify the embedded profile of each exact selected executable
binary before freezing the map. Recalculate allocations, placements, bounds
and localized bindings from API-only bytes; keep source variants in the IDE.
Thread runtime allocations remain separate from executable content profiles.

## Whole-binary storage compression

The user agreed that a single lossless compression pass over the complete
LUMP makes sense for storage and transfer, with exact decompression before
validation, linking, and execution.

**Why:** One outer compression mechanism can cover code, API, source, and
padding without changing the recovered executable binary. This reduces file
size, not runtime memory allocation.

**How to apply:** The user authorized adoption while retaining old decompression.
Use whole-file compression for newly packaged LUMPs; keep legacy raw and
source-compressed files readable. Do not rewrite immutable history or change
the machine's word-addressable runtime format. Canonical execution storage and
hardware transport stay decoded. Keep file sizes distinct from runtime allocation.
