---
name: Wide-screen touch refresh
description: Prevent pull-to-refresh in the wide-screen IDE without blocking touch scrolling.
---

All wide-screen IDE views must not support swipe-down browser refresh,
including standalone screens, not only the main simulator.

**Why:** The user repeated that this touchscreen behavior must be disabled on
all wide screens, not just the original large-desktop layout.

**How to apply:** Suppress vertical viewport overscroll refresh while preserving
normal panel scrolling and touch gestures; do not globally cancel touch events.

Verify both native browser overscroll and application-triggered reloads.
**Why:** A CSS-only fix passed its tests but the user still experienced refresh;
the application gesture was a separate refresh trigger. Simulate the gesture
through release (including a resize before a queued reload) when validating.
