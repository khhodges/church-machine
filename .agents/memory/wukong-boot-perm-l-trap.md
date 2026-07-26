---
name: Wukong standalone boot — CALL NULL_CAP trap and ROM fix
description: BOOT_PROGRAM faults on standalone FPGA at CALL CR0,CR0 (not LOAD); Wukong ROM must use WUKONG_NUC_PROGRAM
---

## Root cause (hardware-confirmed)

`BOOT_PROGRAM` has three instructions:
1. `LOAD CR15, CR15[0]` — M-elevated during boot → **works**
2. `CHANGE CR12, CR15, #1` — M-elevated during boot → **works**
3. `CALL CR0, CR0` — CR0 = Thread.caps[0] — **faults NULL_CAP on standalone FPGA**

The fault is at step 3, not step 1. M-elevation (added to core.py) fixes the LOAD;
it does NOT fix the CALL. `Thread.caps[0]` is only written by the IDE's
`setBootEntrySlot()`. On a standalone FPGA with no IDE connected, it is 0 (NULL)
→ NULL_CAP fault → `fault_latched = 1` → `led[1]` stuck ON.

**Observed symptom:** After `xc3sprog`, led[1] (G20) ON, led[0] (G21) OFF, no UART.

## Fix

`wukong_top.py` ROM must use `WUKONG_NUC_PROGRAM`, not `BOOT_PROGRAM`:

```python
from .boot_rom import (BootRom, WUKONG_NUC_PROGRAM, WUKONG_DEMO_NAMESPACE, WUKONG_DEMO_CLIST)
_WUKONG_ROM = list(WUKONG_NUC_PROGRAM)
while len(_WUKONG_ROM) < 1024:
    _WUKONG_ROM.append(0)
```

`WUKONG_NUC_PROGRAM` (73 words):
- [0] `LOAD CR3, CR6[5]` → LED_DEV (M-elevated, CR6.clist_base=0x400 at reset)
- [1] `LOAD CR4, CR6[6]` → UART_DEV (same)
- [2..72] loop: LED blink + TX "CM:WUKONG\r\n" at 57600 baud, no CALL

## M-elevation is still real and correct

The hardware M-elevation rule (`boot_state_reg != BootState.COMPLETE` ORed into
`sub_m_elevated` in core.py) IS correct and still needed for the LOADs in
WUKONG_NUC_PROGRAM to bypass the L-perm gate. It fixes LOAD, not CALL.

## How to apply

- Wukong standalone: always `_WUKONG_ROM = list(WUKONG_NUC_PROGRAM)`.
- IDE-connected: BOOT_PROGRAM is correct (IDE calls setBootEntrySlot before boot).
- Any Wukong bitstream rebuild must regenerate Verilog after changing the ROM.

**Why:** The previous note said "never use NUC_PROGRAM at ROM[0]" which is wrong
for standalone. The CALL NULL_CAP trap only triggers on standalone FPGA where no
IDE has wired up Thread.caps[0].
