---
name: Prepared boot authority
description: Three-instruction boot consumes stored CR0; configuration and evidence cannot substitute runtime authority.
---

Only explicit preparation may change the boot Thread's layout-derived CR0 home.
Boot consumes the image through LOAD CR15, CHANGE CR12, CALL CR0. Browser
selection, factory defaults, and newer artifact revisions must not replace that
authority during reset, import, or passive boot.

For hardware publication only, at the user-approved **Prepare/Run** boundary, preparation resolves the
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

Private simulation preparation instead consumes the exact frozen saved Namespace
and artifact bytes. It must never choose a newer revision or publish normalized
rows. Review, configuration approval, and activation are distinct actions.
Simulation configuration approval is not hardware executable admission.

Run may bypass that optional private-review workflow: when nothing is active,
read and validate the exact saved image, bind its digest as saved-image execution
evidence (not an approval), and start. Resume an existing active machine without
reloading it. Never rebuild, publish, change drafts, select newer artifacts, or
touch hardware as part of one-click Run.

**Why:** The user explicitly approved replacing mandatory preparation/approval/
activation clicks with one-click Run of the already saved image.

**Why:** The saved design must remain unchanged while a programmer experiments
with a proposed combined layout; test evidence applies only to that configuration.

**How to apply:** Keep private preparation separate from legacy hardware
publication. Bind observed simulation results to the activated configuration,
not the current editor, library latest version, or subsequently saved table.

Private image validation must cover every selected artifact, including
non-entry residents, against the actual simulator loader's identity rules.
Unsupported object types must fail preparation, not disappear from its image.
Pair reset/reload provenance with exact image bytes, and prevent explicit
editor patches from retaining the old tested-configuration identity.

**Why:** Structural generation alone can produce images the loader rejects or
omit selected objects, while reset caches and editor patches can detach evidence
from the bytes it claims to describe.

**How to apply:** Exercise real-loader round trips and reset/patch boundaries;
normal architectural runtime writes remain part of simulation, not a new design.

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
contract. Missing or malformed cached bytes must not silently substitute factory
memory. Preparation freshness is not a simulator testing authorization gate:
the programmer may test existing structurally valid image bytes with a warning.
This does not authorize hardware deployment or rewrite the stored image.

**Why:** The user rejected IDE-imposed preparation and approval lockouts on
software testing; unrelated artifact drift must not disable Run/Step/Walk.
**How to apply:** Separate explicit preparation/publication from volatile
simulation. Preserve runtime ISA enforcement and identify the bytes actually
loaded; never promote a newer artifact merely because Run was pressed.