---
name: Boot catalog slot 7 — WukongCallHome
description: Slot 7 is WukongCallHome (INFORM, E-perm) in all catalogs; all related constants and the Namespace tab UI are synced to 8 slots.
---

## The rule
Hardware cold-boot catalog is **8 slots (0–7)**. Slot 7 = WukongCallHome (INFORM, E-perm, location=0x0140, lump_size=64).
- Previously slot 7 was a null/programmable slot → nsCount=7.
- After this change nsCount=8 for a fresh default boot image.
- `BOOT_NAMED_SLOTS` in simulator.js = `[0,1,2,3,4,5,6,7]` — slot 7 is a boot default, NOT a gap.
- `BASE_NAMED_NS_COUNT` in server/app.py = **8**.

## Affected files (all must stay in sync)
1. `simulator/simulator.js` `_getHardwareBootCatalog()` — 8 entries, index 7 = WukongCallHome
2. `simulator/simulator.js` `BOOT_NAMED_SLOTS` — includes slot 7
3. `hardware/boot_rom.py` `_SYSTEM_ABSTRACTION_SLOTS` — key `WUKONG_CALLHOME_NS_SLOT=7`
4. `server/boot_image.py` `DEFAULT_ABSTRACTION_CATALOG` — 8 entries; `assert len == 8`
5. `server/app.py` `BASE_NAMED_NS_COUNT = 8`
6. `tests/boot/test_boot_image_loads_and_boots.py` — expected nsCount = 8
7. `simulator/test_pet_name_memory.js` — BOOT_NAMED_SLOTS includes 7; T016/T022d/T024f/T025c updated
8. `web/app.js` `updateNamespaceDisplay()` — replaced static demo namespace (Kenneth/Services/SlideRule) with real 8-slot hardware boot catalog table

**Why:** WukongCallHome LUMP (token b7b0046b, NS slot 7) is the Wukong board's coordinator: calls SelfTest, then Tunnel.Register, then RETURNs to IDE if ACK=1. It must be present in the namespace for the user to set ⚡ to slot 7.

## NS slot physical layout (default 256-word thread lump)
- Slot 1 Boot.Thread:      word 0x0000 (size 256)
- Slot 6 SelfTest:         word 0x0100 (size 64)
- Slot 7 WukongCallHome:   word 0x0140 (size 64)
- irqAllocBase: 0x0180

## ⚡ bootEntrySlot default
Still **6** (SelfTest). User drags ⚡ to slot 7 to test WukongCallHome. Changing the default breaks CI tests.

## Namespace tab (web/app.js)
`updateNamespaceDisplay()` now renders the real 8-slot hardware boot catalog — NOT the old demo data.
- Orange rows: HARDWARE slots 0–5 (hardwired at design time)
- Blue rows: BOOT slots 6–7 (loaded from boot image)
- Uses `sim.nsLabels` and `sim.readNSEntry()` for live data when simulator is running
- Static fallback with architecture-defined addresses when not running
