---
name: Simulator reboot-path _defaultProgramLoaded drift
description: Why "Open Lump" (and similar last-compiled-state links) can silently point at the wrong lump after certain reboot paths in the S-IDE simulator
---

There are 4 near-duplicate "reboot the simulator" functions in `simulator/app-run.js`:
`resetSim()`, `resetAndStep()`, `faultModalReboot()`, `faultClear()`. All call
`sim.reset()` and eventually `_autoLoadDefaultProgram()`.

`_autoLoadDefaultProgram()` branches on the module-level `_defaultProgramLoaded`
flag: if true, it reloads `lastAssembledWords` (the user's own program); if
false, it takes the cold-start path and calls `loadExample('capability_test')`,
which wipes editor context including `window._editorLastSavedToken` (via
`clearPseudoEditContext()`).

**Why this matters:** a prior fix removed `_defaultProgramLoaded = false` from
`resetSim()`/`resetAndStep()` (with an explanatory comment) so reboot reloads
the user's program instead of silently swapping in the built-in example. But
`faultModalReboot()` and `faultClear()` still had the same stale line —
they were never updated in lockstep. Any UI element that caches
"last compiled" state (e.g. the Next Steps panel's "Open Lump" link, which
reads `_editorLastSavedToken`) then falls through and shows the wrong
data after those two specific reboot paths, while looking fine after the
other two — a very confusing, path-dependent bug to reproduce.

**How to apply:** when fixing a bug in one of a family of near-duplicate
functions (especially "reset/reboot/clear" style handlers), grep for the
literal buggy pattern across the whole file/family before declaring victory —
don't assume a fix in the function you tested covers its siblings. Also:
functions that consume durable "last saved / last compiled" globals should
fail closed (do nothing) rather than fall through to a live/default state
when that global is unexpectedly null — see `_openLastCompiledLump()` in
`simulator/app-misc.js`.
