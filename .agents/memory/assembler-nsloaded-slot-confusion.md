---
name: Assembler nsLoaded vs _capBlockSlots slot confusion
description: For 2-op LOAD/SAVE in assembler.js, nsLoaded[name] stores the destination CR register number, not the c-list slot index. Only _capBlockSlots[name] gives the correct c-list slot.
---

## The rule

In `simulator/assembler.js` LOAD (case 0) / SAVE (case 1): when encoding a 2-op `LOAD CRdst, Name` where `Name` is in `_capBlockSlots`, always use `_capBlockSlots[name]` directly as `imm`. Never fall through to `res.slot` when the name was already resolved via `nsLoaded`.

**Why:** `nsLoaded[name]` is set to the CR destination register number (e.g. 1 for CR1, 2 for CR2) when the assembler sees an earlier load of the same name. The second occurrence resolves via `nsLoaded` and returns `slot=1` (CR number) — not the c-list slot index. If that leaks into `imm`, the assembled instruction encodes c-list slot 1 even though `_capBlockSlots[name]` says the correct slot is 0. The lump validator then catches `slot >= cc` as out-of-bounds.

**How to apply:** The fix is in `assembler.js` around the `_capBlockSlots` check in LOAD/SAVE case blocks: the condition `if (!parts[3] && _capBlockSlots[name] !== undefined)` must use `_capBlockSlots[name]` as imm directly, not re-resolve through the generic path. This is surgical — 3-op forms and non-capBlock names are unaffected.

**Symptoms of the bug:** Save Lump button error "c-list slot N >= cc=M" on a lump that contains multiple LOADs of the same capBlock name (e.g. PostFlashSelftest: `LOAD CR1, SelfTest` then `LOAD CR2, SelfTest`).
