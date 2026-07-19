---
name: LUMP Viewing label sync
description: Why _updateLumpViewingLabel must be called directly in renderLumps(), not only via showLumpDetail
---

# LUMP Viewing label sync

## The rule
`_updateLumpViewingLabel(token)` must be called directly inside `renderLumps()` immediately after the `showLumpDetail` call whenever `_selTok` is set. Relying solely on `showLumpDetail` to update the label is not enough because `showLumpDetail` is async (it fetches from server) and never calls `_updateLumpViewingLabel` itself.

**Why:** On page reload, `renderLumps()` is called after `networkidle` with the server list already populated. The picker is pre-selected from `lastSelectedLumpToken` via `LumpRegistry.setCurrent()`. But `showLumpDetail` kicks off a network fetch and the label update only runs on fetch completion — the label appears visible for a moment then disappears (or never appears) depending on timing. Calling `_updateLumpViewingLabel` synchronously covers this race.

**How to apply:** In `renderLumps()` (simulator/app-abstractions.js), after the `showLumpDetail` call block, add `_updateLumpViewingLabel(_selTok)`. This is safe — if the registry has no data yet it returns early with `display:none` (idempotent), and when the registry IS populated it immediately shows the label.

## Cross-script bare-identifier trap
`showLumpDetail` is a top-level `function` declaration in `app-lumps.js`. Despite the spec saying global function declarations are properties of the global object, Chrome V8 does NOT reliably resolve them as bare identifiers from code in OTHER classic scripts. Symptom: `ReferenceError: showLumpDetail is not defined` inside `app-abstractions.js` even though `app-lumps.js` is loaded first.

**Fix:** Add `window.showLumpDetail = showLumpDetail` at the end of `app-lumps.js`, and use `window.showLumpDetail` (with typeof guard) at all cross-script call sites.

**Affected files:** `simulator/app-lumps.js`, `simulator/app-abstractions.js`, `simulator/app-shell.js`.
