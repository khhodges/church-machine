# Polish List

Items to clean up in a future batch. None are blocking.

---

### ~~P001: Warm-slot tooltip positioning~~ — RESOLVED by Task #102
- **Resolved**: Task #102 rewrote warm-slot tooltip to use the same code path
  as loaded-slot tooltips. The separate warm-slot branch that used raw page
  coordinates was removed.

### ~~P002: Warm-slot type label clarity~~ — RESOLVED by Task #102
- **Resolved**: Task #102 changed warm-slot rendering. Warm slots now display
  their real GT type (e.g., "Inform") plus a "(Warm)" tag when code is not
  resident. The separate fallback rendering path was removed because GTs are
  now preserved and readNSEntry() returns real data for warm slots.
