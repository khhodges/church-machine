---
name: Namespace save layout versus identity
description: Keep rebuilt descriptor changes separate from selected artifact substitution.
---
Treat physical layout normalization separately from artifact selection. Preserve
the submitted image for ordinary unchanged saves; do not bypass validation to
avoid a rebuild when no valid image is available.

**Why:** An unchanged selection can require different locations and limits when
projected through current build settings and artifact allocations. Its descriptor
seal then necessarily changes, without changing the selected artifact hash,
filename, token, slot, sequence, or boot target.

**How to apply:** Explain regeneration before Save and test consecutive unchanged
saves in private runtime state. Compare artifact identity and descriptor layout
separately, then assert byte stability after normalization.

Refresh Image explicitly compacts RAM-backed LUMPs in ascending assigned slot order after the Namespace header, leaving free space before the high-address table. Ordinary Save is still not compaction.

**Why:** The user explicitly requested gap-free packing on Refresh Image rather than preservation of physical placement.

**How to apply:** Stage new saved addresses/seals, boot-entry location, image, and provenance as one reviewed recoverable transaction. Keep slots, generations, artifact identities and MMIO addresses unchanged; never modify running memory. Reject insufficient capacity before publication. Capacity inspection reconstructs saved placement without triggering compaction.