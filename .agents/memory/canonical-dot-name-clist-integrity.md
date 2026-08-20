---
name: Canonical dot-name LUMP identity and c-list integrity
description: Every LUMP uses dot.name.1.token identity, and compilation data including dot-name c-list entries is covered by the LUMP integrity value.
---

Every LUMP must have a canonical identity in the form `dot.name.1.token`. The dot name is not optional metadata: it is part of the LUMP's identity.

The compiled artifact must preserve the C-list in dot-name form, and the LUMP integrity value must cover the compilation data together with that dot-name C-list data. A LUMP whose compiled bytes or dot-name C-list changes must receive a different integrity token.

**Why:** Numeric GTs, slots, and catalog records are local or mutable; they cannot independently prove which named compilation and capability set produced a LUMP.

**How to apply:** Validate the canonical dot-name identity and recompute integrity from the complete compiled representation, including dot-name C-list content. Do not trust a manifest token, slot, sidecar, or numeric GT as a substitute for this check.