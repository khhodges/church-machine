---
name: Boot.Abstr slot 6 — architectural constraints for NS table access in app.py
description: Why _load_boot_abstr_lump() must call ns_table_reserve_words(); why save_lump() must keep canonical 00000600.lump alive; GT format divergence between Python and JS
---

## Rule 1: NS table base must use ns_table_reserve_words(), not a hardcoded constant
`_load_boot_abstr_lump()` must locate the NS table using `_boot_image_gen.ns_table_reserve_words(_ns_slots_max)`, NOT hardcoded `1024`. The NS table occupies the **last** `NS_TABLE_RESERVE` words of the image. For the default config (nsSlotsMax=1024), `NS_TABLE_RESERVE = 1024 × 4 = 4096`. Hardcoding 1024 looks in the wrong quadrant of boot-image.bin and silently returns cw=0.

**Why:** NS_TABLE_RESERVE was 1024 under the old 256-slot model. When MAX_NS_ENTRIES was raised to 1024 (4096-word table), `_load_boot_abstr_lump()` was not updated. `_load_boot_ns_lump()` is the canonical pattern.

## Rule 2: save_lump() must keep the canonical token-named .lump alive
When saving the boot-abstr lump (ns_slot=6, token=`00000600`), `save_lump()` must write both the versioned archive name (e.g. `SelfTest_v17.lump`) AND `00000600.lump`. `generate_boot_image()` reads the boot-abstr lump by a fixed token-derived path, not by the manifest filename field. Without the canonical copy, regeneration silently falls back to the default cw=3 binary.

**How to apply:** When `token8 == f"{BOOT_ABSTR_NS_SLOT << 8:08x}"`, write an extra copy to `os.path.join(lumps_dir, f'{token8}.lump')` after the versioned write.

## Rule 3: Python create_gt() vs JS createGT() produce different bit layouts
Python `create_gt()` (server/boot_image.py) uses OLD layout: type at bits[24:23], 7-bit seq at bits[22:16].
JS `createGT()` (simulator/simulator.js) uses v2.0: type at bits[26:25], 9-bit seq at bits[24:16].

For E-only type=1 seq=0 slot=22: Python → 0x48800016, JS → 0x4A000016.

Tests that compare a simulator-produced GT must compute the expected value using v2.0 formula: `((perm3 << 28) | (dom << 27) | (gt_type << 25) | slot_id) & 0xFFFFFFFF`. Do NOT use Python `create_gt()` as the reference for JS simulator output.
