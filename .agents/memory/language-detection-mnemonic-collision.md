---
name: Language-detection mnemonic-collision bug class
description: How CLOOMC++ compiler auto-detect (_detectEnglish/_detectCLOOMC) can misclassify raw CM assembly as a high-level language, and where that misdetection actually surfaces in the UI.
---

## The bug class

`cloomcCompiler.compile()`'s auto-detect heuristics score source text against
keyword/regex lists per language. Two failure modes recur:

1. **Mnemonic/verb collision** — `_detectEnglish()` scored lines containing
   CM ISA mnemonics (e.g. `CALL X.Y`, `LOAD`, `SAVE`) as English verbs,
   because English detection didn't first exclude lines matching the CM
   mnemonic shape. Fix: skip lines matching a CM-mnemonic regex before
   scoring English keywords.
2. **Generic-structural-keyword collision** — `_detectCLOOMC()` treated a
   bare `capabilities {` header line as a CLOOMC signal, but plain ISA
   assembly examples also declare a `capabilities { ... }` block. Fix: only
   trust the language-specific structural markers (`abstraction`, `method`)
   for CLOOMC detection, not headers shared with plain assembly.

**Why this matters beyond the obvious**: detection order also matters
(see `cloomc-detection-order.md`), but even correct *ordering* doesn't help
if an early, unrelated detector (English) fires first on mnemonic collision
before CLOOMC/Assembly are ever evaluated.

## Where misdetection actually surfaces (don't assume the "obvious" path)

The live UI has **two independent dispatch layers**, and a misdetection bug
in the compiler's internal auto-detect only matters if something upstream
routes source into it:

- `smartCompile()` (app-compile.js) does its own pre-check: if `langSelector`
  is `'assembly'` AND the source has no `^abstraction`/`^method` line, it
  calls `assembleAndLoad()` directly — `cloomcCompiler.compile()` is never
  invoked at all for plain ISA assembly examples in the normal case.
- `assembleAndLoad()` has an `isHighLevel` pre-check of its own (uses
  `_detectEnglish`/`_detectHaskell`/`_detectSymbolic`/`_detectPetName` +
  an abstraction regex — **not** `_detectCLOOMC`). If any of those wrongly
  returns true for a plain-assembly file, it wrongly routes into
  `cloomcCompiler.compile()`, which then fails/produces garbage
  ("stray CROCRO/CR0"-style tokens) instead of assembling cleanly.

So: a misdetection bug reported as garbled output from compiling a specific
*assembly-tab* example is caused by the `isHighLevel` gate in
`assembleAndLoad()`, not by `compileAndBuild()`. Only source classified as
non-`'assembly'` by `smartCompile()` (real CLOOMC++/English/Haskell/etc., or
assembly text containing `abstraction`/`method` lines) ever reaches
`compileAndBuild()`'s auto-save-to-lump / `#nsOpenLumpLink` token flow.

## Save-to-NS vs. Open-Lump token are two unrelated mechanisms

For plain assembly examples, "Compile" only assembles into memory; the user
must separately click **Save to NS** (`confirmSaveToNamespace()` →
`sim.saveToNamespace()`), which writes directly into the simulator's
in-memory namespace table. This call path does **not** hit `/api/lumps/save`
and does **not** set `window._editorLastSavedToken` — so `#nsOpenLumpLink`
staying disabled after a raw-assembly Save-to-NS is expected, by-design
behavior, not a bug. Only the CLOOMC++ `compileAndBuild()` path auto-saves a
LUMP and sets the token that enables Open Lump. Don't conflate "Open Lump
disabled" bug reports with this by-design gap without checking which compile
path (assembly vs. high-level) the repro actually used — check git history
of prior same-titled fixes for the exact repro before assuming.
