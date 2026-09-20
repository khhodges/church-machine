---
name: Prepared boot authority
description: Three-instruction boot consumes stored CR0; configuration and evidence cannot substitute runtime authority.
---

Only explicit preparation may change the boot Thread's layout-derived CR0 home.
Boot consumes the image through LOAD CR15, CHANGE CR12, CALL CR0. Browser
selection, factory defaults, and newer artifact revisions must not replace that
authority during reset, import, or passive boot.

At the user-approved **Prepare/Run** boundary, preparation now resolves the
newest saved, admissible revision for the selected abstraction by default.
Retaining an older revision requires an explicit exact-artifact pin. This
supersedes the former explicit-revision-selection rule only at that boundary:
fetch, inspection, import, reset, and already-running execution never promote
or swap artifacts. CR0 remains preparation-owned and is committed with the
Namespace binding and generated image as one CAS transaction.

Validation/approval evidence is keyed to the exact artifact digest and never
transfers across revisions. Namespace identity and dependencies are validated
before publication. Any failure preserves the previous valid selection and
reports the actual rejecting gate. Generated identity defects belong to the IDE
and must not be presented as ordinary user identity/security mismatches.
Executable admission validates bytes and provenance; it is not proof that a
runtime test suite passed. Runtime-test/MTBF claims remain separately
digest-bound and are cleared rather than inherited when preparation changes a
revision.

**Why:** Synthetic boot-time target minting hid invalid saved capabilities and
made visible selection diverge from executable authority. The confirmed design
requires real rejection gates rather than repair.

**How to apply:** Preserve imported bytes and other Thread contexts; show
discrepancies explicitly. Preparation may couple destination-local SelfTest Next
but must not rewrite a suspended Thread's independent resume-frame Enter GT.
Keep reset/report events outside the three instruction retirements. Known
simulator ROM words are not hardware observations; absent GT/location evidence
stays null rather than becoming Namespace slot zero.

Commit provenance only after all authoritative config/Namespace inputs have
reached their final transaction state.

**Why:** A successful multi-file image save can immediately invalidate itself
when provenance or freshness timestamps describe the pre-save Namespace.

**How to apply:** Treat save success and subsequent boot readability as one
contract. Cached-image failure must block boot, never substitute factory memory.
Execution guards apply even if a synthetic standalone fallback has already set
`bootComplete`; accepted committed-image ownership is a separate requirement.