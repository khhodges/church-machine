---
name: Boot-entry UI authority
description: Default Code View must follow the boot slot embedded in the loaded image, not the pending browser selection.
---

The simulator's loaded image is the authority for which LUMP carries the Lightning Bolt. A localStorage boot-slot value can be a pending UI selection from a previous session and may differ from the image currently loaded; browser tests and UI resolution must use `sim.bootEntrySlot` after the image is available. Open the LUMP when the validated image arrives, even if automatic boot is disabled, and do not let automatic startup execution redirect Code View to Dashboard.

**Why:** A stale pending slot caused a regression fixture to expect SelfTest at slot 6 while the active image selected CapabilityTest at slot 10, masking the actual startup behavior. Separately, the startup runner immediately redirected to Dashboard after opening the LUMP, and the no-auto-boot path never reached the opener.

**How to apply:** Resolve the authoritative slot to catalog metadata, replace old generic snapshots or built-in examples, preserve active user tabs/source owners and text typed during loading, and use a deterministic catalog stub that matches the loaded image's slot when testing automatic LUMP opening.