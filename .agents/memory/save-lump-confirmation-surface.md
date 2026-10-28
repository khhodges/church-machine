---
name: Save LUMP confirmation surface
description: UX boundary for Save LUMP review, server-plan consequences, and browser-native dialogs.
---

The successful Save LUMP flow must use one IDE modal. That surface combines output profile, header, capabilities/audit, Namespace destination, permissions, the server-authored create/replace consequence, and final approval.

**Why:** Multiple IDE dialogs plus browser-native confirmations made one successful save feel like three unrelated operations. The user explicitly chose one combined happy-path surface and allowed native browser dialogs only for errors.

**How to apply:** Build a missing candidate directly from the Save LUMP command, open one combined review/destination modal, then show the server plan in that same modal before final approval. Do not add a happy-path `confirm()` or `alert()`.

The user additionally requires an immediately visible save-progress console
and blocked unrelated activity until the operation safely finishes. Keep
explicit approval/cancellation usable and show unknown commit outcomes
honestly, with incident recovery reachable.

**Why:** On 2026-10-28 the user reported long Save LUMP waits without feedback
and explicitly requested a console and activity blocking.

**How to apply:** Paint feedback before synchronous work, show actual stages
and elapsed time, and keep the console clear of approval and recovery
controls, including on small screens. This does not add another approval step.