---
name: Prepared boot authority
description: Three-instruction boot consumes stored CR0; configuration and evidence cannot substitute runtime authority.
---

Only explicit preparation may change the boot Thread's layout-derived CR0 home.
Boot consumes the image through LOAD CR15, CHANGE CR12, CALL CR0. Browser
selection, factory defaults, and newer artifact revisions must not replace that
authority during reset, import, boot, or Run.

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