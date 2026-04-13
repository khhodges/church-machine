# Polish List

Items to clean up in a future batch. None are blocking.

---

### P001: Warm-slot tooltip positioning
- **Source**: Task #101 code review
- **Area**: `simulator/app.js` — `showNSEntryTooltip()` warm-slot branch
- **Issue**: Warm-slot tooltips use raw `evt.pageX`/`evt.pageY` coordinates instead of the shared `_positionNSTooltip()` helper, which can drift during scroll.
- **Fix**: Route warm-slot tooltip positioning through the same helper used by loaded-slot tooltips.

### P002: Warm-slot type label clarity
- **Source**: Task #101 code review
- **Area**: `simulator/app.js` — `updateNamespace()` warm-slot branch
- **Issue**: The type column shows the priority tag ("Warm") but could also include "Unloaded" for extra clarity (e.g., "Warm / Unloaded").
- **Fix**: Append " / Unloaded" to the priority tag when `manifest.loaded === false`.
