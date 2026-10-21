---
name: Native dialog keyboard ownership
description: Keyboard ownership when native modal dialogs are stacked above IDE overlays.
---

Native modal dialogs must own Escape and Tab while open, ahead of the IDE's
custom overlay keyboard handler.

**Why:** The shared capture-phase overlay handler can consume the event before
the native dialog receives it, closing the underlying preview instead. A dialog
keydown handler alone does not prevent that conflict.

**How to apply:** Test nested dismissal with the underlying preview still open;
the shared overlay handler must defer to native modal keyboard handling.
