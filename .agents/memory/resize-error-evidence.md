---
name: Resize warning evidence
description: Distinguish native browser resize warnings from fatal application exceptions before changing layout code.
---

A native ResizeObserver warning with a null error object does not by itself prove a fatal application exception or identify the responsible observer.

**Why:** A reported editor crash persisted after callback-coalescing changes. Isolated editor interactions did not reproduce it, while a synthetic native resize loop emitted the same generic error and left the page interactive.

**How to apply:** Correlate actual interaction evidence and bounded observer attribution before assigning cause. Distinguish synthetic demonstrations from reproductions. Keep diagnostics visible, never blanket-suppress exceptions, and do not infer data loss from the warning alone.