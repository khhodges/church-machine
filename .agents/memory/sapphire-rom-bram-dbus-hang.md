---
name: Sapphire SoC ROM BRAM iBus/dBus port conflict
description: Any dBus lw from ROM BRAM hangs forever — iBus wins; all firmware strings must be in .data (RAM BRAM)
---

## The Rule
NEVER pass a .rodata string literal to `uart_puts()` in the Sapphire SoC firmware.
All strings must be declared as `static char[]` (non-const) so they land in `.data`
and are copied to RAM (0xF9007000) by `crt0.S` at startup.

## Why
The Efinix Ti60 Sapphire SoC uses a single-port BRAM for the ROM region (0xF9000000, 28 KB).
That BRAM is connected to BOTH the iBus (instruction fetch) AND the dBus (data reads,
e.g. `uart_puts` loading from `.rodata`).  iBus always wins port arbitration.
Any dBus `lw` from that ROM BRAM hangs forever when the CPU is executing (which is always).

The RAM BRAM (0xF9007000, 4 KB) is connected ONLY to the dBus — reads work correctly.

This is why:
- `uart_putc` (immediate values, no memory read) always works
- Banner output (all `uart_putc`) always works  
- Stack `lw`/`sw` (RAM BRAM, dBus-only) always works
- `uart_puts("any string literal")` always hangs on the first `lw`

## How to Apply
In `hardware/soc_combined/firmware/main.c`:
1. All strings passed to `uart_puts()` must come from `static char _rs_xxx[] = "..."` variables
   (non-const → `.data` → RAM after crt0 copy).
2. Struct fields with string data must use embedded `char[N]` arrays, not `const char *` pointers.
   (Pointer targets go to `.rodata`; embedded arrays go to `.data` with the struct.)
3. Function tables of strings (like fault names) must be `char[][N]`, not `const char * const[]`.
4. `_NS_TOKENS[]` (uint32_t array read by index at runtime) must also be non-const → `.data`.

## Memory Budget (4 KB RAM at 0xF9007000)
- _rs_* string table: ~742 bytes
- _fault_names[][16]: 416 bytes (26 × 16)
- _NS_MANIFEST struct (char[36]+char[20]): 504 bytes (9 × 56)
- _NS_TOKENS[9]: 36 bytes
- .bss (cm_key_table, _rx_buf, etc.): ~324 bytes
- Total: ~2022 bytes → ~2074 bytes left for stack. Adequate.

## Confirmed
Root cause confirmed 2026-07-16. Fix: firmware H (build_seq.h → 'G', OBBS bumps to 'H').
Symptom before fix: board output stopped at `UID=c0ffee0100000001\r\n` then hung.
After fix: full CALLHOME JSON expected.
