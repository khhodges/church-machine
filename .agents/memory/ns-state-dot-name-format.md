---
name: ns-state.json rich NS-entry format
description: ns-state.json stores one rich object per occupied NS slot, including all column values and a boot marker — not a flat name list.
---

## Rule
`server/lumps/ns-state.json` stores the FULL NS table snapshot as rendered in the IDE:

```json
{
  "abstractions": [
    { "name": "SelfTest", "slot": 6, "location": "0x00000100",
      "type": "Inform", "f": 0, "g": 0, "limit": "0x001FE",
      "seq": 0, "seal": "0x667F", "boot": true },
    ...
  ],
  "generated_at": <unix time>
}
```

Empty slots are omitted. `"boot": true` appears only on the ⚡ boot-entry slot. No top-level `boot_entry` field.

Executable resident rows must also carry the selected `token` and exact `filename` locator when the resolver cannot derive them from a complete catalog row. A slot/name-only SelfTest row makes boot-image regeneration report the executable as missing.

**Why:** The rich format lets the server reconstruct the full NS table state without re-parsing the binary, and lets readers see exactly what the IDE shows.

**How to apply:**
- `boot_image.py:parse_ns_table(image_bytes)` decodes the binary into raw slot dicts.
- `boot_image.py:_load_ns_state_token_map()` reads `entry["slot"]` + resolves token by name from the manifest; MMIO slots (2-5) are skipped for token resolution.
- `app.py:_derive_ns_state_entries()` calls `parse_ns_table()` + annotates with names from the manifest/HW catalog; called at cold-start to seed the file.
- `app.py:_ensure_ns_state()` migrates both legacy formats (flat-name list, slot-keyed) automatically on startup.
- `app.py:_write_ns_state(entries)` accepts a list of rich dicts; no `boot_entry` param.
- `app-memory.js:_nsTableSave` builds `nsAbstractions` by iterating `sim.readNSEntry(i)` for `i = 0..sim.nsCount-1`; later saves should preserve resident token/filename bindings when available.
- `_findSrcLump(slotIdx, slotLabel)` is unchanged — still uses `slotLabel` (dot name) for lump identity.
