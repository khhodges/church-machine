---
name: Boot-image regeneration requires a SelfTest slot-6 manifest entry
description: generate_boot_image locates Boot.Abstr by manifest abstraction=="SelfTest" AND ns_slot==6; the canonical lump is registered under a different name, so full regeneration fails until the manifest is repaired.
---

The boot-image generator locates the Boot.Abstr body by searching the lump
manifest for an entry whose abstraction name is exactly "SelfTest" **and**
whose ns_slot is 6. The canonical SelfTest lump is registered under a
different abstraction name with a null slot, so end-to-end regeneration
always fails with "Boot.Abstr (SelfTest) lump not found" even though the
binary exists on disk.

**Why:** any work that needs a fresh boot image must either repair that
manifest entry first or patch the stored binary surgically (seals must go
through the generator's write_ns_entry path — never hand-set word2).

**How to apply:** before relying on boot-image regeneration (API endpoint or
auto-regen), confirm the manifest has a SelfTest entry at slot 6; otherwise
treat the stored image as the only source and patch in place.
