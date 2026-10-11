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
