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