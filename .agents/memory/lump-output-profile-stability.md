---
name: LUMP output profile stability
description: Why repeated LUMP saves must retain the selected embedded-content profile.
---

Save all three linked variants for source-bearing compiler revisions: full source
for IDE editing, API-only for build/test, compact source for sharing. This
supersedes the earlier single-output preference policy. Preserve explicit
source-dependent ISA admission restrictions rather than bypassing them.

**Why:** The user explicitly requested retaining all three uses together instead
of disabling API-only to avoid source loss. Allocation changes across variants
are legitimate; the primary build artifact remains exact-byte authority.

**How to apply:** Commit the variants atomically; resolve editing source through
the exact revision's content-addressed bundle, never latest-by-name or primary
binary hash alone. Comment-only source revisions can have identical API-only
binaries but require distinct full-source siblings. Test the build bytes, not a
different source-bearing sibling. Never rewrite immutable historical artifacts.

Full source is the canonical editing input; API-only and compact are read-only
derivations, not co-equal editable records. Keep a shared revision identity and
separate binary/source hashes.

**Why:** The user's architectural review emphasized prevention by derivation.
Comment removal cannot reproduce the exact full-source seal, and generating
consistent variants does not prove compiler metadata semantics are correct.

**How to apply:** Require compact rebuild equivalence evidence before advertising
it as reproducible source; do not describe packaging equality as that proof.