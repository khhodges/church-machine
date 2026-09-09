---
name: Latest saved LUMP selection
description: Separates live execution identity from the artifact selected for editor and simulator loading.
---

The live CR14/Namespace token identifies what is executing now. It must not automatically become the editor or Run artifact when a newer saved revision exists for the same abstraction.

Choose the editor/Run artifact by highest saved LUMP version and then compilation time, including immutable-history rows. An `archived` marker describes storage history; it does not make an older boot-resident revision authoritative.

**Why:** Fixed boot-resident abstractions can retain an old non-archived manifest row while newer programmer saves are retained as immutable-history rows. Preferring the live or non-archived token makes Open in Editor and Run silently ignore the latest save.

**How to apply:** Keep execution banners tied to the exact live token. For repository, editor, and interactive simulator selection, resolve the live abstraction name to its latest saved revision unless the user explicitly selected a different exact revision.