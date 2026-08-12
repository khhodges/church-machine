---
name: Wukong NS base is not ISA-safe at zero
description: The standalone Wukong image places Boot.NS at DMEM byte 0, but the ISA/platform contract reserves the high-memory namespace region
---

The standalone Wukong boot image currently overrides the architectural namespace-root location to `0x0000`. That is a bring-up shortcut, not a safe V20 ISA layout: address zero is treated as a null-base condition in architectural paths, while the A7 v1.2 `NS_TABLE_BASE` is `0x1FC00` (the reserved top region of a 128 KiB address space). The current Wukong DMEM is only 64 KiB, so the image has an unresolved memory-map conflict.

**Why:** M-elevated boot tests can pass with the zero-base shortcut, but normal ISA operations and null-base guards do not establish that zero is a legal namespace root. A new factory image must not inherit this contradiction.

**How to apply:** Before a V20 build, either expand Wukong DMEM/address plumbing to honor the ISA base `0x1FC00`, or formally choose and propagate a documented Wukong-specific top-of-64-KiB base (if the ISA permits it). Keep the global c-list at `0x0400` only after checking it against the selected platform map. Fixing Thread.caps[0] to WukongCallHome is independent of this decision.