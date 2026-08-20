---
name: CR14.word0 GT update required on NS slot migration
description: When _applyPendingSimLoad changes sim.bootEntrySlot and loadProgram patches CR14.word1/word2/word3, CR14.word0 (the GT) is NOT updated — causing _fetchInstruction mLoad('X') bounds check to fail against the old lump.
---

## Direct program-load rule

After a direct Compile + Run path changes `sim.bootEntrySlot` and calls
`sim.loadProgram()`, it must also update `sim.cr[14].word0` to a fresh R+X GT
for the new slot. Without this, every instruction fetch faults before
`stepCount++` (stepCount stays 0).

**Why:** `_fetchInstruction` (simulator.js) does:
```javascript
const fetchAddr = cr14.word1 + 1 + this.pc;
const check = this.mLoad(cr14.word0, 'X', 14, fetchAddr);
```
`loadProgram()` updates `cr14.word1/word2/word3` (the lump base/seals) but NOT `cr14.word0` (the GT). If word0 still holds the old slot's GT, the `mLoad` bounds check fails because `fetchAddr` is outside that old lump's range. The fault fires before `stepCount++` is reached → stepCount stays 0.

**How to apply:**
```javascript
// After sim.loadProgram(_aplWords, 0):
if (_progSlot !== null && sim.bootComplete && sim.cr[14]) {
    const _cr14GT = sim.createGT(0, _progSlot, {R:1,W:0,X:1,L:0,S:0,E:0}, 1) >>> 0;
    sim.cr[14].word0 = _cr14GT;
    sim.cr[14].m = 0;
}
```
## Boot/CALL rule

CR14 does not have a dedicated Namespace slot.  In the boot path, NUC_CODE
uses CALL semantics: it validates the selected boot-entry Namespace descriptor
and derives the R+X CR14 capability from that same source entry.  Ordinary CALL
does the same from its source E-GT.

**Why:** Replaying cached editor source through `loadProgram()` after boot can
mutate the selected boot LUMP's header and Namespace limit.  A later CALL then
correctly creates CR14 from that now-corrupt descriptor, producing a misleading
fetch RANGE fault even though CR14 was not independently minted incorrectly.

**How to apply:** Never rewrite the selected boot LUMP as a reset side effect.
Keep cached source in the editor until an explicit user action installs or runs
it.  When diagnosing boot fetch faults, validate the CALL source E-GT and its
Namespace entry before changing CR14.

Note: CR0 (the E-GT for dispatching methods) needs `{E:1}` — a different GT from CR14.
