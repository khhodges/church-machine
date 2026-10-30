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
with the same approved image. After both validation runners passed, the user
approved proceeding with a build-only runner using the validated synthesized
checkpoint for implementation and experimental bitstream generation. This does
not authorize production initializer replacement or live Namespace edits.
After verifying the combined BIT against its build receipt and the Windows
transfer, the user separately approved temporary FPGA programming. That approval
does not include persistent flash writes, changed images, or automatic fault
recovery commands.

**Why:** Validation and experimental build preparation are separate from adopting
or flashing a replacement. Preserve that boundary until explicitly expanded.

The operator also approved build-only implementation of the UART packet-atomic
correction after its exact-image recovery and vendor-mapped startup passed.
Use that correction's verified checkpoint and unchanged approved image.

**Why:** Approval to proceed with the next build is not approval to program the
physical board again. The earlier temporary-programming approval was exercised
on the earlier candidate, not on every subsequent revision.

**How to apply:** Keep prior frozen candidates intact, carry the exact local
recovery evidence alongside the matching remote synthesis evidence, and request
separate approval before any replacement programming or flash operation.
