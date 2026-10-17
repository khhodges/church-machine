---
name: Namespace save layout versus identity
description: Keep rebuilt descriptor changes separate from selected artifact substitution.
---
Composite preparation must bind decoded metadata to the candidate raw image
and compute provenance from the final metadata, all under one rollback boundary.
Raw-only publication must still invalidate that binding.

**Why:** Treating a prepared image as a raw-only write removed the binding
immediately after preparation, so the subsequent approval rejected it. Binding
against the previous image would instead retain a stale fingerprint.

**How to apply:** Test confirmed preparation through immutable approval capture
in private storage, as well as missing/mismatched-binding rejection and rollback.
Do not fix this by retroactively trusting unbound historical state at freeze.

Treat physical layout normalization separately from artifact selection. Preserve
the submitted image for ordinary unchanged saves; do not bypass validation to
avoid a rebuild when no valid image is available. Ordinary boot generation must
preserve approved resident body addresses or fail explicitly, not silently
compact them.

**Why:** An unchanged selection can require different locations and limits when
projected through current build settings and artifact allocations. Its descriptor
seal then necessarily changes, without changing the selected artifact hash,
filename, token, slot, sequence, or boot target.

**How to apply:** Explain regeneration before Save and test consecutive unchanged
saves in private runtime state. Compare artifact identity and descriptor layout
separately. Keep address preservation independent of simulator-only profile
validation; enabling it must not weaken hardware admission.

Step-2 compatibility rows repeat Namespace allocations, not competing copies.
Check occupied intervals rather than treating the high-water address as occupied.

**Why:** Noncompact preservation raises that address above valid gaps and even
above the resident repeated by Step-2, causing false overlap failures.

**How to apply:** Accept exact same-slot claims while checking full artifact
allocations against other slots, regardless of a client's shorter size hint.

Refresh Image explicitly compacts RAM-backed LUMPs in ascending assigned slot order after the Namespace header, leaving free space before the high-address table. Ordinary Save is still not compaction.

**Why:** The user explicitly requested gap-free packing on Refresh Image rather than preservation of physical placement.

**How to apply:** Stage new saved addresses/seals, boot-entry location, image, and provenance as one reviewed recoverable transaction. Keep slots, generations, artifact identities and MMIO addresses unchanged; never modify running memory. Reject insufficient capacity before publication. Capacity inspection reconstructs saved placement without triggering compaction.