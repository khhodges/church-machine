---
name: Boot-entry UI authority
description: Default Code View must follow the boot slot embedded in the loaded image, not the pending browser selection.
---

The simulator's loaded image is the authority for which LUMP carries the Lightning Bolt. A localStorage boot-slot value can be a pending UI selection from a previous session and may differ from the image currently loaded; browser tests and UI resolution must use `sim.bootEntrySlot` after the image is available.

**Why:** A stale pending slot caused a regression fixture to expect SelfTest at slot 6 while the active image selected CapabilityTest at slot 10, masking the actual startup behavior.

**How to apply:** Resolve the authoritative slot to catalog metadata, preserve populated editors and user tabs, and use a deterministic catalog stub that matches the loaded image's slot when testing automatic LUMP opening.