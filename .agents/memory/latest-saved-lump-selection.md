---
name: Latest saved LUMP selection
description: Separates live execution identity from the artifact selected for editor and simulator loading.
---

The live CR14/Namespace token identifies what is executing now. It must not automatically become the editor or Run artifact when a newer saved revision exists for the same abstraction. A History row synthesized from fleet telemetry may name a different active token; selection and preview must follow that exact token rather than the token of the panel that displayed the row.

Choose the editor/Run artifact by most recent compilation date and time, including immutable-history rows. Use LUMP version only to break equal-timestamp ties. If the newest artifact fails binary or canonical identity validation, keep it selected and present a prominent fault; never silently substitute an older valid revision.

**Why:** Compilation time records which code was produced most recently even when imported, restored, or boot-resident artifacts have misleading version numbers. Silently falling back from an invalid newest artifact hides a capability-integrity fault and misrepresents older code as current. Joining telemetry only by abstraction/version can display a real revision under an old token’s History panel; treating it as metadata-only makes valid source appear unselectable.

**How to apply:** Keep execution banners tied to the exact live token. Resolve repository, editor, and simulator defaults to the latest saved revision. For telemetry-only History rows, verify the telemetry token against the active repository record and use that token for current words, preview, and editor handoff. Block invalid bytes fail-closed and show the server validation reason as a programmer-visible fault.