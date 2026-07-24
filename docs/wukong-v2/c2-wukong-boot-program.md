# C2 — Fix BOOT_PROGRAM PERM_L Trap on Wukong

## Priority
**Critical** — Without a working boot sequence the IDE can never deploy a CLOOMC
program; the board is permanently a LED-blink demo.

## Root Cause
`hardware/wukong_top.py` deliberately omits `BOOT_PROGRAM` from the Wukong ROM and
starts the core at `NUC_PROGRAM[0]` instead. The docstring explains why:

> `BOOT_PROGRAM[0]` = `LOAD CR15, CR15[0]` always faults `PERM_L` on standalone
> hardware.  `mload_m_elevated` is only set when `cr_src == CR_CLIST (CR6)`; here
> `cr_src = 15`. CR15's initial GT has `perm = 0` → `has_l_perm = 0` → fault.

The three-instruction sequence that `BOOT_PROGRAM` was meant to provide:
```
LOAD   CR15, CR15[0]   ; refresh NS root from its own lump
CHANGE CR12, CR15, #1  ; switch thread to Boot.Thread (NS slot 1)
CALL   CR0,  CR0       ; jump to IDE-configured boot entry
```

Instruction 1 is the broken one. The core needs to reach `CHANGE` and `CALL` before
the IDE can load user programs.

## Why `LOAD CR15, CR15[0]` Faults
`mLoad` checks `PERM_L` on `cr_src`. `cr_src = CR15` (not CR6), so `m_elevated = 0`.
CR15's boot GT is `GT_TYPE_INFORM, perm = 0`. `has_l_perm = (perm >> 3) & 1 = 0`.
Result: `FaultType.PERM_L`.

The Ti60 avoids this because the Sapphire SoC uploads a fully-initialised boot image
(including a correctly-permissioned CR15) before the CM core starts executing. The
Wukong has no SoC and no boot image upload path (yet), so the CM starts with the
hardware-initialised CR15 directly.

## Chosen Fix: Wukong-Specific BOOT_PROGRAM

Provide a separate `WUKONG_BOOT_PROGRAM` in `hardware/boot_rom.py` that skips the
now-redundant `LOAD CR15, CR15[0]` step.

The hardware boot FSM already initialises:
- CR15 correctly (NS root INFORM GT, `word1_location = 0`)
- CR12 correctly (Boot.Thread INFORM GT, `slot_id = 1`)
- CR6 correctly (c-list INFORM GT, `word1_location = 0x400`)
- CR14 correctly (NUC code fence)

So the only work left for `BOOT_PROGRAM` is: switch to Boot.Thread and call the
configured boot entry. The `LOAD CR15, CR15[0]` refresh step is only needed when the
NS root lump has been swapped by a prior runtime; on cold boot it is a no-op for the
Ti60 and a fault for the Wukong.

### `WUKONG_BOOT_PROGRAM` (3 instructions, replacing `BOOT_PROGRAM` in Wukong ROM):
```python
WUKONG_BOOT_PROGRAM = [
    # 0: Switch from NUC context to Boot.Thread (NS slot 1, already in CR12)
    encode_church(ChurchOpcode.CHANGE, CondCode.AL, cr_dst=12, cr_src=15, imm=1),
    # 1: Call the boot entry abstraction (c-list slot 6 = SelfTest / IDE-configured)
    encode_church(ChurchOpcode.CALL, CondCode.AL, cr_dst=0, cr_src=6, imm=6),
    # 2: Infinite BRANCH if CALL returns (should not happen — fault recovery reboots)
    encode_turing(TuringOpcode.BRANCH, CondCode.AL, imm=-1),
]
```

Notes:
- `CHANGE CR12, CR15, #1`: Changes current thread to the NS slot-1 lump (Boot.Thread).
  `cr_src = CR15` is valid for CHANGE (CHANGE checks `PERM_L` on `cr_src`, and CR15
  has `PERM_L`? — **must verify**; see risk section below).
- `CALL CR0, CR6[6]`: Calls into c-list slot 6 (`SelfTest`). The IDE-configured boot
  entry is loaded into the thread's c-list at slot 6 by the upload mechanism.

### Wukong ROM layout after fix:
```
ROM[0..2]    = WUKONG_BOOT_PROGRAM (3 words)
ROM[3..19]   = NUC_PROGRAM (17 words, shifted)
ROM[20..1023] = 0
```

`_WUKONG_ROM` in `wukong_top.py` must be rebuilt from `WUKONG_BOOT_PROGRAM + NUC_PROGRAM`.

## Alternative Fix (if CHANGE also faults)
If `CHANGE CR12, CR15, #1` also faults because CR15's initial GT lacks `PERM_L` for
CHANGE, the alternative is to give CR15 `PERM_L` in the hardware boot FSM
(`hardware/core.py`, `LOAD_NS` state), or to use `CR6` as the source for both CHANGE
and CALL:

```python
WUKONG_BOOT_PROGRAM_ALT = [
    encode_church(ChurchOpcode.CALL, CondCode.AL, cr_dst=0, cr_src=6, imm=6),
    encode_turing(TuringOpcode.BRANCH, CondCode.AL, imm=-1),
]
```

This skips CHANGE entirely and lets CALL set up the new context directly. Verify
against `hardware/call.py` that CALL without a preceding CHANGE is legal.

## Files to Change

| File | Change |
|------|--------|
| `hardware/boot_rom.py` | Add `WUKONG_BOOT_PROGRAM` constant; export it |
| `hardware/wukong_top.py` | Replace `_WUKONG_ROM = list(NUC_PROGRAM)` with `list(WUKONG_BOOT_PROGRAM) + list(NUC_PROGRAM)`; update import |
| `hardware/test_wukong_boot.py` | New: Amaranth simulation test verifying core steps through WUKONG_BOOT_PROGRAM without PERM_L fault |

## Acceptance Criteria
1. Amaranth simulation of `ChurchWukongXC7A100T` completes `WUKONG_BOOT_PROGRAM` steps
   without any `fault_valid` assertion.
2. Core reaches the CALL instruction at `ROM[1]` and dispatches correctly.
3. `hardware/test_wukong_boot.py` passes: at least 3 test cases (cold boot, fault after
   CALL returns, and a deliberate PERM_L-trigger to confirm the old first instruction
   still faults when used directly from CR15).

## Risks
- **CHANGE permission check**: `hardware/change.py` requires `PERM_L` on `cr_src`.
  Must verify that `CR15`'s boot GT (INFORM, perm=0) has `PERM_L` set. If not, either
  the boot FSM must set `PERM_L` on CR15, or the alternative two-instruction boot is
  needed.  Read `hardware/change.py` CHECK state before implementing.
- **NIA offset shift**: `NUC_PROGRAM` now starts at word 3, not word 0. Any hardcoded
  reference to `NUC_LUMP_BASE` or NUC start address must be updated.
- **CALL c-list index**: CALL at index 1 uses `cr_src=CR6, imm=6`. If DEMO_CLIST[6]
  is NULL (it is in the current minimal c-list), CALL faults immediately. This is
  correct until the IDE loads the real boot entry via C1+C3 (UART + NS fix). The
  board falls through to the NUC_PROGRAM LED blink gracefully if the entry is not yet
  loaded.

## Depends On
C3 (NS address fix) is independent. C1 (UART) is independent but needed to actually
reach the CALL step with a real IDE-configured entry.
