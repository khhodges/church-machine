---
name: Three-LUMP resident profile
description: The boot core has a named fixed-map profile for the three executable residents and remains extensible above the core.
---

The resident boot core is an explicit policy, not an inference from whichever manifest rows happen to be marked resident. The current core is SelfTest at slot 6, WukongCallHome at slot 7, and CapabilityTest at slot 10; slots 0–13 retain their fixed Namespace identities, while capacity above slot 13 remains available for extension.

**Why:** Manifest entries include immutable history and can contain duplicate or newer-looking locators. Selecting from that history implicitly can replace a deployed executable or silently reinterpret a fixed slot.

**How to apply:** Validate the complete fixed Namespace map and exactly three resident executable bindings before allocation. Resolve each selected body from the exact Namespace-state token and filename, require its approval, and keep the image/provenance transition atomic.