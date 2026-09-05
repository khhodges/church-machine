---
name: LUMP save and boot-image rebuild boundary
description: Separates exact artifact approval from rebuilding a composite boot image.
---

An exact, user-approved LUMP save commits its artifact, approval, manifest, and
Namespace binding even when the optional whole boot-image refresh fails because
of an unchanged foundational LUMP. Report the deferred refresh and leave the
existing image subject to normal stale-image rejection; do not reinterpret the
failure as a request to approve the unrelated foundation.

**Why:** A CapabilityTest replacement exposed a stale boot image and then an
unapproved unchanged SelfTest. Rolling the CapabilityTest transaction back made
the operation appear to be a SelfTest approval request, despite the user having
approved only CapabilityTest.

**How to apply:** Keep save-plan and approval-intent checks scoped to the exact
artifact being mutated. Treat composite boot-image generation as a separate
authority transition whose failure is surfaced without revoking the completed
artifact save.