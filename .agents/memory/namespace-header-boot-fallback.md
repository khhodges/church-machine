---
name: Namespace header boot fallback
description: Keeping simulator reset recoverable when a persisted boot selection names a dynamic or currently empty Namespace slot.
---

When constructing the physical Namespace header, prefer the selected boot entry, then a canonical resident boot abstraction, then Boot.NS. A missing selected descriptor is recoverable state, not a JavaScript exception.

**Why:** Persisted UI selection can outlive a dynamically loaded LUMP. Dereferencing the absent entry during reset crashes the entire artifact before normal boot-selection validation can report or repair the stale choice.

**How to apply:** Keep the user's selected slot unchanged, use a resident fallback only for header materialization, and let the normal boot-entry validation path decide whether execution can proceed.