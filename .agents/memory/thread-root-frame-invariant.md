---
name: Thread root-frame invariant
description: Canonical root-frame ownership and direct-run activation for Thread images.
---

Every fresh or generated Thread image must contain its two-word root CALL frame in advance: an Inform E-GT companion plus a packed frame with NIA `0x7FFF`, SZ=1, and saved STO equal to the stack end. The protected indicator names the active position two words below that frame. Boot.Thread, Thread.2, and Thread.3 are all static boot-resident contexts with `load_policy=Resident`; none may be lazy or dynamically allocated.

**Why:** UI-specific sentinel creation allowed Compile+Run and booted execution to disagree, and a null CR12 caused direct runs to fail before the program could start.

**How to apply:** Treat the protected Thread image as frame authority. Direct execution may validate and activate Boot.Thread transactionally, but must not manufacture a second sentinel or fall back to overwriting the prepared boot-entry LUMP. Preserve explicit Resident metadata for all three Thread rows.