---
name: SelfTest Next follows LightningBolt
description: The SelfTest continuation capability is defined by the selected LightningBolt boot entry.
---

SelfTest C-List row 1 (`Next.GT`) must always target the same Namespace slot as
the selected ⚡ LightningBolt boot entry. It is not an independently configurable
continuation and must never silently fall back to a separate persisted target.

**Why:** Thread.CR0 and SelfTest's post-success continuation must dispatch to the
same selected abstraction. Separate settings can diverge and make the visible
continuation label disagree with the generated boot image.

**How to apply:** Whenever the LightningBolt entry changes, update the live
SelfTest C-List row 1. Boot-image generation and simulator initialization must
derive row 1 from the selected boot-entry slot; reject or ignore legacy
independent Next-target configuration. After reset, reapply the persisted
LightningBolt selection to the simulator; never sync a temporary factory
SelfTest slot back into the user's selection.

Build Approval may show LightningBolt in the same per-slot selector, but it is
a synthetic boot-role choice: selecting it persists only `bootEntrySlot`, while
Empty/Resident/Preload/Lazy continue to persist as the slot's independent
`step2` load policy.

**Why:** The approval table needs one discoverable control without turning the
boot role into a conflicting fifth load policy.

**How to apply:** Keep the active boot row visibly marked as
`LightningBolt (boot entry · <load policy>)`; changing its load policy must not
silently move the boot entry.