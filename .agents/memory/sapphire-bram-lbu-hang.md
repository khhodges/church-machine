---
name: Sapphire SoC BRAM byte-enable bug — UART output rules
description: Ti60 Sapphire SoC BRAM byte-enable signals are broken for sub-word access. Three coding rules prevent the one-'C' hang in uart_puts/uart_putc.
---

## Root Cause

Efinix Ti60 Sapphire SoC BRAM byte-enable signals do not work correctly
for sub-word (byte or halfword) accesses after any APB write. Two hang
modes:

### Bug A — lbu from non-zero byte lane
`lbu` from ROM BRAM at byte lane 1, 2, or 3 stalls the dBus forever
after any APB write (UART_DATA, UART_CLOCKDIV, CM APB3 registers).
Byte lane 0 works (`'C'` = offset 0 of a 4-aligned `.rodata` string).
Byte lane 1 hangs (`'H'` = offset 1).

### Bug B — sb to BRAM-backed stack
`sb` (byte store) to the BRAM stack area (~0xF9007xxx) also hangs.
This triggers even for stack-spills of `char` local variables.

## Three Coding Rules (all required together)

### Rule 1 — uart_putc MUST be always_inline
```c
static inline __attribute__((always_inline)) void uart_putc(uint32_t c)
```
- If compiled as a regular function (even at -O0), GCC emits `sb a0, offset(sp)` in the prologue to spill the `char` parameter → Bug B hang.
- `always_inline` eliminates the prologue; value stays in registers.
- Parameter changed from `char` to `uint32_t` for clean inlining.

### Rule 2 — uart_puts MUST be compiled at -O0
```c
static void __attribute__((optimize("O0"))) uart_puts(const char *s)
```
- GCC -O2 sees the explicit `lw + (w >> 8) & 0xFF` pattern and rewrites it to `lbu` → Bug A hang.
- `-O0` preserves the lw+shift literally.

### Rule 3 — Loop variable in uart_puts MUST be uint32_t, not char
```c
uint32_t c = w & 0xFFu;   /* NOT: char c = ... */
```
- At -O0, GCC spills all locals to the stack.
- `char c` spills via `sb` → Bug B hang.
- `uint32_t c` spills via `sw` (4-byte, safe).

## Boot Ordering (also required)

```
UART_CLOCKDIV = UART_DIV_57600;    // Step 1
CM_UID_LO = BOARD_UID_LO;          // Step 2a — APB fence (different slave)
CM_UID_HI = BOARD_UID_HI;          // Step 2b
uart_puts("CHURCH Ti60...");        // Step 3 — banner, NO CM contention
CM_CTRL = CM_CTRL_RELEASED;        // Step 4 — only AFTER banner complete
```

The CM_UID writes act as an APB bus fence clearing the stall introduced
by UART_CLOCKDIV on the first lw from ROM.

## Symptom Table

| Missing fix | Symptom |
|---|---|
| always_inline missing (regular fn at O0) | sb in prologue → only 'C' |
| optimize("O0") missing (-O2 inline) | lbu lane 1 → only 'C' |
| uint32_t c missing (-O0 + char c) | sb for c spill → only 'C' |
| CM_CTRL_RELEASED before banner | CM APB contention → only 'C' |
| All three rules + ordering correct | Full banner output |

## Rules for Other UART Functions

- `uart_puthex32_lower`: uses `int i` and `uint32_t nib` locals (4-byte, safe). Calls uart_putc inline. Arithmetic nibble→char (no table lbu). Safe.
- `uart_putdec`: uses `uint32_t tmp` (4-byte, safe). Calls uart_putc inline. Safe.
- Any NEW helper that calls uart_putc and uses char locals needs `uint32_t` locals or `always_inline` treatment.

## Confirmed root cause — BRAM stall is a latch, not a timer (2026-07-15)

**Observation:** probe char 'C' (from `uart_putc`) arrives on UART, but
the entire `uart_puts` banner that follows is silent. The first ROM `lw`
inside `uart_puts` hangs permanently.

**Root cause confirmed:** The BRAM dBus stall triggered by `UART_DATA`
APB writes **latches** — it does NOT self-clear on a timer.  The
10,000-cycle busy-loop in `uart_putc` handles baud timing only.  Only a
CM APB3 bus write (any write to 0xF8100000+) clears the latch.

Stack `sw`/`lw` (to RAM) and further `UART_DATA` writes are unaffected
by the BRAM stall — only BRAM (ROM) `lw` deadlocks.

**Fix (uart_puts):**
- Entry fence: `CM_UID_LO = BOARD_UID_LO; CM_UID_HI = BOARD_UID_HI;`
  before the first `*wp++` — clears stall from caller's `uart_putc`
- Loop fence: same two writes inside the for-loop, before each `*wp++`
  (only when `remaining == 0`, i.e. every 4 chars) — clears stall from
  `uart_putc(c)`

`uart_puthex32_lower` does NO ROM `lw` (register arithmetic only) so
needs no fence writes. `emit_uid()` and adjacent `uart_puts("\r\n")`
calls are safe because `uart_puts` entry fence clears the stall from the
preceding `uart_puthex32_lower`'s last `uart_putc`.

**Rebuild shortcut:** PNR reads `$readmemb` from symbol bins at P&R time
(Efinity 2026.1 BRAM). Only `make -C firmware` + PNR is needed — no
45-min MAP re-run.
