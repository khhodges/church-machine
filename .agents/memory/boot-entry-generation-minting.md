---
name: Boot-entry generation minting
description: Boot capabilities must use the selected Namespace descriptor’s live sequence.
---

Every GT created for the currently selected boot entry must take its sequence
from that entry's Namespace Word 1, including the E-GT in Thread.caps[0], the
boot E/L capabilities, and the R+X code capability.

**Why:** Reissuing an entry increments its descriptor generation without
changing its slot. A boot path that hardcodes sequence zero creates an
immediately stale credential and fails during INIT_ABSTR before any LUMP code
can run.

**How to apply:** Read W1[29:21] from the live entry at mint time; propagate
that same sequence through generic-image validation and Wukong-native image
projection rather than treating a slot number as sufficient identity.