---
name: Tier-3 boot recovery slot redirect
description: After _returnToBoot() clears bootComplete while preserving memory, boot paths must use _bootAbstrSlot not bootEntrySlot or B:05 RANGE-faults on an empty gap slot.
---

## The Rule

All four boot entry points — `stepSim()`, `runSim()`, `instantBoot()`, `slowBoot()` — must save `sim.bootEntrySlot`, set it to `sim._bootAbstrSlot` before calling `_bootStep()`, and restore it after. Never let `_bootStep()` run with the user-selected slot during the boot loop.

## Why

`_returnToBoot()` (called by Tier-3 `_fastBoot(2)`) sets `bootComplete=false` and clears CRs/DRs but **does NOT reload the boot image** — memory is preserved. The lump the user loaded (e.g. LEDFlash) lives in NS slot 6 (`_bootAbstrSlot`). But `sim.bootEntrySlot` is the user's selection (e.g. slot 7, a gap slot with limit17=0). When `_bootStep` B:05 INIT_ABSTR runs, it calls `mLoad(NS[bootEntrySlot])` — if that's a gap slot, limit17=0 → RANGE fault "[0x0001] outside [0x0000..0x0000]".

## How to Apply

Wrap every `_bootStep()` call site:

```javascript
const _saved = sim.bootEntrySlot;
sim.bootEntrySlot = sim._bootAbstrSlot;   // always 6 (SelfTest), set at constructor
try {
    sim._bootStep();
} catch(e) {
    sim.bootEntrySlot = _saved;
    throw e;       // or handle
}
sim.bootEntrySlot = _saved;
// now call _autoLoadDefaultProgram() — it needs the user's selection restored
```

For `slowBoot()`, capture `_saved` in the `slowBoot()` scope (closure); restore at the start of the boot-complete branch and the catch branch inside `nextPhase()`.

`_bootAbstrSlot` is set once at construction from the default `bootEntrySlot = 6` and is never mutated. It always equals the SelfTest slot — the only slot guaranteed to be present after `_returnToBoot()` (memory preserved).
