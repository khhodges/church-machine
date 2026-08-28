---
name: Thread capability homes are fixed
description: Preserves the canonical saved-Thread layout when runtime credentials are minted.
---

Saved Thread images always reserve exactly twelve capability homes for CR0–CR11 at offsets +244 through +255. Runtime-minted credentials belong in runtime/virtual bookkeeping and must not be appended to this region or represented by increasing the Thread header's capability count.

**Why:** Boot-time PassKey minting once expanded the resident Thread header and wrote into its tail. A header-field typo also collapsed a valid 512-word Thread into a 64-word body, but correcting only that typo would still violate the fixed saved-Thread ABI.

**How to apply:** Any boot or runtime feature that creates credentials must keep the Thread header and its twelve persisted CR homes byte-for-byte stable. Test this after the complete boot sequence, not only after initial image load.