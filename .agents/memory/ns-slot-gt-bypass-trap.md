---
name: NS slot migration GT-bypass trap
description: When a Boot.Abstr NS slot migrates, every c-list fallback path that returns the old slot number silently invokes the wrong GT.
---

## The rule

After any Boot.Abstr NS slot migration, audit **every** place that returns
a hardcoded c-list slot index for Boot.Abstr — especially assembler fallback
paths and server-side boot-image endpoints. A stale slot number silently maps
to whatever GT happens to live at that index now, with no type error or fault.

## The concrete incident

Boot.Abstr migrated from NS slot 3 → NS slot 6. The assembler's `_resolveNSName()`
had a fallback:
```javascript
if (name === 'Boot.Abstr') return 3;   // WRONG after migration
```
c-list slot 3 is `LED_DEV`. Any `CALL Boot.Abstr` assembled without a
`capabilities { Boot.Abstr }` block would invoke the LED device silently.
Fixed: `return 6`.

The server-side lump-shrink endpoint (`/api/boot-lump-shrink`) had:
```python
boot_ns_base = ns_table_base + 3 * 4   # WRONG: slot 3, should be slot 6
```
Fixed: `_boot_image_gen.BOOT_ABSTR_NS_SLOT * _boot_image_gen.NS_ENTRY_WORDS`.

## The pattern

The existing `check-slot-index-leak.js` CI guard only catches `*_NS_SLOT`
**constant declarations** in the JS layer. It does NOT catch:
- Hardcoded integer returns inside `_resolveNSName` or similar resolution fallbacks
- Hardcoded arithmetic in Python server endpoints

**After any NS slot renumbering, manually grep for the old slot number as a
decimal integer literal** in:
1. `simulator/assembler.js` — `_resolveNSName`, `_devSlotMap`, `buildSlotNames`
2. `server/app.py` — all boot-image manipulation endpoints
3. `tests/` — any fixture that names the slot explicitly

**Why:** The DEMO_CLIST slot map mirrors NS slot indices directly (slot 6 NS →
c-list[6]). Old slot numbers become valid indices into a different GT.
The assembler has no type system to catch this — it just encodes the integer.

**How to apply:** When changing `BOOT_ABSTR_NS_SLOT` in `boot_image_gen.py`:
1. Run `grep -rn ' 3 \*\|return 3\|slot.*= 3\|+ 3 \*' simulator/ server/` (substituting old slot)
2. Update every match that logically refers to Boot.Abstr
3. Update stale comments too — they seed the next bug
4. Verify `_getHardwareBootCatalog()` DEMO_CLIST table in simulator.js matches
