---
name: Boot catalog slot 7 — WukongCallHome
description: Slot 7 is now WukongCallHome (INFORM, E-perm) in all three catalogs; no longer a null "programmable" slot.
---

## The rule
Hardware cold-boot catalog is **8 slots (0–7)**. Slot 7 = WukongCallHome (INFORM, E-perm, location=0x0140, lump_size=64).
- Previously slot 7 was a null/programmable slot → nsCount=7.
- After this change nsCount=8 for a fresh default boot image.

## Affected files (all three must stay in sync)
1. `simulator/simulator.js` `_getHardwareBootCatalog()` — array of 8 entries, index 7 = WukongCallHome
2. `hardware/boot_rom.py` `_SYSTEM_ABSTRACTION_SLOTS` — key `WUKONG_CALLHOME_NS_SLOT=7` → `('WukongCallHome', PERM_MASK_E)`;  the `elif _i == 7: _make_ns_entry(GT_TYPE_NULL, …)` dead branch was removed
3. `server/boot_image.py` `DEFAULT_ABSTRACTION_CATALOG` — 8 entries, index 7 = WukongCallHome; `assert len == 8`
4. `tests/boot/test_boot_image_loads_and_boots.py` CONFIGS — expected nsCount for default/custom_step1/no_window = **8** (was 7)

**Why:** WukongCallHome LUMP (token b7b0046b, NS slot 7) is the Wukong board's coordinator: calls SelfTest, then Tunnel.Register, then RETURNs to IDE if ACK=1. It must be present in the namespace for the user to set ⚡ to slot 7 and test the full call-home path.

## NS slot physical layout (default 256-word thread lump)
- Slot 1 Boot.Thread: word 0x0000 (size 256)
- Slot 6 SelfTest:    word 0x0100 (size 64)
- Slot 7 WukongCallHome: word 0x0140 (size 64)
- irqAllocBase: 0x0180 (was 0x0140 before this change)

## ⚡ bootEntrySlot default
Still **6** (SelfTest). User must manually drag ⚡ to slot 7 to test WukongCallHome in the IDE. Changing the default to 7 would break existing CI tests that rely on slot 6 being the boot entry.
