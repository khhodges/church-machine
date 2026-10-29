---
name: Experimental hardware correction composition
description: Separately validated hardware overlays must be explicitly composed into later candidates.
---

Do not assume a separately validated experimental correction has become part
of production source. Before packaging a later candidate, reconcile required
prior corrections against its actual frozen source and generated hardware.

**Why:** A continuation candidate copied production sources while the validated
startup initializer correction remained a separate overlay. Amaranth recovery
and routed timing passed, but the physical startup showed evidence consistent
with the older initializer's known first-fetch failure.

**How to apply:** Explicitly list included/excluded experimental corrections.
Preserve the approved image and validate the combined full-design vendor
mapping; prior isolated passes do not transfer automatically. Inspect first
and last initialization writes, not only embedded ROM contents. See
reports/continuation-startup-investigation.md for the evidence and its limits.

The user approved preparing an isolated package combining these two corrections,
with the same approved image. This does not authorize production initializer
replacement, live Namespace edits, bitstream generation or board programming.

**Why:** Package preparation and validation are separate from adopting or flashing
a replacement. Preserve that boundary until the user explicitly expands it.
