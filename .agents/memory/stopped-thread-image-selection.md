---
name: Stopped Thread image selection
description: Defines when the simulator may manually cycle among saved Thread memory images.
---

Manual Thread selection may cycle explicit saved images before or after boot while execution is stopped, but the UI must invoke the exact canonical CHANGE descriptor. Block the UI while Run or Walk is active. Because selection is CHANGE, invalid descriptors, CR homes, or executable identity at +18 raise an architectural fault during selection.

**Why:** The Namespace and static Thread bodies are already present before boot, but a second browser-only restore path drifts from decoded CHANGE. Deferring invalid entry faults also allowed bad saved images to become active. Preflight must fail before outgoing state changes, while pre-boot reset scratch must still never overwrite a valid saved Thread.

**How to apply:** Let UI controls choose the next configured slot and enforce the active-execution lock, then call ordinary CHANGE CR14 with no scheduler/save/defer flags. Canonical CHANGE skips outgoing persistence for reset scratch, requires explicit +18 authority, prevalidates atomically, and installs CR12 before restoring the saved image.