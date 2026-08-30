---
name: Thread object runtime authority
description: Defines the single-source-of-truth rule for suspended Thread execution state.
---

The Thread object is the runtime context object and the only authority for one Thread's suspended execution state. Do not add host-side maps, UI history, or cloned context records that duplicate NIA or machine context.

**Why:** Parallel context stores can drift from the Thread object and make switching display or restore a state that CHANGE did not actually save.

**How to apply:** CHANGE must save into and restore from the Thread object. Thread status UI must read dormant state from that same object; active state may read the currently installed live machine state.