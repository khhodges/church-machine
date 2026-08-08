---
name: Wukong boot CALL direct-GT resolution
description: Boot CALL must bypass c-list; decoder call_mask=0 permanently; change.py uses boot restore mask for CR0+CR12
---

## Root causes (v7 fix)

**decoder.py `call_mask = 0` permanently:** imm15 now carries a method index (not a CR bitmask), so `call_mask` is always scrubbed to 0. RESTORE_CALL was a universal no-op before this was understood; CHANGE's `effective_mask` now uses `BOOT_RESTORE_MASK = (1 << 0) | (1 << 12)` during the boot window (`m_elevated`) instead of the (always-zero) latched mask.

**Boot CALL has no c-list:** the boot lump header (0xF8812400) is a GT word, not a c-list pointer. Normal CALL resolves its target via c-list; at boot there is no c-list. `call.py` has a `boot_window_lat` signal latched at call-start; when set, `mload_direct` is asserted and `mload_direct_gt` is taken from `src_view.word0_gt` (the source GT direct from DMEM/CR0), bypassing c-list indexing in both phases.

**boot_microcode_active window:** defined in `core.py`; active while `boot_complete & (boot_retire_count < 3)`; wired to `u_call.boot_window` and `u_change.boot_window`. The window can close before the CALL FSM finishes (CALL is multi-cycle), so `call.py` latches it at call-start into `boot_window_lat`.

**DMEM layout for boot:**
- Word 244 (`WUKONG_THREAD_CAPS0_WORD`) = `0x4A000007` — E-GT for WukongCallHome (NS slot 7)
- Word 256 (`WUKONG_THREAD_CAPS12_WORD`) = S-permission GT for Thread

**How to apply:** If the boot ROM ever changes (different instruction count or CALL target), update `_DMEM_INIT` in `test_boot_rom_no_false_halt.py` and the word-244/256 constants in `wukong_top.py`. The `boot_microcode_active` counter threshold (3 retires) covers LOAD+CHANGE+CALL; do not reduce it.
