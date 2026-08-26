---
name: Save to Namespace picker visibility
description: Which Namespace slots the release-replacement picker displays and disables.
---

The Save to Namespace picker must list every populated or catalogued Namespace slot, rather than starting at the user-allocation boundary. Only Boot.NS (slot 0) and Boot.Thread (slot 1) are disabled in that picker. Explicit replacements may begin at slot 2; New Entry allocation still uses the normal user-allocation boundary.

**Why:** Hiding lower-numbered slots made valid existing releases impossible to find and prevented the programmer from choosing the intended replacement target.

**How to apply:** Merge live Namespace entries, persisted labels, and catalog metadata for all valid slot numbers. Keep slots 0 and 1 visible but disabled. An explicit replacement retains the selected entry's physical LUMP location and must reject hardware-mapped entries that have no writable LUMP storage.