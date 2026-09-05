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

## Namespace save boundary

An invalidated browser boot-image cache does not mean the simulator's live
Namespace image is invalid. If the current simulator memory came from a
validated boot image, an explicit Namespace Save must serialize that live image
instead of regenerating from the server snapshot. Preserve sidecar locators
(token and canonical filename) for unchanged slot/name pairs.

**Why:** Saving build configuration before Namespace serialization can clear the
browser cache while leaving the user's selected slot locations and resident
LUMPs in live simulator memory. Regenerating at that point silently saves a
different Namespace and drops metadata that is not present in the four-word NS
entry.

**How to apply:** Track validated image provenance separately from the cached
browser buffer. Regenerate only when neither source is available, and merge
existing artifact bindings defensively at the server commit boundary.

## Build Approval validation boundary

Structural LUMP header decoding must remain independent from approval-ledger
membership. A valid released resident binary may be readable before a separate
approval record exists; report trust state separately rather than as bad magic.
Canonical SelfTest's extended-ISA terminal opcode 8 is an expected passing form.

**Why:** Treating missing approval as unreadable hid valid WukongCallHome
headers, while the generic opcode warning made the approved canonical SelfTest
look unresolved even though its current source and regression tests expect
opcode 8.

**How to apply:** Use binary structure for header/cw/cc display and reserve
approval checks for trust/build policy. Keep generic opcode checks strict, then
normalize only the canonical SelfTest validation path.