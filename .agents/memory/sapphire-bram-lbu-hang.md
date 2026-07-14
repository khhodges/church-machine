---
name: Sapphire SoC boot UART ordering — three hard constraints
description: Correct main() ordering for boot banner output: fence + banner before CM release. Violating any constraint causes silent hang or truncated output.
---

## The Three Constraints

### Constraint 1 — APB fence after UART_CLOCKDIV
After writing `UART_CLOCKDIV`, the Sapphire SoC dBus is left in a state
where the next `lw` from ROM BRAM hangs silently (no output at all).
A write to a **different** APB slave (the CM APB3 bridge at `0xF8100000`)
flushes this state. The `CM_UID_LO` / `CM_UID_HI` writes serve as this
fence.

**Symptom when violated:** nothing output — not even the first 'C'.

### Constraint 2 — Banner before CM_CTRL_RELEASED
Once `CM_CTRL = CM_CTRL_RELEASED` is written, the CM core starts executing
within tens of clock cycles and can win APB3 bus arbitration. The Sapphire
SoC stalls mid-UART-write when the CM grabs the bus. Only the character(s)
already in the TX pipeline before the stall escape.

**Symptom when violated:** only the first char ('C') or first few chars
output, then silence.

### Constraint 3 — Fence comes before banner
The fence writes (CM_UID_LO/HI) must come before `uart_puts`, not after.
Putting the banner before the fence re-triggers Constraint 1.

## Correct Ordering

```
UART_CLOCKDIV = UART_DIV_57600;    // Step 1: baud rate
CM_UID_LO = BOARD_UID_LO;          // Step 2a: fence write (different APB slave)
CM_UID_HI = BOARD_UID_HI;          // Step 2b: fence write + UID stored
uart_puts("CHURCH Ti60 SoC+CM v"); // Step 3: banner — no CM contention yet
...banner digits and UID emit...
CM_CTRL = CM_CTRL_RELEASED;        // Step 4: release CM — APB now shared
...boot_complete wait, CALLHOME... // Step 5+: CM running, APB shared
```

## Why the Fence Happens

Suspected cause: the Sapphire SoC's AXI/APB bridge for the UART
(0xF8010008) leaves an internal "pending" state after a CLOCKDIV write
that blocks the dBus (BRAM path) until another APB transaction on any
slave completes the pipeline. This is NOT observed after CM APB writes
(0xF8100000), suggesting the UART APB slave has a longer PREADY pipeline
or a different AXI response timing.

## History

- June 2026 bitstream: CM Verilog was slow enough that banner transmitted
  before CM grabbed APB3 → worked despite Constraint 2 technically violated.
- July 2026 regen (NS stride-4): CM grabs APB3 faster → only 'C' survived.
- Fix attempt 1: moved banner before CM release but dropped fence writes
  → nothing output (Constraint 1 violated).
- Fix attempt 2: restored fence writes before banner, CM release after
  → all three constraints satisfied.
