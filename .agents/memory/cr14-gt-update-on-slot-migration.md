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

## Late boot-image arrival rule

If the asynchronous boot-image fetch finishes after fallback boot completed,
copying the real image into memory is insufficient: CR14 and CR11 still
describe the already-running fallback LUMP. Cache the accepted image, then
reset through the synchronous boot-image reset hook before allowing another
boot/CALL sequence.

**Why:** The fallback SelfTest allocation is 64 words, while the real SelfTest
descriptor is substantially larger. An otherwise-valid image can therefore
produce a CR14 RANGE fault at offset 64 when it arrives too late.

**How to apply:** Treat a late accepted image as a runtime-state replacement,
not merely a memory overlay. The reset hook must see the cached image before
B:05/B:07 derive the source and code capabilities.

Note: CR0 (the E-GT for dispatching methods) needs `{E:1}` — a different GT from CR14.
