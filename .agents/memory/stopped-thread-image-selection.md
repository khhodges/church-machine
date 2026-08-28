---
name: Stopped Thread image selection
description: Defines when the simulator may manually cycle among saved Thread memory images.
---

Manual Thread selection is a saved-memory-image operation, not a boot-dependent operation. Allow cycling among configured Thread images before boot, after boot, while reset, or while paused. Block it only while execution is actively running or when fewer than two saved Thread images exist. Selection itself must not raise an architectural fault; entry validation faults belong to the first attempted instruction.

**Why:** The Namespace and static Thread bodies are already present in the uploaded memory image. Before boot, live registers are reset scratch state and must not overwrite the selected image. Users must be able to inspect even an incomplete saved context without executing it.

**How to apply:** Keep the toolbar and simulator guards aligned. Neither may require `bootComplete`; both retain the active-execution lock. Skip outgoing persistence when live state is pre-boot, defer invalid entry faults until Step/Run, and project the selected image’s five zones in CR12 even when its valid body base is word zero.