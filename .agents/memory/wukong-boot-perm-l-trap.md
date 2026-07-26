---
name: Wukong standalone boot — two sequential faults and their fixes
description: BOOT_PROGRAM faults at CALL CR0,CR0 (NULL_CAP); WUKONG_NUC_PROGRAM faults at LOAD CR3,CR6[5] (L-perm missing on CR6)
---

## Fault 1 — BOOT_PROGRAM: CALL NULL_CAP (hardware-confirmed)

`BOOT_PROGRAM[2] = CALL CR0, CR0`. CR0 = Thread.caps[0], which is only set by
the IDE's `setBootEntrySlot()`. On standalone FPGA it is 0 → NULL_CAP fault →
`fault_latched` → led[1] (G20) stuck ON, no UART.

**Fix:** `wukong_top.py` ROM uses `WUKONG_NUC_PROGRAM` (73 words, no CALL).

## Fault 2 — WUKONG_NUC_PROGRAM: LOAD from CR6 fails L-perm (hardware-confirmed)

`WUKONG_NUC_PROGRAM[0] = LOAD CR3, CR6[5]`. CR6 was initialised by
`BootState.INIT_CLIST` with GT word `0x4A000002` — E-perm only (perm=0b100).
The L-perm check (perm bit 1) fires at instruction 0 → fault → same stuck
LED symptom.

**Critical misunderstanding:** The M-elevation fix in `core.py`
(`boot_state_reg != BootState.COMPLETE` ORed into `sub_m_elevated`) does NOT
help here. M-elevation is only active during boot FSM states (IDLE through
LOAD_NUC). **Instruction execution starts after `boot_state_reg == COMPLETE`**,
so M-elevation is already False when word 0 runs.

**Fix:** `core.py` `BootState.INIT_CLIST` uses GT `0x6A000002` (perm=0b110 = L+E):
```python
C(0x6A000002, 32),  # word0_gt: Church L+E-perm (dom=1,perm=0b110)
```

## What M-elevation actually does

`boot_state_reg != COMPLETE` ORed into `sub_m_elevated` elevates any LOAD
that fires **during a boot FSM state** (e.g. hardware microcode injected by
the init sequencer). Normal ROM code executes only after COMPLETE. The flag
was added to support future boot-phase LOADs; it does not help ROM word 0.

## Correct CR6 GT (post-fix)

```
0x6A000002 = b_flag=0 | perm=0b110(L+E) | dom=1(Church) | gt_type=INFORM | slot=2
```

location = 0x400 (WUKONG_DEMO_CLIST in DMEM), limit = 63 entries.

## How to apply

- Any ROM that does `LOAD CR_dst, CR6[n]` requires CR6 to have L-perm.
- Do not change CR6 back to E-only (0x4A000002) — it silently breaks standalone boot.
- After any core.py or wukong_top.py change, regenerate Verilog and rebuild bitstream.

**Why:** The L-perm gate on mLoad checks the source capability's perm bits
regardless of which state the CPU is in. There is no auto-bypass for boot ROM.
