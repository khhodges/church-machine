---
name: Thread designer tuple and rollback scope
description: User-directed extension of Thread design and its Alice acceptance example.
---

The Thread designer must cover the Tuple Store and rollback/checkpoint concepts, not only the Thread's register and stack layout. Use the Alice Save LUMP rejection as a concrete diagnostic and tuple-storage acceptance example.

**Why:** The user identified the unexplained browser-alert failure as an opportunity to test the tuple-store mechanism and explicitly requested extending the Thread designer.

**How to apply:** Connect source diagnostics to visible storage definitions and allocation review. Preserve Alice's intended authority boundaries; shared Thread storage is not automatically abstraction-private. Distinguish design reservations, runtime tuple edits, saved LUMPs, and continuation restoration. This scope direction does not resolve the outstanding checkpoint, running-bit, or hardware contracts.
