---
name: Sapphire SoC boot UART ordering — three hard constraints
description: Correct main() ordering for boot banner output: fence + banner before CM release. Violating any constraint causes silent hang or truncated output.
---

## The Three Constraints

### Constraint 1 — APB fence after UART_CLOCKDIV
After writing `UART_CLOCKDIV`, the Sapphire SoC dBus is left in a state
where the next `lw` from ROM BRAM may hang silently (no output at all) unless
a write to a **different** APB slave occurs first. The `CM_UID_LO` / `CM_UID_HI`
writes to the CM APB3 bridge (0xF8100000) serve as this fence.

**Symptom when violated:** nothing output — not even the first 'C'.

### Constraint 2 — Banner before CM_CTRL_RELEASED
Once `CM_CTRL = CM_CTRL_RELEASED` is written, the CM core starts executing
within tens of clock cycles and can win APB3 bus arbitration. The Sapphire
SoC stalls mid-UART-write when the CM grabs the bus.

**Symptom when violated:** only the first char ('C') or first few chars
output, then silence.

### Constraint 3 — uart_putc and uart_puts must be compiled at -O0
**Root cause of one-'C' hang:** Firmware is compiled with `-O2`. GCC with -O2
sees the explicit `lw + (w >> 8) & 0xFF` byte-extraction pattern and
"helpfully" rewrites it back to `lbu` instructions. `lbu` from byte-lane
1, 2, or 3 (i.e. any address where `addr & 3 != 0`) stalls the dBus
forever after any APB write on this SoC/BRAM configuration. Byte lane 0
('C' = first char, 4-aligned string in .rodata) works fine — that's why
exactly one 'C' appears. Byte lane 1 ('H') hangs.

**Symptom when violated:** exactly one 'C' per boot (first byte of "CHURCH"),
nothing else.

**Fix:** `__attribute__((optimize("O0")))` on `uart_putc` and `uart_puts`.
This preserves the explicit lw+shift code literally, preventing the -O2
lbu re-optimization.

### Constraint 4 — Fence writes come before uart_puts (not after)
The fence (CM_UID_LO/HI writes) must precede the first `uart_puts` call.
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

## Compiler Attribute Required on UART Functions

```c
static void __attribute__((optimize("O0"))) uart_putc(char c) { ... }
static void __attribute__((optimize("O0"))) uart_puts(const char *s) { ... }
```

These attributes MUST stay on those functions even if the optimization level
changes for the rest of the file. Without them, any -O1 or higher silently
destroys the lw+shift byte extraction.

## History of Bug Discovery

- June 2026 bitstream: CM core slow enough that banner transmitted before APB
  contention occurred — worked despite ordering violations.
- July 2026 regen (NS stride-4): CM grabs APB3 faster → only 'C' survived.
- Attempted fix 1: moved banner before CM release, removed fence writes
  → nothing output (Constraint 1 violated — lw from ROM after UART_CLOCKDIV).
- Attempted fix 2: restored fence writes before banner
  → still only 'C' (Constraint 3 violated — -O2 rewrote lw→lbu in uart_puts).
- Fix 3: added `__attribute__((optimize("O0")))` to uart_putc and uart_puts
  → preserves lw+shift literally, all three constraints satisfied.
