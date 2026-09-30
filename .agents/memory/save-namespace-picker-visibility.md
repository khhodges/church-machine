---
name: Save to Namespace picker visibility
description: Which Namespace slots the release-replacement picker displays and disables.
---

The Save to Namespace picker must list every committed Namespace slot, rather than starting at the user-allocation boundary. Only Boot.NS (slot 0) and Boot.Thread (slot 1) are protected. Every slot from 2 onward is equal and programmer-controlled; no named abstraction, Resident policy, historical token, or catalog role may create additional slot protection. Explicit replacements may begin at slot 2; New Entry allocation still uses the normal user-allocation boundary.

**Why:** The programmer explicitly controls all non-bootstrap Namespace membership through the IDE. Special protection for SelfTest, WukongCallHome, or CapabilityTest contradicted that model and blocked valid replacements.

**How to apply:** Read committed Namespace membership and names; never merge stale configuration labels, runtime caches, or saved catalog metadata into destination authority. Keep slots 0 and 1 visible but disabled and reject their replacement server-side. Do not infer protection from slot numbers 2+, names, tokens, load policies, or catalog membership. An explicit replacement retains the selected entry's physical LUMP location and must reject hardware-mapped entries that have no writable LUMP storage.

**Why this authority boundary matters:** Combining old labels and catalog entries made the Save dropdown appear to replace Alice and invent slots even though the saved Namespace was unchanged. Opening or cancelling a picker must remain read-only. Match existing destination ownership by exact saved binding, not stale display names; require an explicit choice if that binding has changed.