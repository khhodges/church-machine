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