---
name: CM APB3 bus contention — banner hang root cause
description: CM core grabs shared APB3 bus immediately after CM_CTRL_RELEASED, stalling the SoC mid-banner. Banner must be fully sent BEFORE releasing the CM core.
---

## The Rule
The boot banner (and any UART output) MUST be fully transmitted **before**
writing `CM_CTRL = CM_CTRL_RELEASED`. The CM core starts executing the
instant it is released and immediately accesses the shared APB3 bridge.
Once the CM wins APB bus arbitration, the Sapphire SoC stalls mid-write —
only the first character escapes.

## Why
The Sapphire SoC UART and the CM APB3 bridge share one APB bus. There is
no hardware arbitration priority that favours the SoC. After
`CM_CTRL_RELEASED`, the CM core begins its boot sequence within a handful
of clock cycles and can grab the APB bus before the SoC finishes a UART
write. The TX FIFO write stalls (PREADY never returns), the SoC hangs,
and only whatever was already in the FIFO before the stall is transmitted.

For a 25 MHz clock and a 57600-baud UART, a 3000-cycle inter-character
delay is ~120 µs — far longer than the CM core needs (~tens of cycles) to
start accessing APB3.

## How to Apply
In `main.c`:
1. Output the full banner (`uart_puts` + `uart_putc` digits) as step 2,
   right after `UART_CLOCKDIV`.
2. Write `CM_UID_LO / CM_UID_HI` and emit the UID line next (APB3 writes
   to the bridge are fine here because the CM is not yet running).
3. Write `CM_CTRL = CM_CTRL_RELEASED` **last**, as step 4.
4. All subsequent `uart_puts` calls (boot_complete wait, CALLHOME, etc.)
   happen after release — but by then the banner is safely in the FIFO.

## Regression History
- **June 12 bitstream**: CM Verilog (pre-NS-stride-4 regen) was slower to
  access APB3 after release — banner transmitted before contention.
- **July 2026 bitstream**: NS stride-4 regen (`4a8593cc`) produced a CM
  core that accesses APB3 faster → only 'C' survived → regression.

## Secondary defensive fixes (kept)
- `uart_puts`: lw-based word extraction instead of `lbu` — guards against
  any BRAM byte-enable sub-word read issues after APB writes.
- `uart_puthex32_lower`: arithmetic nibble→char instead of `hex[]` table —
  no `lbu` from .rodata after a UART write.
