# H4 — DEMO_CLIST Only LED Slot Populated on Wukong

## Priority
**High** — Any V2 CLOOMC program that tries to access UART_DEV, BTN_DEV, TIMER_DEV,
or SelfTest via the boot c-list will get a `NULL_CAP` fault immediately. The current
Wukong `_clist_one_gt` is intentionally minimal for the LED-blink demo, but it must
be upgraded for V2.

## Root Cause
`hardware/wukong_top.py` deliberately defines:
```python
_clist_one_gt = [0] * 64
_clist_one_gt[5] = DEMO_CLIST[5]   # LED_DEV GT — the only one
```
and uses `_clist_one_gt` instead of `DEMO_CLIST` when building `dmem_init`. The
comment says "least-authority principle: the boot c-list starts with AT MOST ONE
capability." This is correct for the LED-blink NUC_PROGRAM but wrong for V2 programs
that need UART, buttons, timers, or SelfTest.

## DEMO_CLIST Layout (from boot_rom.py)

| Slot | Device | GT |
|------|---------|----|
| 0 | (mem-mgr / reserved) | `DEMO_CLIST[0]` |
| 1 | Boot.Thread | `DEMO_CLIST[1]` |
| 2 | UART_DEV | `DEMO_CLIST[2]` |
| 3 | LED_DEV | `DEMO_CLIST[3]` |
| 4 | BTN_DEV | `DEMO_CLIST[4]` |
| 5 | LED_DEV (alt) | `DEMO_CLIST[5]` ← currently the only Wukong slot |
| 6 | SelfTest (E-perm) | `DEMO_CLIST[6]` |
| 7–63 | null | `0` |

Note: check `boot_rom.py` for the exact `DEMO_CLIST` layout; the table above is from
the wave-1 boot_rom exploration.

## Proposed Fix

For V2, replace `_clist_one_gt` with the full `DEMO_CLIST`. However, the Wukong has
no physical BTN_DEV and a different UART implementation (C1), so the DEMO_CLIST GTs
for slots 2 and 4 need to be verified against the Wukong MMIO map.

### Step 1 — Verify MMIO addresses match DEMO_CLIST

| Slot | Current DEMO_CLIST location | Wukong MMIO | Match? |
|------|----------------------------|-------------|--------|
| 2 UART_DEV | `0x40000014` | TBD after C1 | Verify |
| 3 LED_DEV | `0x40000000` | `0x40000000` | ✓ |
| 4 BTN_DEV | `0x40000028` | No physical pin | ⚠ |
| 5 TIMER_DEV | `0x4000002C` | `0x4000002C` | ✓ |

If BTN_DEV has no physical pin on Wukong, the DEMO_CLIST[4] GT can still be included
in the c-list (it points to a valid MMIO register that always reads 0). The program
simply reads 0 when it queries the button state, which is harmless.

### Step 2 — Switch `dmem_init` to use full DEMO_CLIST

```python
# wukong_top.py — remove _clist_one_gt, use DEMO_CLIST directly
from .boot_rom import build_demo_namespace, DEMO_CLIST, NUC_PROGRAM, WUKONG_BOOT_PROGRAM

dmem_init = list(WUKONG_DEMO_NAMESPACE)   # words 0-31  (C3 fix)
while len(dmem_init) < 256:
    dmem_init.append(0)                   # words 32-255 = zero
dmem_init += list(DEMO_CLIST)             # words 256-319: full c-list
while len(dmem_init) < 16384:
    dmem_init.append(0)
```

### Step 3 — Update `hw_init_pairs` comment and size constant
`N_INIT = len(hw_init_pairs)` is computed automatically from non-zero entries in
`dmem_init`. Adding the full DEMO_CLIST will increase `N_INIT` from ~7 (LED slot
only) to ~13 (all populated slots). The hw_init sequencer handles this transparently.

## Files to Change

| File | Change |
|------|--------|
| `hardware/wukong_top.py` | Remove `_clist_one_gt`; use `DEMO_CLIST` directly; add import if not already present |
| `hardware/test_wukong_clist.py` | New: verify all non-null DEMO_CLIST slots are present in `dmem_init` after the change |

## Acceptance Criteria
1. `dmem_init[256 + 2]` == `DEMO_CLIST[2]` (UART_DEV GT present).
2. `dmem_init[256 + 6]` == `DEMO_CLIST[6]` (SelfTest GT present).
3. NUC_PROGRAM simulation still works (LED slot 5 still populated, so existing LED
   blink is unaffected).
4. `hw_init_pairs` contains entries for all non-zero DEMO_CLIST slots.
5. `hardware/test_wukong_clist.py` passes.

## Risks
- **UART_DEV address**: If C1 places UART MMIO at a different address than
  `DEMO_NAMESPACE` slot 2 expects (`0x40000014`), the DEMO_CLIST UART_DEV GT will
  reference the wrong MMIO register. Resolve C1 first to confirm the address, then
  verify DEMO_CLIST[2] matches.
- **BTN_DEV no physical pin**: Including BTN_DEV GT in the c-list is harmless (reads 0)
  but should be documented so developers know button polling on Wukong always returns 0
  until a button is wired.

## Depends On
C3 (NS address fix) for correctness of WUKONG_DEMO_NAMESPACE. C1 (UART) to confirm
UART MMIO address before verifying DEMO_CLIST[2]. Both can be in the same commit.
