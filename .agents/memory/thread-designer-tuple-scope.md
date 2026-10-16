---
name: Thread designer tuple and rollback scope
description: User-directed extension of Thread design and its Alice acceptance example.
---

The Thread designer must cover the Tuple Store and rollback/checkpoint concepts, not only the Thread's register and stack layout. Use the Alice Save LUMP rejection as a concrete diagnostic and tuple-storage acceptance example.

**Why:** The user identified the unexplained browser-alert failure as an opportunity to test the tuple-store mechanism and explicitly requested extending the Thread designer.

**How to apply:** Connect source diagnostics to visible storage definitions and allocation review. Preserve Alice's intended authority boundaries; shared Thread storage is not automatically abstraction-private. Distinguish design reservations, runtime tuple edits, saved LUMPs, and continuation restoration. This scope direction does not resolve the outstanding checkpoint, running-bit, or hardware contracts.

Clarify privacy across abstractions, Threads, Namespaces, and Church Machines before assigning privacy labels to designer storage.

**Why:** The user explicitly requested clarification of privacy rules at all these levels after discussing the tuple-store extension.

**How to apply:** Separate containment, authority, lifetime, and administrative/debug access. Present unresolved policy as proposed, not as an existing hardware guarantee.

Namespace encapsulation supplies the enclosing Thread privacy boundary; Thread tuples do not themselves supply abstraction-to-abstraction privacy within that Thread.

**Why:** The user explicitly distinguished Namespace-guaranteed Thread privacy from tuple storage, which does not create the same encapsulation.

**How to apply:** Describe privacy relative to the boundary: Namespace-external versus within-Thread access. Do not imply that tuple naming, typing, or allocation creates an independent security boundary, or that Namespace encapsulation makes every Thread private from all peers within its Namespace. Keep architectural guarantees distinct from implementation qualification.
