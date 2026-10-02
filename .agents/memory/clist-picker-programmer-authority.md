---
name: C-List picker programmer authority
description: The capability picker must accept dynamic and future pet names, not only currently materialized LUMPs.
---

The C-List picker is a declaration tool, not an inventory gate. It must expose live and committed Namespace pet names while also allowing a programmer to declare a valid symbolic pet name before its abstraction exists or has a slot. The programmer chooses the save destination and replacement name for every Namespace slot, including slots 0 and 1; prior resident names do not own their slots.

**Why:** The programmer controls capability naming, replacement, and future binding. Requiring a current manifest record, duplicated slot metadata, or a hard-coded historical resident name incorrectly prevents valid Namespace use.

This applies to compilation, not just the picker: a declared PetName may reference an idea that could be created in the unknown future. Name-only external references are valid symbolic declarations, not an identity-completeness defect to eliminate. Do not require every declaration to carry an existing target's immutable ID or binary hash. Checking explicitly supplied identity claims is distinct from demanding such claims universally.

**Why:** The user explicitly corrected the proposed requirement to reject all name-only references: “Pet names can reference ideas for the unknown future that might be created one day.”

**How to apply:** Preserve future references through compile/save/export without inventing IDs or selecting catalog alternatives. Distinguish symbolic declarations from verified concrete bindings in reports without labeling the declarations invalid. Do not confuse a declared future reference with an automatically invented name for the containing abstraction.

**How to apply:** Treat Namespace state as authoritative when a name is bound, prefer live dynamic names over saved labels, and keep unbound names selectable as symbolic declarations. Emit unresolved non-SELF declarations as named pending GTs and let the runtime ISA resolve or fault them; compile-time registry absence alone must not block loading. Compile SELF as unresolved; after the programmer selects a destination, mint the destination-local SELF from that slot's live sequence. Recognize the reserved row by the `__SELF__` name and overwrite any browser-supplied GT, because fallback serialization may omit advisory ownership flags. Never reserve slots or infer ownership from names such as Boot.NS, Boot.Thread, CapabilityTest, or WukongCallHome. Bootstrap identity checks may run only when explicitly requested by the save payload, never because of the previous occupant.