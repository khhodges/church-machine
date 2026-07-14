---
name: Sapphire BRAM dBus hang — byte-store, lbu, and uart_putc re-trigger
description: Three related dBus hang bugs on Efinix Ti60 Sapphire SoC; any sb, lbu lane 1/2/3, or uart_putc after CLOCKDIV write hangs the CPU
---

## Rule
Three distinct bugs can hang the RISC-V dBus on the Efinix Ti60 Sapphire SoC:

### Bug A — lbu from non-zero byte lane (partially wrong analysis — see BmbOnChipRam note)
After any APB write (UART_DATA, UART_CLOCKDIV, CM APB3), a subsequent `lbu` from ROM BRAM at byte lane 1, 2, or 3 stalls the dBus forever. Lane 0 works. GCC -O2 rewrites explicit `lw+shift+mask` to `lbu`, so `__attribute__((optimize("O0")))` is required to keep the `lw`.

**BmbOnChipRam hardware note**: The module always reads ALL 4 byte lanes simultaneously (single 32-bit wide read port). The per-lane stall theory may be incomplete — the real issue may be that ANY dBus read from the BRAM stalls after certain APB writes, not just non-zero byte lanes. Confirmed: lw from ROM ALSO stalls (Bug C below).

### Bug B — sb to stack (0xF9007xxx)
Any `sb` instruction to the BRAM data region (0xF9007000–0xF9007FFF) hangs the CPU permanently. Only `sw` (4-byte stores) and `lw` (4-byte loads) are safe. Fix: use `uint32_t` for all local variables in functions compiled at -O0 so spills use `sw` not `sb`.

### Bug C — uart_putc re-triggers dBus stall (confirmed rebuild11)
**Every UART_DATA write (every `uart_putc` call) re-triggers the same dBus stall** that `UART_CLOCKDIV` initially causes. The one-time CM APB3 fence in `main()` clears the CLOCKDIV stall but is consumed; each subsequent `uart_putc` re-stalls the dBus for the next ROM lw.

**Fix pattern**: immediately before every `lw` from ROM, emit two CM APB3 writes (fence), with NO UART write between the fence and the lw:
```c
uart_putc(something);            // UART write → re-stalls dBus
// ... register-only ops (shifts, ands, comparisons) ...
CM_UID_LO = BOARD_UID_LO;        // fence write 1 — clears stall
CM_UID_LO = BOARD_UID_LO;        // fence write 2 — belt-and-suspenders
w = *wp++;                        // lw — immediately after fence, safe
```

This pattern is now in `uart_puts()` at the start (to clear the calling code's last uart_putc stall) and in the inner `--remaining == 0` branch (to clear the per-character uart_putc stalls).

## Confirmed hang-triggering patterns
- `volatile uint32_t i` delay loop → GCC emits `sw`+`lw` to stack → hangs (Bug B — fixed by asm `"+r"` constraint)
- `char buf[N]` local array → GCC emits `sb` → hangs (Bug B)
- `sha256.h`/`hkdf` functions → `sb` to ctx->buf[] on stack → hangs (Bug B)
- `uart_puts("KHURCH...")` with the old implementation → first `lw` from ROM after `uart_putc('Z')` in main() → hangs silently; board outputs only 'Z' then reboots (Bug C)

## Bug D — function prolog stall (discovered during Bug C fix)

The RISC-V function prolog emits `sw ra, N(sp)` (save return address to BRAM
stack) **before any C source line in the function runs**. If the caller just
did `uart_putc()`, the dBus stall is still active, and the prolog `sw` hangs
silently. No C code in the called function ever executes.

**Symptom**: a diagnostic probe `uart_putc('!')` placed as the FIRST C
statement of a function never appears in output, even though the probe is a
simple immediate-value UART write with no ROM reads. The function appears
dead, but the real hang is in the invisible prolog.

**Fix**: the fence MUST be in the CALLER, placed between the last
`uart_putc()` and the next `uart_puts()` (or any function) call. Fencing
inside the callee is too late — the prolog runs first.

**Also fixed**: the loop fence in uart_puts was inside `if (--remaining == 0)`
— but `--remaining` itself is a BRAM stack read that happens BEFORE the fence.
Moved the fence to immediately after `uart_putc(c)`, unconditionally, so all
subsequent stack accesses (`w >>= 8`, `--remaining`, `*wp++`) are safe.

## Observed symptom for Bug C
Board outputs 'Z' (from `uart_putc('Z')` in main), then reboots. Serial monitor shows "ZZZ" (3 rapid reboots from watchdog). No banner characters ever appear. The 'Z' itself works because it is a direct `uart_putc` call with an immediate value — no ROM read. `uart_puts` hangs on its very first `lw` from .rodata.

## Why (Bug C)
The UART APB slave and the BRAM dBus share internal AXI routing through the Sapphire SoC BmbDecoder. Writing to UART_DATA leaves some internal bus arbiter state that prevents the next read transaction to the BRAM from completing. Two writes to a DIFFERENT APB slave (CM APB3 at 0xF8100000) cycle the arbiter state machine back to a ready condition.

## How to apply
- `uart_puts()`: fence × 2 before EVERY `lw` from .rodata (both the first word and the per-4-chars inner word)
- Any function that does ROM reads after UART output: add fence × 2 immediately before each `lw`, with no `uart_putc` between fence and `lw`
- `uart_putc` remains `always_inline` — no stack, no ROM reads, safe to call freely
- `uart_puthex32_lower` does arithmetic only (no ROM reads) — safe after uart_putc
- All `sb` patterns → still must be avoided (Bug B still present independently of Bug C)
