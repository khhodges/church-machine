---
name: Save to Namespace picker visibility
description: Which Namespace slots the release-replacement picker displays and disables.
---

The Save to Namespace picker must list every populated or catalogued Namespace slot, rather than starting at the user-allocation boundary. Only Boot.NS (slot 0) and Boot.Thread (slot 1) are disabled in that picker.

**Why:** Hiding lower-numbered slots made valid existing releases impossible to find and prevented the programmer from choosing the intended replacement target.

**How to apply:** Merge live Namespace entries, persisted labels, and catalog metadata for all valid slot numbers. Keep slots 0 and 1 visible but disabled; preserve save-path validation as the authoritative enforcement point.