---
name: Boot-entry UI authority
description: Default Code View must follow the boot slot embedded in the loaded image, not the pending browser selection.
---

The simulator's loaded image is the authority for which LUMP carries the Lightning Bolt. A localStorage boot-slot value can be a pending UI selection from a previous session and may differ from the image currently loaded; browser tests and UI resolution must use `sim.bootEntrySlot` after the image is available. Open the LUMP when the validated image arrives, even if automatic boot is disabled, and do not let automatic startup execution redirect Code View to Dashboard. Opening this default LUMP always enters saved-LUMP mode with its exact disassembly visible; a generic restored editor buffer must not suppress that open.

**Why:** A stale pending slot caused a regression fixture to expect SelfTest at slot 6 while the active image selected CapabilityTest at slot 10, masking the actual startup behavior. Separately, the startup runner immediately redirected to Dashboard after opening the LUMP, and the no-auto-boot path never reached the opener. The artifact list does not carry resident `ns_slot` bindings; those come from the boot-config catalog.

**How to apply:** Join the image-selected slot to `boot-config.lumpCatalog`, then resolve that exact token in the artifact list. Replace old generic snapshots or built-ins and show the immutable disassembly, while preserving explicitly owned user tabs, files, and dirty buffers. Make tests reflect the two real API shapes.