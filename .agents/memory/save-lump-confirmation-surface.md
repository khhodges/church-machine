---
name: Save LUMP confirmation surface
description: UX boundary for Save LUMP review, server-plan consequences, and browser-native dialogs.
---

The successful Save LUMP flow must use one IDE modal. That surface combines output profile, header, capabilities/audit, Namespace destination, permissions, the server-authored create/replace consequence, and final approval.

**Why:** Multiple IDE dialogs plus browser-native confirmations made one successful save feel like three unrelated operations. The user explicitly chose one combined happy-path surface and allowed native browser dialogs only for errors.

**How to apply:** Build a missing candidate directly from the Save LUMP command, open one combined review/destination modal, then show the server plan in that same modal before final approval. Do not add a happy-path `confirm()` or `alert()`.