---
name: IRQ LUMP lazy-load gate — manifest guard
description: Lazy-load body gate in _fireSchedulerIRQ must check lazyManifest[slot] exists or test harnesses that pre-seed irqLumpSlot get unexpected lazyLoad crashes.
---

# IRQ LUMP lazy-load gate — manifest presence guard

## The rule
The v1.2 §4 lazy-load body gate in `_fireSchedulerIRQ()` is guarded by `this.lazyManifest && this.lazyManifest[_schedulerSlot]`. If no manifest entry exists for the slot, the gate is skipped entirely — the dispatcher falls through to the abstractionRegistry path instead.

**Why:** When a test harness pre-seeds `irqState.irqLumpSlot = 8` (to skip lazy registration and use its own manually-configured NS slot), the lazyManifest entry for slot 8 is never populated. If the gate fired anyway, it would call `lazyLoad(8)` which crashes on `lazyManifest[8].loaded` (undefined). By gating on manifest presence, test harnesses bypass the LUMP body check and rely on abstractionRegistry directly.

**How to apply:** Any future code that adds a lazy-load gate for a dynamic slot must include `&& this.lazyManifest[slot]` in the condition. Also: `makeTestSim()` in `test_fault_recovery.js` seeds `sim.irqState.irqLumpSlot = 8` alongside `nsLabels[8]` so lazy `_preRegisterIrqLump()` is not triggered mid-test (which would overwrite the test's manually-configured NS entry at slot 8 or pick slot 9 when word1 ≠ 0).

See also: docs/CM_LUMP_SPECIFICATION.md — Developer Traps and Implementation Rules section.
