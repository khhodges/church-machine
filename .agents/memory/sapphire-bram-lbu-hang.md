---
name: Sapphire BRAM lbu hang after UART APB write
description: lbu (byte load) from ROM BRAM at byte lane 1-3 hangs dBus after a prior UART APB store — same root cause as the sb hang; only lw/sw are safe.
---

## The Rule
After any store to APB space (0xF8xxxxxx), a subsequent `lbu` from the
combined ROM/RAM BRAM at a non-lane-0 byte address (i.e. `addr & 3 != 0`)
stalls the dBus forever on the Ti60 Sapphire SoC. `lw` (full 32-bit word
reads) always work.

## Why
The Efinix Ti60 Sapphire SoC dBus byte-enable path for sub-word reads from
the system_ramA BRAM appears to malfunction for byte lanes 1, 2, 3 when
there has been a prior outstanding or recently-completed APB transaction.
Byte lane 0 (`addr & 3 == 0`) works. This is the same hardware defect as
the known `sb`-to-BRAM hang — the byte-enable circuitry is unreliable for
both reads and writes at sub-word granularity.

## How to Apply
**Never call `lbu`/`lb`/`lhu`/`lh` (sub-word loads) from ROM BRAM after
any UART or APB write, anywhere in the firmware.**

Specifically:
- `uart_puts(s)`: must use `lw` + bit-shift, NOT `while (*s) uart_putc(*s++)`.
  The word-load loop reads 4 chars at once via `lw`, extracts bytes via
  `>>` and `& 0xFF` (register-only), no `lbu` from ROM at any point.
  Handles non-4-aligned string starts by loading the containing word and
  discarding bytes before `s[0]`.

- `uart_puthex32_lower(v)`: must NOT use `static const char hex[]` table.
  The `hex[nib]` access is a `lbu` from .rodata — hangs for nib values whose
  byte lane != 0. Use arithmetic: `nib < 10 ? '0'+nib : 'a'+(nib-10)`.

- Any future code that indexes into a `char[]` or `const char[]` in .rodata
  AFTER a UART write must be converted to word-load + shift/mask.

- `_rx_buf[i]` byte-index accesses in the command parser are `lbu`/`sb`
  from/to RAM (0xF9007xxx) — they also need to be word-aligned or replaced
  with word-load patterns.

## Known Symptom That Led Here
`uart_puts("CHURCH Ti60 SoC+CM v")` output only 'C' then hung. 'C' is at
byte lane 0 of the first aligned word — works. 'H' is at lane 1 — hangs.
The 128-entry TX FIFO and immediate PREADY completely ruled out any FIFO
stall. ROM initialization is correct (both lw for instructions and lw for
data work). The hang is purely the byte-enable path in the dBus → BRAM
connection.
