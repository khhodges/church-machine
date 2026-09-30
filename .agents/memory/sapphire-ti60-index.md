---
name: Sapphire and Ti60 build lessons
description: Topic index for platform-specific ROM, BRAM, and firmware pipeline constraints.
---

Consult these lessons before changing Sapphire/Ti60 firmware or its build pipeline:

- [ROM iBus/dBus conflict](sapphire-rom-bram-dbus-hang.md)
- [EFX_MAP readmemb resolution and VDB caching](efx-map-readmemb.md)
- [Sapphire BRAM initialization variants](sapphire-bram-init-variant.md)
- [BRAM guard false-positive modes](sapphire-bram-guard-false-positive.md)
- [Ti60 firmware update pipeline](ti60-firmware-update-pipeline.md)

**Why:** Vendor-specific initialization behavior can make a superficially successful build stale or nonfunctional.

**How to apply:** Follow the linked constraint relevant to the target/toolchain, confirming its applicability to current code and tool versions.