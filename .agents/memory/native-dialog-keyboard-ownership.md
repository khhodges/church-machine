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

Protected-change review must also be an explicit temporary input owner under
the Save activity lock. Keep the rest of the IDE locked; restore the save's
lock when the review closes rather than unlocking the whole operation.

**Why:** The commit-stage lock intercepted even programmatic clicks at window
capture before document listeners could observe them. This was mistaken for
browser automation input failure until the user reproduced it.

**How to apply:** Test the review renderer and activity lock together, including
Confirm, Reject, Tab, Enter and Escape. When document event logs are empty,
inspect window capture guards before attributing the failure to the browser.
