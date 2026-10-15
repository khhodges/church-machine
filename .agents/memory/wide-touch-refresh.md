---
name: Wide-screen touch refresh
description: Prevent pull-to-refresh in the wide-screen IDE without blocking touch scrolling.
---

The wide-screen IDE must not support swipe-down browser refresh.

**Why:** The user explicitly requested this touchscreen behavior to be disabled.

**How to apply:** Suppress vertical viewport overscroll refresh while preserving
normal panel scrolling and touch gestures; do not globally cancel touch events.
