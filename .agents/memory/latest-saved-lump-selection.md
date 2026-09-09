---
name: Latest saved LUMP selection
description: Separates live execution identity from the artifact selected for editor and simulator loading.
---

The live CR14/Namespace token identifies what is executing now. It must not automatically become the editor or Run artifact when a newer saved revision exists for the same abstraction.

Choose the editor/Run artifact by most recent compilation date and time, including immutable-history rows. Use LUMP version only to break equal-timestamp ties. If the newest artifact fails binary or canonical identity validation, keep it selected and present a prominent fault; never silently substitute an older valid revision.

**Why:** Compilation time records which code was produced most recently even when imported, restored, or boot-resident artifacts have misleading version numbers. Silently falling back from an invalid newest artifact hides a capability-integrity fault and misrepresents older code as current.

**How to apply:** Keep execution banners tied to the exact live token. Resolve repository, editor, and simulator defaults to the latest saved revision. Block invalid bytes fail-closed and show the server validation reason as a programmer-visible fault.