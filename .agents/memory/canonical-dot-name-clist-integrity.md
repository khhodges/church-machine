---
name: Canonical dot-name LUMP identity and c-list integrity
description: Every LUMP uses dot.name.1.token identity, and compilation data including dot-name c-list entries is covered by the LUMP integrity value.
---

Every LUMP must have a canonical identity in the form `dot.name.1.token`. The dot name is not optional metadata: it is part of the LUMP's identity.

The compiled artifact must preserve the C-list in dot-name form, and the LUMP integrity value must cover the compilation data together with that dot-name C-list data. A LUMP whose compiled bytes or dot-name C-list changes must receive a different integrity token.

The C-list row 0 must contain the LUMP's `SELF` name. That row is read-only compiled identity data and is included in the LUMP integrity calculation. The lazy loader is responsible for converting 32-bit Outform tokens into Inform GTs at runtime; it must not rewrite the compiled SELF row or treat the token as the canonical name.

**Why:** Numeric GTs, slots, and catalog records are local or mutable; they cannot independently prove which named compilation and capability set produced a LUMP.

**How to apply:** Validate the canonical dot-name identity and recompute integrity from the complete compiled representation, including the read-only SELF row and dot-name C-list content. Resolve Outform tokens to Inform GTs only in the lazy-loader/runtime path. Do not trust a manifest token, slot, sidecar, or numeric GT as a substitute for this check.