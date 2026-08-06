---
name: ns-state.json dot-name format
description: ns-state.json stores abstraction dot-names, not slot numbers or tokens — slot assignment is a synthesis detail owned by boot_image.py
---

## Rule
`server/lumps/ns-state.json` stores the LOGICAL state of the namespace:

```json
{
  "abstractions": ["SelfTest", "WukongCallHome", "SlideRule", ...],
  "boot_entry": "SelfTest",
  "generated_at": <unix time>
}
```

Slot numbers and tokens are NOT stored here. They are synthesis details.

**Why:** The Church Machine is based on logic, not physics. Slot numbers are physical addresses hidden by the CM model. The dot name is the only identity that belongs in the logical record.

**How to apply:**
- `boot_image.py` resolves each name to a (slot, token) pair via the manifest `ns_slot` field — that's where physical placement lives.
- `_findSrcLump(slotIdx, slotLabel)` uses `slotLabel` (the dot name) to find the lump; slot number is ignored.
- The save-ns POST body sends `{ abstractions: [names...], boot_entry: "Name" }`.
- `_ensure_ns_state()` in `app.py` detects the old slot-keyed format and migrates it automatically.
- `tests/lump/test_lump_consistency.py` R4 excludes `ns-state.json` from the orphan-sidecar scan (it's not a lump sidecar).
