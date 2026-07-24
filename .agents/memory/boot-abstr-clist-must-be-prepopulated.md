---
name: Boot.Abstr c-list must be pre-populated
description: The simulator's boot path executes Boot.Abstr directly — no lazy GT injection occurs; the LUMP binary must have correct GTs baked in at compile time.
---

## Rule

`00000600.lump` (Boot.Abstr, NS slot 6) MUST be compiled with cc=1 and
c-list slot 0 = `0x4A000006` (SelfTest E-GT, JS simulator format).

**Why:** The simulator enters Boot.Abstr directly at boot (setting CR14 → the
lump, then fetching from it). It does NOT go through `_execCall` or
`_applyPendingSimLoad`, so the lazy-load c-list injection never fires.
A LUMP compiled with `DEMO_CLIST_SIZE=8` silently zero-fills all 8 c-list slots
→ first `LOAD CR1, SelfTest` returns 0x00000000 → NULL_CAP fault.

**How to apply:**
- Canonical source of truth: `4c7380cb.lump` (token for PostFlashSelftest,
  cc=1, c-list[0] = 0x4A000006). Both `00000600.lump` AND `SelfTest_v75.lump`
  must be byte-for-byte identical to it.
- GT format in LUMP c-lists is the **JS simulator format** (`createGT` output),
  NOT the Python `_abstract_gt_word` format. For E-GT at NS slot 6:
    - JS:     `0x4A000006`  ✓
    - Python: `0x80000600`  ✗
- The `lump-consistency` test reads the binary via the manifest's `filename`
  field (e.g. `SelfTest_v75.lump`), NOT the token file (`00000600.lump`).
  Updating only the token file leaves the consistency check reading the old binary.
