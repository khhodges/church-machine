---
name: Stopped Thread image selection
description: Defines when the simulator may manually cycle among saved Thread memory images.
---

Manual Thread selection is a saved-memory-image operation, not a boot-dependent operation. Allow cycling among configured Thread images before boot, after boot, while reset, or while paused. Block it only while execution is actively running or when fewer than two saved Thread images exist.

**Why:** The Namespace and static Thread bodies are already present in the uploaded memory image. Requiring the boot ceremony before selecting one unnecessarily prevents inspecting and choosing saved contexts.

**How to apply:** Keep the toolbar enablement rule and the simulator-side switch guard aligned. Neither may require `bootComplete`; both must retain the active-execution lock.