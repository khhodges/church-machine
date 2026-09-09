---
name: Latest saved LUMP selection
description: Separates live execution identity from the artifact selected for editor and simulator loading.
---

The live CR14/Namespace token identifies what is executing now. It must not automatically become the editor or Run artifact when a newer saved revision exists for the same abstraction.

Choose the editor/Run artifact by most recent compilation date and time, including immutable-history rows. Use LUMP version only to break equal-timestamp ties. An `archived` marker describes storage history; it does not make an older boot-resident revision authoritative.

**Why:** Compilation time records which code was produced most recently even when imported, restored, or boot-resident artifacts have misleading version numbers. Preferring version, live identity, or non-archived status can silently select older code.

**How to apply:** Keep execution banners tied to the exact live token. For repository, editor, and interactive simulator selection, resolve the live abstraction name to its latest saved revision unless the user explicitly selected a different exact revision.